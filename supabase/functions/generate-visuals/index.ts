// Supabase Edge Function: generate-visuals
// Step 3 of the pipeline: generates the visual for each scene, conditioned on
// the scene description + the project's chosen anime style.
//
// TODO: call your image/video generation provider here (e.g. Runway, Kling,
// Luma, or Stable Diffusion + AnimateDiff) per scene. For visual consistency
// across scenes, reuse a fixed seed / character reference image where the
// provider supports it. Upload results to a working storage bucket.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

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

    if (!Array.isArray(scenes)) throw new Error("No scenes received from voiceover step");

    // TODO: replace with real generation calls per scene, returning visual_url
    const scenesWithVisuals = scenes.map((s: any) => ({ ...s, visual_url: null }));

    await admin
      .from("generation_jobs")
      .update({ status: "compositing", progress_percent: 75, updated_at: new Date().toISOString() })
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