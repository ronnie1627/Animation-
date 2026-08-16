// Supabase Edge Function: generate-script-breakdown
// Step 1 of the pipeline: turns raw script_text into a scene-by-scene shot
// list using Google's Gemini API (free tier — gemini-2.5-flash).
//
// Requires the GEMINI_API_KEY secret:
//   supabase secrets set GEMINI_API_KEY=your-key-here

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const GEMINI_MODEL = "gemini-2.5-flash";

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
  const apiKey = Deno.env.get("GEMINI_API_KEY");
  if (!apiKey) throw new Error("GEMINI_API_KEY secret is not set");

  const prompt = `You are a storyboard artist for a short anime video. Break the
following story into a scene-by-scene shot list sized to fit a 40-60 second
narrated video (roughly 5-9 scenes). The visual style is "${styleName}" and the
narrator's tone is "${narratorTone}".

Story:
"""
${scriptText}
"""

Respond with ONLY a JSON array (no markdown fences, no commentary) where each
element has exactly these fields:
- "narration_line": a short line of narration for this scene (drawn from or
  adapted from the story)
- "description": a vivid visual description of what's on screen, written for
  an image/video generation model — include composition, lighting, and action
- "mood": one or two words describing the emotional tone of the scene
- "duration_estimate_seconds": a number, how long this scene should run (all
  scenes should sum to roughly 40-60 seconds total)`;

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.8, responseMimeType: "application/json" }
      })
    }
  );

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gemini API error (${res.status}): ${errText}`);
  }

  const data = await res.json();
  const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!rawText) throw new Error("Gemini returned no content");

  let parsed: any[];
  try {
    parsed = JSON.parse(rawText);
  } catch {
    throw new Error("Gemini response was not valid JSON: " + rawText.slice(0, 200));
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

    if (scenes.length === 0) throw new Error("Gemini returned zero scenes");

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