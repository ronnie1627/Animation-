// Supabase Edge Function: finalize-video
// Called by the browser once client-side compositing (ffmpeg.wasm) has
// produced the final video and uploaded it to the video-exports bucket.
// Verifies the caller owns the job, then marks it complete.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type"
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });

  try {
    const authHeader = req.headers.get("Authorization")!;
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("PROJECT_SERVICE_ROLE_KEY")!
    );

    const {
      data: { user }
    } = await userClient.auth.getUser();

    if (!user) {
      return new Response(JSON.stringify({ error: "Not authenticated" }), {
        status: 401,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" }
      });
    }

    const { job_id, video_path, duration_seconds } = await req.json();
    if (!job_id || !video_path) {
      return new Response(JSON.stringify({ error: "job_id and video_path are required" }), {
        status: 400,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" }
      });
    }

    // Confirm this job belongs to a project owned by the calling user.
    const { data: job } = await adminClient
      .from("generation_jobs")
      .select("*, projects!inner(user_id)")
      .eq("id", job_id)
      .single();

    if (!job || (job as any).projects.user_id !== user.id) {
      return new Response(JSON.stringify({ error: "Job not found or not owned by you" }), {
        status: 403,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" }
      });
    }

    const { data: publicUrlData } = adminClient.storage.from("video-exports").getPublicUrl(video_path);

    await adminClient
      .from("generation_jobs")
      .update({
        video_url_1080p: publicUrlData.publicUrl,
        status: "complete",
        progress_percent: 100,
        duration_seconds: duration_seconds ?? null,
        updated_at: new Date().toISOString()
      })
      .eq("id", job_id);

    return new Response(JSON.stringify({ success: true, video_url: publicUrlData.publicUrl }), {
      status: 200,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" }
    });
  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" }
    });
  }
});