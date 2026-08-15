// Supabase Edge Function: generate-script-breakdown
// Step 1 of the pipeline: turns raw script_text into a scene-by-scene shot list.
//
// TODO: call your LLM provider (e.g. Anthropic API) here to break `script_text`
// into scenes: { description, narration_line, mood, duration_estimate }[],
// sized to fit a 40-60 second total runtime. For now this stub creates one
// scene per sentence as a placeholder so the pipeline is runnable end-to-end.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

Deno.serve(async (req) => {
  try {
    const { job_id, project_id } = await req.json();
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("PROJECT_SERVICE_ROLE_KEY")!
    );

    await admin
      .from("generation_jobs")
      .update({ status: "scripting", progress_percent: 10, updated_at: new Date().toISOString() })
      .eq("id", job_id);

    const { data: project } = await admin.from("projects").select("*").eq("id", project_id).single();

    // --- placeholder scene breakdown; replace with a real LLM call ---
    const scenes = (project.script_text as string)
      .split(/(?<=[.!?])\s+/)
      .filter(Boolean)
      .map((line: string, i: number) => ({
        index: i,
        narration_line: line.trim(),
        description: line.trim()
      }));
    // ------------------------------------------------------------------

    await admin
      .from("generation_jobs")
      .update({ progress_percent: 20, updated_at: new Date().toISOString() })
      .eq("id", job_id);

    await admin.functions.invoke("generate-voiceover", {
      body: { job_id, project_id, scenes }
    });

    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({ error: (err as Error).message }), { status: 500 });
  }
});
