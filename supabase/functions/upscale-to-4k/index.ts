// Supabase Edge Function: upscale-to-4k
// Step 5 (optional) of the pipeline: upscales the composited 1080p render to 4K.
//
// TODO: call your upscaling provider here (e.g. Topaz, Real-ESRGAN hosted API).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

Deno.serve(async (req) => {
  const { job_id } = await req.json();
  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("PROJECT_SERVICE_ROLE_KEY")!
  );

  try {
    await admin
      .from("generation_jobs")
      .update({ status: "upscaling", progress_percent: 95, updated_at: new Date().toISOString() })
      .eq("id", job_id);

    // TODO: replace with the real 4K video URL from your upscaling provider
    const placeholder4kUrl = null;

    await admin
      .from("generation_jobs")
      .update({
        video_url_4k: placeholder4kUrl,
        status: "complete",
        progress_percent: 100,
        updated_at: new Date().toISOString()
      })
      .eq("id", job_id);

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
        error_message: `4K upscaling failed: ${(err as Error).message}`,
        updated_at: new Date().toISOString()
      })
      .eq("id", job_id);

    return new Response(JSON.stringify({ error: (err as Error).message }), { status: 500 });
  }
});