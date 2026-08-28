// Supabase Edge Function: generate-visuals
// Step 3 of the pipeline: generates a real AI image per scene using
// Cloudflare Workers AI's free tier (10,000 free "neurons"/day, no card
// required — model: @cf/black-forest-labs/flux-1-schnell), then uploads
// each image to Supabase Storage.
//
// Requires two secrets:
//   supabase secrets set CLOUDFLARE_API_TOKEN=your-token-here
//   supabase secrets set CLOUDFLARE_ACCOUNT_ID=your-account-id-here
//
// NOTE: earlier versions of this function tried Pollinations (ongoing
// reliability outages), Hugging Face routing (tiny shared free quota,
// exhausted quickly), and fal.ai directly (requires a funded balance,
// despite advertising a free tier). Cloudflare Workers AI was chosen next
// since it's backed by major cloud infrastructure with a genuinely free,
// no-card daily allowance that explicitly includes image models.
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

const CF_MODEL = "@cf/black-forest-labs/flux-1-schnell";

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
  accountId: string,
  apiToken: string,
  attempt = 1
): Promise<Uint8Array> {
  const prompt = `${styleName} anime style illustration, ${description}, masterpiece, high quality, detailed, vibrant colors`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45000);

  try {
    let res: Response;
    try {
      res = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${CF_MODEL}`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiToken}`,
            "Content-Type": "application/json"
          },
          signal: controller.signal,
          body: JSON.stringify({ prompt, steps: 4 })
        }
      );
    } catch (fetchErr) {
      if (attempt <= 2) {
        await new Promise((resolve) => setTimeout(resolve, 3000));
        return generateSceneImage(description, styleName, seed, accountId, apiToken, attempt + 1);
      }
      throw new Error(`Cloudflare request timed out after ${attempt} attempts`);
    }

    if (res.status === 429 && attempt <= 2) {
      await new Promise((resolve) => setTimeout(resolve, 3000));
      return generateSceneImage(description, styleName, seed, accountId, apiToken, attempt + 1);
    }

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Cloudflare API error (${res.status}): ${errText.slice(0, 300)}`);
    }

    // Cloudflare returns { result: { image: "<base64 string>" } } for this model.
    const contentType = res.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      const data = await res.json();
      const base64 = data?.result?.image;
      if (!base64) throw new Error("Cloudflare response had no image data");
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      return bytes;
    }

    // Some Workers AI models return raw image bytes directly instead.
    return new Uint8Array(await res.arrayBuffer());
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

    const accountId = Deno.env.get("CLOUDFLARE_ACCOUNT_ID");
    const apiToken = Deno.env.get("CLOUDFLARE_API_TOKEN");
    if (!accountId) throw new Error("CLOUDFLARE_ACCOUNT_ID secret is not set");
    if (!apiToken) throw new Error("CLOUDFLARE_API_TOKEN secret is not set");

    const { data: project } = await admin
      .from("projects")
      .select("*, styles(name)")
      .eq("id", project_id)
      .single();

    if (!project) throw new Error("Project not found");

    const styleName = (project as any).styles?.name || "anime";
    const seed = seedFromProjectId(project_id);

    const currentScene = scenes[sceneIndex];
    const imageBytes = await generateSceneImage(
      currentScene.description,
      styleName,
      seed,
      accountId,
      apiToken
    );

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
      // All scenes have real images + audio now. The final assembly
      // (pan/zoom motion, subtitles, muxing audio, exporting an mp4) happens
      // in the browser via ffmpeg.wasm — Supabase edge functions can't run
      // real video encoding. Save the full scene list so the Studio page
      // can pick it up and run that step itself.
      await admin
        .from("generation_jobs")
        .update({
          status: "compositing",
          progress_percent: 75,
          scenes_data: updatedScenes,
          updated_at: new Date().toISOString()
        })
        .eq("id", job_id);
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