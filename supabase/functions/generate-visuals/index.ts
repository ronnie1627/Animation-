// Supabase Edge Function: generate-visuals
// Step 3 of the pipeline: generates a real AI image per scene using fal.ai's
// direct REST API (model: fal-ai/flux/schnell — fast and cheap), then
// uploads each image to Supabase Storage.
//
// Requires the FAL_API_KEY secret:
//   supabase secrets set FAL_API_KEY=your-key-here
//
// NOTE: earlier versions of this function tried Pollinations (free but had
// ongoing reliability outages confirmed on their own bug tracker) and
// Hugging Face's routing layer (worked, but tiny shared free quota and
// routing kept resolving to providers that don't serve image models). This
// version calls fal.ai directly — no routing layer, straightforward REST
// API, and inexpensive even beyond any free credits (~$0.01-0.02/image on
// the schnell model).
//
// ARCHITECTURE NOTE: this function processes ONE scene per invocation and
// then calls itself again for the next scene, rather than looping over all
// scenes within a single invocation, to stay well under Supabase's
// 150-second free-tier execution limit regardless of scene count.
//
// NOTE: this produces STATIC images per scene, not true motion video. The
// compositing step (next in the pipeline) is expected to apply a pan/zoom
// ("Ken Burns") effect to these stills to simulate movement.
//
// NOTE on consistency: a shared seed (derived from the project id) is used
// across all scenes so the art style stays closer together — but true
// character consistency across scenes is a hard problem free/cheap tools
// can't fully solve; expect some visual drift between scenes.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const FAL_MODEL = "fal-ai/flux/schnell";

function seedFromProjectId(projectId: string): number {
  let hash = 0;
  for (let i = 0; i < projectId.length; i++) {
    hash = (hash * 31 + projectId.charCodeAt(i)) >>> 0;
  }
  return hash % 1000000;
}

async function generateSceneImage(
  description: string,
  styleName: string,
  seed: number,
  apiKey: string,
  attempt = 1
): Promise<Uint8Array> {
  const prompt = `${styleName} anime style illustration, ${description}, masterpiece, high quality, detailed, vibrant colors`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45000);

  try {
    let res: Response;
    try {
      // fal.run is the synchronous endpoint — it blocks until the image is
      // ready and returns the result directly, no separate polling needed.
      res = await fetch(`https://fal.run/${FAL_MODEL}`, {
        method: "POST",
        headers: {
          Authorization: `Key ${apiKey}`,
          "Content-Type": "application/json"
        },
        signal: controller.signal,
        body: JSON.stringify({
          prompt,
          seed,
          image_size: "portrait_16_9",
          num_inference_steps: 4
        })
      });
    } catch (fetchErr) {
      if (attempt <= 2) {
        await new Promise((resolve) => setTimeout(resolve, 3000));
        return generateSceneImage(description, styleName, seed, apiKey, attempt + 1);
      }
      throw new Error(`fal.ai request timed out after ${attempt} attempts`);
    }

    if (res.status === 429 && attempt <= 2) {
      await new Promise((resolve) => setTimeout(resolve, 3000));
      return generateSceneImage(description, styleName, seed, apiKey, attempt + 1);
    }

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`fal.ai API error (${res.status}): ${errText.slice(0, 300)}`);
    }

    const data = await res.json();
    const imageUrl = data?.images?.[0]?.url;
    if (!imageUrl) throw new Error("fal.ai response had no image URL");

    const imageRes = await fetch(imageUrl);
    if (!imageRes.ok) throw new Error(`Failed to download generated image (${imageRes.status})`);

    return new Uint8Array(await imageRes.arrayBuffer());
  } finally {
    clearTimeout(timeout);
  }
}

Deno.serve(async (req) => {
  const { job_id, project_id, scenes, sceneIndex = 0 } = await req.json();

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("PROJECT_SERVICE_ROLE_KEY")!
  );

  try {
    if (!Array.isArray(scenes) || scenes.length === 0) {
      throw new Error("No scenes received from voiceover step");
    }

    if (sceneIndex === 0) {
      await admin
        .from("generation_jobs")
        .update({ progress_percent: 60, updated_at: new Date().toISOString() })
        .eq("id", job_id);
    }

    const apiKey = Deno.env.get("FAL_API_KEY");
    if (!apiKey) throw new Error("FAL_API_KEY secret is not set");

    const { data: project } = await admin
      .from("projects")
      .select("*, styles(name)")
      .eq("id", project_id)
      .single();

    if (!project) throw new Error("Project not found");

    const styleName = (project as any).styles?.name || "anime";
    const seed = seedFromProjectId(project_id);

    const currentScene = scenes[sceneIndex];
    const imageBytes = await generateSceneImage(currentScene.description, styleName, seed, apiKey);

    const path = `${job_id}/scene-${currentScene.index}.jpg`;
    const { error: uploadError } = await admin.storage
      .from("thumbnails")
      .upload(path, imageBytes, { contentType: "image/jpeg", upsert: true });

    if (uploadError) throw new Error(`Image upload failed: ${uploadError.message}`);

    const { data: publicUrlData } = admin.storage.from("thumbnails").getPublicUrl(path);
    const updatedScenes = [...scenes];
    updatedScenes[sceneIndex] = { ...currentScene, visual_url: publicUrlData.publicUrl };

    const sceneProgress = 60 + Math.round(((sceneIndex + 1) / scenes.length) * 15);
    const updatePayload: Record<string, unknown> = {
      progress_percent: Math.min(sceneProgress, 75),
      updated_at: new Date().toISOString()
    };
    if (sceneIndex === 0) updatePayload.thumbnail_url = publicUrlData.publicUrl;

    await admin.from("generation_jobs").update(updatePayload).eq("id", job_id);

    const isLastScene = sceneIndex >= scenes.length - 1;

    if (!isLastScene) {
      const { error: invokeError } = await admin.functions.invoke("generate-visuals", {
        body: { job_id, project_id, scenes: updatedScenes, sceneIndex: sceneIndex + 1 }
      });
      if (invokeError) throw invokeError;
    } else {
      await admin
        .from("generation_jobs")
        .update({ status: "compositing", progress_percent: 75, updated_at: new Date().toISOString() })
        .eq("id", job_id);

      const { error: invokeError } = await admin.functions.invoke("composite-video", {
        body: { job_id, project_id, scenes: updatedScenes }
      });
      if (invokeError) throw invokeError;
    }

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
        error_message: `Visual generation failed (scene ${sceneIndex + 1}): ${(err as Error).message}`,
        updated_at: new Date().toISOString()
      })
      .eq("id", job_id);

    return new Response(JSON.stringify({ error: (err as Error).message }), { status: 500 });
  }
});