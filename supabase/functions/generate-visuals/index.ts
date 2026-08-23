// Supabase Edge Function: generate-visuals
// Step 3 of the pipeline: generates a real AI image per scene using
// Hugging Face's official Inference client (model: black-forest-labs/FLUX.1-dev,
// explicitly routed through the "fal-ai" provider). Both the default/"auto"
// routing and the "hf-inference" provider were tried first but both
// resolved to hf-inference, which no longer hosts image-generation models —
// fal-ai is the provider Hugging Face's own docs consistently show as
// actually serving FLUX models, reachable with just a normal HF token
// (no separate fal.ai account needed; HF routes and bills a small free
// monthly quota automatically).
//
// Requires the HUGGINGFACE_API_KEY secret:
//   supabase secrets set HUGGINGFACE_API_KEY=your-token-here
//
// NOTE: an earlier version of this function called the raw REST endpoint
// directly (api-inference.huggingface.co/models/...), which turned out to
// be a legacy path that no longer reliably serves image models. This
// version uses Hugging Face's own official @huggingface/inference client
// library instead, which handles the current routing/response format
// correctly regardless of future provider-routing changes on their end.
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
// character consistency across scenes is a hard problem free tools can't
// fully solve; expect some visual drift between scenes.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { InferenceClient } from "https://esm.sh/@huggingface/inference@3.6.1";

const HF_MODEL = "black-forest-labs/FLUX.1-dev";

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
  hf: InferenceClient,
  attempt = 1
): Promise<Uint8Array> {
  const prompt = `${styleName} anime style illustration, ${description}, masterpiece, high quality, detailed, vibrant colors`;

  try {
    const imageBlob = await hf.textToImage({
      model: HF_MODEL,
      inputs: prompt,
      provider: "fal-ai",
      parameters: { num_inference_steps: 4, seed }
    });

    return new Uint8Array(await imageBlob.arrayBuffer());
  } catch (err) {
    if (attempt <= 2) {
      await new Promise((resolve) => setTimeout(resolve, attempt * 3000));
      return generateSceneImage(description, styleName, seed, hf, attempt + 1);
    }
    throw new Error(`Hugging Face image generation failed after ${attempt} attempts: ${(err as Error).message}`);
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

    const apiKey = Deno.env.get("HUGGINGFACE_API_KEY");
    if (!apiKey) throw new Error("HUGGINGFACE_API_KEY secret is not set");

    const hf = new InferenceClient(apiKey);

    const { data: project } = await admin
      .from("projects")
      .select("*, styles(name)")
      .eq("id", project_id)
      .single();

    if (!project) throw new Error("Project not found");

    const styleName = (project as any).styles?.name || "anime";
    const seed = seedFromProjectId(project_id);

    const currentScene = scenes[sceneIndex];
    const imageBytes = await generateSceneImage(currentScene.description, styleName, seed, hf);

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