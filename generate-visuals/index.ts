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
  // Kept deliberately small — larger images take Pollinations noticeably
  // longer to generate, and repeated slow requests were exceeding
  // Supabase's 150s free-tier execution limit. The (still-placeholder)
  // upscale-to-4k step is meant to take these up to final delivery
  // resolution later.
  return aspectRatio === "9:16" ? { width: 512, height: 910 } : { width: 910, height: 512 };
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
  deadlineAt: number,
  attempt = 1
): Promise<Uint8Array> {
  if (Date.now() > deadlineAt) {
    throw new Error(
      "Ran out of time generating images before Supabase's execution limit — try a shorter script (fewer scenes) or try again, Pollinations may be under heavy load right now."
    );
  }

  const prompt = `${styleName} anime style illustration: ${description}, high quality, detailed, vibrant colors`;
  const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=${width}&height=${height}&seed=${seed}&nologo=true`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);

  try {
    let res: Response;
    try {
      res = await fetch(url, { signal: controller.signal });
    } catch (fetchErr) {
      // A timeout/abort throws here rather than returning a response — treat
      // it the same as a rate limit: back off and retry rather than failing
      // the whole job over one slow image.
      if (attempt <= 2 && Date.now() < deadlineAt) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 2000));
        return generateSceneImage(description, styleName, seed, width, height, deadlineAt, attempt + 1);
      }
      throw new Error(`Pollinations request timed out after ${attempt} attempts`);
    }

    if (res.status === 429 && attempt <= 2 && Date.now() < deadlineAt) {
      // Pollinations rate-limits bursts of requests from the same source —
      // back off briefly and retry rather than failing the whole job.
      await new Promise((resolve) => setTimeout(resolve, attempt * 2000));
      return generateSceneImage(description, styleName, seed, width, height, deadlineAt, attempt + 1);
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
  const startTime = Date.now();
  // Leave a safety margin under Supabase's 150s free-tier hard limit so we
  // can fail with a clear, logged error instead of being silently killed.
  const deadlineAt = startTime + 110000;

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
      const imageBytes = await generateSceneImage(scene.description, styleName, seed, width, height, deadlineAt);

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