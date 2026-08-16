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
  height: number
): Promise<Uint8Array> {
  const prompt = `${styleName} anime style illustration: ${description}, high quality, detailed, vibrant colors`;
  const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=${width}&height=${height}&seed=${seed}&nologo=true`;

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Pollinations image generation error (${res.status})`);
  }
  return new Uint8Array(await res.arrayBuffer());
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

    const scenesWithVisuals = [];
    let firstImageUrl: string | null = null;

    for (const scene of scenes) {
      const imageBytes = await generateSceneImage(scene.description, styleName, seed, width, height);

      const path = `${job_id}/scene-${scene.index}.jpg`;
      const { error: uploadError } = await admin.storage
        .from("thumbnails")
        .upload(path, imageBytes, { contentType: "image/jpeg", upsert: true });

      if (uploadError) throw new Error(`Image upload failed: ${uploadError.message}`);

      const { data: publicUrlData } = admin.storage.from("thumbnails").getPublicUrl(path);
      if (!firstImageUrl) firstImageUrl = publicUrlData.publicUrl;

      scenesWithVisuals.push({ ...scene, visual_url: publicUrlData.publicUrl });
    }

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