// Supabase Edge Function: generate-script-breakdown
// Step 1 of the pipeline: turns raw script_text into a scene-by-scene shot
// list using Groq's free-tier API (OpenAI-compatible).
//
// Requires the GROQ_API_KEY secret:
//   supabase secrets set GROQ_API_KEY=your-key-here

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

// Uses Groq's free tier (OpenAI-compatible chat completions API) since
// Google's Gemini free tier has been unreliable for new projects.
// llama-3.3-70b-versatile was deprecated by Groq in June 2026 — this is
// their current recommended general-purpose replacement.
const GROQ_MODEL = "openai/gpt-oss-120b";

type Scene = {
  index: number;
  narration_line: string;
  description: string;
  mood: string;
  duration_estimate_seconds: number;
};

async function breakdownScript(
  scriptText: string,
  styleName: string,
  narratorTone: string
): Promise<Scene[]> {
  const apiKey = Deno.env.get("GROQ_API_KEY");
  if (!apiKey) throw new Error("GROQ_API_KEY secret is not set");

  const prompt = `You are a storyboard artist for a short anime video. Break the
following story into a scene-by-scene shot list sized to fit a 40-60 second
narrated video (roughly 4-6 scenes — keep this count modest, since each scene
requires a separate image generation call downstream with a strict time
budget). The visual style is "${styleName}" and the narrator's tone is
"${narratorTone}".

Story:
"""
${scriptText}
"""

Respond with ONLY a JSON object of the form {"scenes": [...]} (no markdown
fences, no commentary) where each element of the "scenes" array has exactly
these fields:
- "narration_line": a short line of narration for this scene (drawn from or
  adapted from the story)
- "description": a vivid visual description of what's on screen, written for
  an image/video generation model — include composition, lighting, and action
- "mood": one or two words describing the emotional tone of the scene
- "duration_estimate_seconds": a number, how long this scene should run (all
  scenes should sum to roughly 40-60 seconds total)`;

  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.8,
      response_format: { type: "json_object" }
    })
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Groq API error (${res.status}): ${errText}`);
  }

  const data = await res.json();
  const rawText = data?.choices?.[0]?.message?.content;
  if (!rawText) throw new Error("Groq returned no content");

  let parsed: any[];
  try {
    const outer = JSON.parse(rawText);
    // Groq's JSON mode requires a top-level object, so we ask it to wrap the
    // array — handle both a bare array and a { scenes: [...] } wrapper.
    parsed = Array.isArray(outer) ? outer : outer.scenes ?? Object.values(outer)[0];
    if (!Array.isArray(parsed)) throw new Error("no array found in response");
  } catch (e) {
    throw new Error("Groq response was not valid JSON: " + rawText.slice(0, 200));
  }

  return parsed.map((s, i) => ({
    index: i,
    narration_line: String(s.narration_line ?? "").trim(),
    description: String(s.description ?? "").trim(),
    mood: String(s.mood ?? "neutral").trim(),
    duration_estimate_seconds: Number(s.duration_estimate_seconds) || 6
  }));
}

Deno.serve(async (req) => {
  const { job_id, project_id } = await req.json();
  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("PROJECT_SERVICE_ROLE_KEY")!
  );

  try {
    await admin
      .from("generation_jobs")
      .update({ status: "scripting", progress_percent: 10, updated_at: new Date().toISOString() })
      .eq("id", job_id);

    const { data: project } = await admin
      .from("projects")
      .select("*, styles(name)")
      .eq("id", project_id)
      .single();

    if (!project) throw new Error("Project not found");

    const styleName = (project as any).styles?.name || "anime";
    const scenes = await breakdownScript(project.script_text, styleName, project.narrator_tone);

    if (scenes.length === 0) throw new Error("Groq returned zero scenes");

    await admin
      .from("generation_jobs")
      .update({ progress_percent: 20, updated_at: new Date().toISOString() })
      .eq("id", job_id);

    await admin.functions.invoke("generate-voiceover", {
      body: { job_id, project_id, scenes }
    });

    return new Response(JSON.stringify({ ok: true, scenes }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  } catch (err) {
    console.error(err);
    await admin
      .from("generation_jobs")
      .update({
        status: "failed",
        error_message: `Script breakdown failed: ${(err as Error).message}`,
        updated_at: new Date().toISOString()
      })
      .eq("id", job_id);

    return new Response(JSON.stringify({ error: (err as Error).message }), { status: 500 });
  }
});