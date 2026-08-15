// Supabase Edge Function: create-generation-job
// Deno runtime. Deploy with: supabase functions deploy create-generation-job
//
// Validates the caller, checks/deducts credits (admins bypass this entirely),
// creates the project + generation_jobs rows, then kicks off the pipeline by
// invoking generate-script-breakdown.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type"
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });

  try {
    const authHeader = req.headers.get("Authorization")!;

    // Client scoped to the calling user — used to identify who's asking.
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    // Service-role client — used for writes that must bypass RLS (credits, jobs).
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

    const body = await req.json();
    const {
      script_text,
      style_id,
      voice_id,
      template_id,
      narrator_tone,
      subtitle_format,
      subtitles_enabled,
      resolution,
      aspect_ratio
    } = body;

    if (!script_text || !style_id || !voice_id) {
      return new Response(JSON.stringify({ error: "Missing required fields" }), {
        status: 400,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" }
      });
    }

    const { data: profile } = await adminClient
      .from("profiles")
      .select("*")
      .eq("id", user.id)
      .single();

    if (!profile) {
      return new Response(JSON.stringify({ error: "Profile not found" }), {
        status: 404,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" }
      });
    }

    const cost = resolution === "4k" ? 3 : 1;

    // Admin accounts bypass the credit system entirely — no deduction, no check.
    if (!profile.is_admin) {
      if (profile.credits < cost) {
        return new Response(JSON.stringify({ error: "Not enough credits" }), {
          status: 402,
          headers: { ...CORS_HEADERS, "Content-Type": "application/json" }
        });
      }

      await adminClient
        .from("profiles")
        .update({ credits: profile.credits - cost })
        .eq("id", user.id);

      await adminClient.from("credit_transactions").insert({
        user_id: user.id,
        amount: -cost,
        reason: `video_generation_${resolution}`
      });
    }

    const { data: project, error: projectError } = await adminClient
      .from("projects")
      .insert({
        user_id: user.id,
        script_text,
        style_id,
        voice_id,
        template_id,
        narrator_tone: narrator_tone || "calm",
        subtitle_format: subtitle_format || "minimal_clean",
        subtitles_enabled: subtitles_enabled ?? true,
        resolution: resolution || "1080p",
        aspect_ratio: aspect_ratio || "16:9"
      })
      .select()
      .single();

    if (projectError) throw projectError;

    const { data: job, error: jobError } = await adminClient
      .from("generation_jobs")
      .insert({ project_id: project.id, status: "queued", progress_percent: 0 })
      .select()
      .single();

    if (jobError) throw jobError;

    // Fire-and-forget the next pipeline step. In production, prefer a durable
    // queue (e.g. pg_cron / a message queue) over a direct function-to-function
    // call so failures can be retried.
    adminClient.functions
      .invoke("generate-script-breakdown", { body: { job_id: job.id, project_id: project.id } })
      .catch((err) => console.error("Failed to kick off pipeline:", err));

    return new Response(JSON.stringify({ job, project }), {
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
