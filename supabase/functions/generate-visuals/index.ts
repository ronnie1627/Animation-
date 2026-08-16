// Supabase Edge Function: generate-visuals
// Step 3 of the pipeline: generates a real AI image per scene using
// Pollinations.ai — a free, keyless image generation API — styled by the
// project's chosen anime style and scene description, then uploads each
// image to Supabase Storage.
//
// NOTE: this produces STATIC images per scene, not true motion video. Real
// motion would require a paid video-generation model (Runway, Kling, etc).
// The compositing step (next in the pipeline) is expected to apply a
// pan/zoom ("Ken Burns") effect to these stills to simulate movement.
//
// NOTE on consistency: a shared seed (derived from the project id) is used
// across all scenes so the art style stays closer together — but true
// character consistency across scenes is a hard problem free tools can't
// fully solve; expect some visual drift between scenes.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

function seedFromProjectId(projectId: string): number {
  let hash = 0;
  for (let i = 0; i < projectId.length; i++) {
    hash = (hash * 31 + projectId.charCodeAt(i)) >>> 0;
  }
  return hash % 1000000;
}

function dimensionsForAspectRatio(aspectRatio: string): { width: number; height: number } {
  // Kept modest on purpose — Pollinations' free tier is slow/unreliable at
  // very large sizes. The (still-placeholder) upscale-to-4k step is meant
  // to take these up to final delivery resolution later.
  return aspectRatio === "9:16" ? { width: 768, height: 1365 } : { width: 1365, height: 768 };
}

// NOTE: Pollinations has both this legacy endpoint (image.pollinations.ai)
// and a newer unified one (gen.pollinations.ai/image/...). This one is used
// here since it's the documented pattern for width/height/seed params; if
// it's ever retired, check https://github.com/pollinations/pollinations for
// the current endpoint.
async function generateSceneImage(
  description: string,
  styleName: string,
  seed: number,
  width: number,
  height: number,
  attempt = 1
): Promise<Uint8Array> {
  const prompt = `${styleName} anime style illustration: ${description}, high quality, detailed, vibrant colors`;
  const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=${width}&height=${height}&seed=${seed}&nologo=true`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);

  try {
    const res = await fetch(url, { signal: controller.signal });

    if (res.status === 429 && attempt <= 2) {
      // Pollinations rate-limits bursts of requests from the same source —
      // back off briefly and retry rather than failing the whole job.
      await new Promise((resolve) => setTimeout(resolve, attempt * 2500));
      return generateSceneImage(description, styleName, seed, width, height, attempt + 1);
    }

    if (!res.ok) {
      throw new Error(`Pollinations image generation error (${res.status})`);
    }
    return new Uint8Array(await res.arrayBuffer());
  } finally {
    clearTimeout(timeout);
  }
}

// Runs async tasks with a limited number in flight at once, rather than
// either all-at-once (triggers Pollinations' burst rate limit) or fully
// sequential (risks exceeding the edge function's execution time limit).
async function mapWithConcurrencyLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex++;
      results[currentIndex] = await fn(items[currentIndex]);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

Deno.serve(async (req) => {
  const { job_id, project_id, scenes } = await req.json();
  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("PROJECT_SERVICE_ROLE_KEY")!
  );

  try {
    await admin
      .from("generation_jobs")
      .update({ progress_percent: 60, updated_at: new Date().toISOString() })
      .eq("id", job_id);

    if (!Array.isArray(scenes) || scenes.length === 0) {
      throw new Error("No scenes received from voiceover step");
    }

    const { data: project } = await admin
      .from("projects")
      .select("*, styles(name)")
      .eq("id", project_id)
      .single();

    if (!project) throw new Error("Project not found");

    const styleName = (project as any).styles?.name || "anime";
    const seed = seedFromProjectId(project_id);
    const { width, height } = dimensionsForAspectRatio(project.aspect_ratio);

    // Generate scene images strictly one at a time. Supabase's free tier
    // gives each edge function a hard 150-second wall-clock limit — even
    // 2-at-a-time concurrency triggered Pollinations' burst rate limiter in
    // testing, so this trades a little speed for reliability. Combined with
    // the reduced 4-6 scene target from the script-breakdown step, this
    // comfortably fits the time budget.
    const scenesWithVisuals = await mapWithConcurrencyLimit(scenes, 1, async (scene: any) => {
      const imageBytes = await generateSceneImage(scene.description, styleName, seed, width, height);

      const path = `${job_id}/scene-${scene.index}.jpg`;
      const { error: uploadError } = await admin.storage
        .from("thumbnails")
        .upload(path, imageBytes, { contentType: "image/jpeg", upsert: true });

      if (uploadError) throw new Error(`Image upload failed: ${uploadError.message}`);

      const { data: publicUrlData } = admin.storage.from("thumbnails").getPublicUrl(path);
      return { ...scene, visual_url: publicUrlData.publicUrl };
    });

    const firstImageUrl =
      scenesWithVisuals.find((s) => s.index === 0)?.visual_url ?? scenesWithVisuals[0]?.visual_url ?? null;

    await admin
      .from("generation_jobs")
      .update({
        status: "compositing",
        progress_percent: 75,
        thumbnail_url: firstImageUrl,
        updated_at: new Date().toISOString()
      })
      .eq("id", job_id);

    const { error: invokeError } = await admin.functions.invoke("composite-video", {
      body: { job_id, project_id, scenes: scenesWithVisuals }
    });
    if (invokeError) throw invokeError;

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  } catch (err) {
    console.error(err);
    await admin
      .from("generation_jobs")
      .update({
        status: "failed",
        error_message: `Visual generation failed: ${(err as Error).message}`,
        updated_at: new Date().toISOString()
      })
      .eq("id", job_id);

    return new Response(JSON.stringify({ error: (err as Error).message }), { status: 500 });
  }
});