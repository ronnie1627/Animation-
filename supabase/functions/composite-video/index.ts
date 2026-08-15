// Supabase Edge Function: composite-video
// Step 4 of the pipeline: assembles visuals + voiceover + subtitles (per
// project.subtitle_format) + background music into a single 1080p video,
// stores it in `video-exports`, and marks the job complete (or continues to
// 4K upscaling if requested).
//
// TODO: this step is typically too heavy for a Deno edge function directly —
// call out to a dedicated render service (e.g. an ffmpeg worker, or a hosted
// video-compositing API like Shotstack/Creatomate) rather than doing the
// encoding inline here.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

Deno.serve(async (req) => {
  try {
    const { job_id, project_id } = await req.json();
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("PROJECT_SERVICE_ROLE_KEY")!
    );

    const { data: project } = await admin.from("projects").select("*").eq("id", project_id).single();

    // TODO: replace with the real composited video URL from your render service
    const placeholderVideoUrl = null;

    await admin
      .from("generation_jobs")
      .update({
        video_url_1080p: placeholderVideoUrl,
        progress_percent: 90,
        updated_at: new Date().toISOString()
      })
      .eq("id", job_id);

    if (project.resolution === "4k") {
      await admin.functions.invoke("upscale-to-4k", { body: { job_id, project_id } });
    } else {
      await admin
        .from("generation_jobs")
        .update({ status: "complete", progress_percent: 100, updated_at: new Date().toISOString() })
        .eq("id", job_id);
    }

    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  } catch (err) {
    console.error(err);
    const body = await req.clone().json().catch(() => ({}));
    if (body.job_id) {
      const admin = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("PROJECT_SERVICE_ROLE_KEY")!
      );
      await admin
        .from("generation_jobs")
        .update({ status: "failed", error_message: (err as Error).message })
        .eq("id", body.job_id);
    }
    return new Response(JSON.stringify({ error: (err as Error).message }), { status: 500 });
  }
});
