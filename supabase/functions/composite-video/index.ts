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
  // Parse the body once, outside the try block, so job_id is available to
  // the catch block too — request bodies can only be read once, so trying
  // to re-read it inside catch (as a previous version of this file did)
  // silently fails and leaves the job stuck instead of marked as failed.
  const { job_id, project_id } = await req.json();

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("PROJECT_SERVICE_ROLE_KEY")!
  );

  try {
    const { data: project, error: projectError } = await admin
      .from("projects")
      .select("*")
      .eq("id", project_id)
      .single();

    if (projectError) throw projectError;
    if (!project) throw new Error("Project not found");

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
      const { error: invokeError } = await admin.functions.invoke("upscale-to-4k", {
        body: { job_id, project_id }
      });
      if (invokeError) throw invokeError;
    } else {
      await admin
        .from("generation_jobs")
        .update({ status: "complete", progress_percent: 100, updated_at: new Date().toISOString() })
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
        error_message: `Compositing failed: ${(err as Error).message}`,
        updated_at: new Date().toISOString()
      })
      .eq("id", job_id);

    return new Response(JSON.stringify({ error: (err as Error).message }), { status: 500 });
  }
});