// Supabase Edge Function: generate-voiceover
// Step 2 of the pipeline: synthesizes narration audio + word-level timestamps
// (needed for subtitle sync) for each scene's narration_line.
//
// TODO: call your TTS provider here (e.g. ElevenLabs) using project.voice_id
// and project.narrator_tone as style parameters. Upload resulting audio to
// the `voice-samples` bucket (or a working bucket) and pass URLs downstream.

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
      .update({ status: "voice_generating", progress_percent: 30, updated_at: new Date().toISOString() })
      .eq("id", job_id);

    if (!Array.isArray(scenes)) throw new Error("No scenes received from script breakdown step");

    // TODO: replace with real TTS calls per scene, returning audio_url + word timestamps
    const scenesWithAudio = scenes.map((s: any) => ({ ...s, audio_url: null, word_timestamps: [] }));

    await admin
      .from("generation_jobs")
      .update({ status: "rendering", progress_percent: 40, updated_at: new Date().toISOString() })
      .eq("id", job_id);

    const { error: invokeError } = await admin.functions.invoke("generate-visuals", {
      body: { job_id, project_id, scenes: scenesWithAudio }
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
        error_message: `Voice generation failed: ${(err as Error).message}`,
        updated_at: new Date().toISOString()
      })
      .eq("id", job_id);

    return new Response(JSON.stringify({ error: (err as Error).message }), { status: 500 });
  }
});