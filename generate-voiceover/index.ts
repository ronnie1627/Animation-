// Supabase Edge Function: generate-voiceover
// Step 2 of the pipeline: synthesizes real narration audio for each scene
// using ElevenLabs' free-tier text-to-speech API, and uploads each clip to
// Supabase Storage.
//
// Requires the ELEVENLABS_API_KEY secret:
//   supabase secrets set ELEVENLABS_API_KEY=your-key-here
//
// NOTE: word-level timestamps for precise karaoke-style subtitle sync are
// not implemented here (that requires ElevenLabs' more complex
// "with-timestamps" endpoint). Scene-level timing is used instead — fine for
// fade/minimal subtitle formats, less precise for the karaoke format.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

// ElevenLabs blocked free-tier API access to shared Voice Library voices, so
// hardcoded public voice IDs no longer work. Instead, we look up voices the
// account owner has personally added to "My Voices" (elevenlabs.io/app/voice-library
// → Add to My Voices), and pick one matching the requested gender, falling
// back to the first available voice.
async function getVoiceId(desiredGender: string, apiKey: string): Promise<string> {
  const res = await fetch("https://api.elevenlabs.io/v1/voices", {
    headers: { "xi-api-key": apiKey }
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`ElevenLabs voices lookup error (${res.status}): ${errText}`);
  }

  const data = await res.json();
  const voices = data?.voices ?? [];

  if (voices.length === 0) {
    throw new Error(
      "No voices found on this ElevenLabs account. Add at least one voice at " +
        "elevenlabs.io/app/voice-library (click a voice → Add to My Voices) before generating."
    );
  }

  const genderMatch = voices.find(
    (v: any) => (v.labels?.gender || "").toLowerCase() === desiredGender.toLowerCase()
  );

  return (genderMatch || voices[0]).voice_id;
}

async function synthesizeSpeech(text: string, voiceId: string, apiKey: string): Promise<Uint8Array> {
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "xi-api-key": apiKey
    },
    body: JSON.stringify({
      text,
      model_id: "eleven_turbo_v2_5",
      voice_settings: { stability: 0.5, similarity_boost: 0.75 }
    })
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`ElevenLabs API error (${res.status}): ${errText}`);
  }

  return new Uint8Array(await res.arrayBuffer());
}

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

    if (!Array.isArray(scenes) || scenes.length === 0) {
      throw new Error("No scenes received from script breakdown step");
    }

    const apiKey = Deno.env.get("ELEVENLABS_API_KEY");
    if (!apiKey) throw new Error("ELEVENLABS_API_KEY secret is not set");

    const { data: project } = await admin
      .from("projects")
      .select("*, voices(gender)")
      .eq("id", project_id)
      .single();

    const voiceGender = (project as any)?.voices?.gender || "neutral";
    const voiceId = await getVoiceId(voiceGender, apiKey);

    const scenesWithAudio = [];
    for (const scene of scenes) {
      const audioBytes = await synthesizeSpeech(scene.narration_line, voiceId, apiKey);

      const path = `${job_id}/scene-${scene.index}.mp3`;
      const { error: uploadError } = await admin.storage
        .from("voice-samples")
        .upload(path, audioBytes, { contentType: "audio/mpeg", upsert: true });

      if (uploadError) throw new Error(`Audio upload failed: ${uploadError.message}`);

      const { data: publicUrlData } = admin.storage.from("voice-samples").getPublicUrl(path);

      scenesWithAudio.push({ ...scene, audio_url: publicUrlData.publicUrl, word_timestamps: [] });
    }

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