"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import SelectGrid from "@/components/SelectGrid";
import ProgressPanel from "@/components/ProgressPanel";
import { compositeVideo } from "@/lib/compositeVideo";
import type { GenerationJob, Profile, Style, Template, Voice } from "@/lib/types";

const SUBTITLE_FORMATS = [
  { id: "karaoke", name: "Karaoke Highlight", description: "Word lights up in sync with narration" },
  { id: "fade_line", name: "Fade In", description: "Clean, one line at a time" },
  { id: "bold_cinematic", name: "Bold Cinematic", description: "Large, high-contrast, trailer-style" },
  { id: "minimal_clean", name: "Minimal Clean", description: "Small, unobtrusive, bottom-third" }
];

export default function StudioPage() {
  const supabase = createClient();

  const [profile, setProfile] = useState<Profile | null>(null);
  const [script, setScript] = useState("");

  const [styles, setStyles] = useState<Style[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [voices, setVoices] = useState<Voice[]>([]);
  const [dataLoading, setDataLoading] = useState(true);

  const [styleId, setStyleId] = useState<string>("");
  const [templateId, setTemplateId] = useState<string>("");
  const [voiceId, setVoiceId] = useState<string>("");
  const [subtitleFormat, setSubtitleFormat] = useState(SUBTITLE_FORMATS[0].id);
  const [subtitlesEnabled, setSubtitlesEnabled] = useState(true);
  const [resolution, setResolution] = useState<"1080p" | "4k">("1080p");
  const [aspectRatio, setAspectRatio] = useState<"16:9" | "9:16">("16:9");

  const [job, setJob] = useState<GenerationJob | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [compositing, setCompositing] = useState<{ percent: number; label: string } | null>(null);
  const compositingStartedRef = useRef<Set<string>>(new Set());

  const wordCount = script.trim() ? script.trim().split(/\s+/).length : 0;
  const estSeconds = Math.round((wordCount / 150) * 60);

  const selectedTemplate = useMemo(
    () => templates.find((t) => t.id === templateId),
    [templates, templateId]
  );

  useEffect(() => {
    async function loadCatalog() {
      const [{ data: s }, { data: t }, { data: v }] = await Promise.all([
        supabase.from("styles").select("*").order("sort_order"),
        supabase.from("templates").select("*").order("sort_order"),
        supabase.from("voices").select("*")
      ]);

      setStyles((s as Style[]) || []);
      setTemplates((t as Template[]) || []);
      setVoices((v as Voice[]) || []);

      if (s && s.length > 0) setStyleId(s[0].id);
      if (t && t.length > 0) setTemplateId(t[0].id);
      if (v && v.length > 0) setVoiceId(v[0].id);

      setDataLoading(false);
    }
    loadCatalog();
  }, [supabase]);

  useEffect(() => {
    if (selectedTemplate && selectedTemplate.name !== "Custom") {
      setSubtitleFormat(selectedTemplate.subtitle_format);
    }
  }, [selectedTemplate]);

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) return;
      const { data } = await supabase.from("profiles").select("*").eq("id", user.id).single();
      setProfile(data as Profile);
    });
  }, [supabase]);

  // Watches the active job's status via Supabase Realtime, with a direct
  // polling fallback every 4s in case a realtime event is ever missed
  // (e.g. during a brief reconnect) — keyed off job?.id only so it doesn't
  // tear down and rebuild the subscription on every single update, which
  // previously created a race condition that could leave the UI stuck.
  useEffect(() => {
    if (!job?.id) return;

    const channel = supabase
      .channel(`job-${job.id}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "generation_jobs", filter: `id=eq.${job.id}` },
        (payload) => setJob(payload.new as GenerationJob)
      )
      .subscribe();

    const pollInterval = setInterval(async () => {
      const { data } = await supabase.from("generation_jobs").select("*").eq("id", job.id).single();
      if (data && data.updated_at !== job.updated_at) setJob(data as GenerationJob);
    }, 4000);

    return () => {
      supabase.removeChannel(channel);
      clearInterval(pollInterval);
    };
  }, [job?.id, supabase]);

  // Once the job reaches "compositing" and has scene data attached, run the
  // actual video assembly in the browser (ffmpeg.wasm) — this can't happen
  // on the server since Supabase edge functions can't do real video encoding.
  useEffect(() => {
    if (!job || job.status !== "compositing") return;
    if (compositingStartedRef.current.has(job.id)) return;
    const scenesData = (job as any).scenes_data;
    if (!scenesData || !Array.isArray(scenesData) || scenesData.length === 0) return;

    compositingStartedRef.current.add(job.id);

    (async () => {
      try {
        const blob = await compositeVideo(scenesData, {
          aspectRatio,
          subtitlesEnabled,
          onProgress: (percent, label) => setCompositing({ percent, label })
        });

        setCompositing({ percent: 97, label: "Uploading final video…" });

        const path = `${job.id}/final.mp4`;
        const { error: uploadError } = await supabase.storage
          .from("video-exports")
          .upload(path, blob, { contentType: "video/mp4", upsert: true });

        if (uploadError) throw new Error(`Upload failed: ${uploadError.message}`);

        const totalDuration = scenesData.reduce(
          (sum: number, s: any) => sum + (s.duration_estimate_seconds || 6),
          0
        );

        const { error: finalizeError } = await supabase.functions.invoke("finalize-video", {
          body: { job_id: job.id, video_path: path, duration_seconds: Math.round(totalDuration) }
        });

        if (finalizeError) throw new Error(finalizeError.message);

        setCompositing(null);
      } catch (err) {
        console.error(err);
        setCompositing(null);
        setError(
          `Video assembly failed in your browser: ${(err as Error).message}. Try again — this step runs on your device and can be sensitive to browser/tab conditions.`
        );
      }
    })();
  }, [job, aspectRatio, subtitlesEnabled, supabase]);

  const costCredits = resolution === "4k" ? 3 : 1;
  const canAfford = profile ? profile.is_admin || profile.credits >= costCredits : false;

  async function handleGenerate() {
    if (!script.trim()) {
      setError("Write a script first.");
      return;
    }
    if (!styleId || !voiceId) {
      setError("Style and voice catalog is still loading — try again in a moment.");
      return;
    }
    setSubmitting(true);
    setError(null);

    const {
      data: { session }
    } = await supabase.auth.getSession();

    if (!session) {
      setError("Please log in first.");
      setSubmitting(false);
      return;
    }

    const { data, error: fnError } = await supabase.functions.invoke("create-generation-job", {
      body: {
        script_text: script,
        style_id: styleId,
        voice_id: voiceId,
        template_id: selectedTemplate?.name === "Custom" ? null : templateId,
        narrator_tone: selectedTemplate?.narrator_tone ?? "calm",
        subtitle_format: subtitleFormat,
        subtitles_enabled: subtitlesEnabled,
        resolution,
        aspect_ratio: aspectRatio
      }
    });

    setSubmitting(false);

    if (fnError) {
      setError(fnError.message || "Generation failed to start.");
      return;
    }

    setJob(data.job as GenerationJob);
  }

  return (
    <div className="mx-auto max-w-5xl px-6 py-12">
      <div className="flex items-end justify-between mb-8">
        <div>
          <h1 className="font-display text-3xl font-bold">Studio</h1>
          <p className="text-mist text-sm mt-1">Write, style, and generate your anime video.</p>
        </div>
        {profile && (
          <span className="text-sm text-mist border border-line rounded-full px-4 py-1.5">
            {profile.is_admin ? "Unlimited (Admin)" : `${profile.credits.toLocaleString()} credits`}
          </span>
        )}
      </div>

      <div className="grid lg:grid-cols-[1fr_380px] gap-8">
        <div className="space-y-8">
          <section className="glass p-6">
            <div className="flex items-center justify-between mb-2">
              <label className="font-semibold">Your story</label>
              <span className="text-xs text-mist">
                {wordCount} words · ~{estSeconds}s narration
              </span>
            </div>
            <textarea
              value={script}
              onChange={(e) => setScript(e.target.value)}
              placeholder="A lone swordsman stands at the edge of a neon-lit rooftop, watching the city breathe below him..."
              rows={8}
              className="w-full rounded-lg bg-ink border border-line px-4 py-3 outline-none focus:border-signal resize-none"
            />
            <p className="text-xs text-mist mt-2">
              Aim for 100–160 words for a 40–60 second video.
            </p>
          </section>

          <section className="glass p-6">
            <label className="font-semibold block mb-3">Template</label>
            {dataLoading ? (
              <p className="text-sm text-mist">Loading templates…</p>
            ) : (
              <SelectGrid items={templates} selectedId={templateId} onSelect={setTemplateId} />
            )}
          </section>

          <section className="glass p-6">
            <label className="font-semibold block mb-3">Art style</label>
            {dataLoading ? (
              <p className="text-sm text-mist">Loading styles…</p>
            ) : (
              <SelectGrid items={styles} selectedId={styleId} onSelect={setStyleId} />
            )}
          </section>

          <section className="glass p-6">
            <label className="font-semibold block mb-3">Narrator voice</label>
            {dataLoading ? (
              <p className="text-sm text-mist">Loading voices…</p>
            ) : (
              <SelectGrid
                items={voices.map((v) => ({ id: v.id, name: v.name, description: `${v.gender} · ${v.language}` }))}
                selectedId={voiceId}
                onSelect={setVoiceId}
              />
            )}
          </section>

          <section className="glass p-6">
            <div className="flex items-center justify-between mb-3">
              <label className="font-semibold">Subtitles</label>
              <button
                type="button"
                onClick={() => setSubtitlesEnabled((v) => !v)}
                className={`w-11 h-6 rounded-full transition-colors relative ${
                  subtitlesEnabled ? "bg-signal" : "bg-line"
                }`}
              >
                <span
                  className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-transform ${
                    subtitlesEnabled ? "translate-x-5" : "translate-x-0.5"
                  }`}
                />
              </button>
            </div>
            {subtitlesEnabled && (
              <SelectGrid items={SUBTITLE_FORMATS} selectedId={subtitleFormat} onSelect={setSubtitleFormat} />
            )}
          </section>
        </div>

        <div className="space-y-6">
          <section className="glass p-6 space-y-5 lg:sticky lg:top-24">
            <div>
              <label className="font-semibold block mb-2 text-sm">Resolution</label>
              <div className="flex gap-2">
                {(["1080p", "4k"] as const).map((r) => (
                  <button
                    key={r}
                    onClick={() => setResolution(r)}
                    className={`flex-1 rounded-lg border px-3 py-2 text-sm transition-colors ${
                      resolution === r ? "border-signal bg-signal/10" : "border-line"
                    }`}
                  >
                    {r.toUpperCase()} {r === "4k" && <span className="text-mist">(3 credits)</span>}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="font-semibold block mb-2 text-sm">Aspect ratio</label>
              <div className="flex gap-2">
                {(["16:9", "9:16"] as const).map((r) => (
                  <button
                    key={r}
                    onClick={() => setAspectRatio(r)}
                    className={`flex-1 rounded-lg border px-3 py-2 text-sm transition-colors ${
                      aspectRatio === r ? "border-signal bg-signal/10" : "border-line"
                    }`}
                  >
                    {r}
                  </button>
                ))}
              </div>
            </div>

            {error && <p className="text-sm text-red-400">{error}</p>}

            <button
              onClick={handleGenerate}
              disabled={submitting || !canAfford || dataLoading}
              className="btn-primary w-full"
              title={!canAfford ? "Not enough credits" : undefined}
            >
              {submitting ? "Starting…" : "Generate Video"}
            </button>
            {!canAfford && profile && (
              <p className="text-xs text-red-400 text-center">Not enough credits for this resolution.</p>
            )}
          </section>

          {job && (
            <section className="space-y-4">
              <ProgressPanel job={job} />
              {compositing && (
                <div className="glass p-6 space-y-3">
                  <p className="text-sm font-semibold">Assembling video on your device…</p>
                  <div className="w-full h-2 rounded-full bg-line overflow-hidden">
                    <div
                      className="h-full bg-aurora transition-all duration-300"
                      style={{ width: `${compositing.percent}%` }}
                    />
                  </div>
                  <p className="text-xs text-mist">{compositing.label}</p>
                  <p className="text-xs text-mist">
                    This runs in your browser and may take a minute or two — keep this tab open.
                  </p>
                </div>
              )}
              {job.status === "complete" && (
                <div className="glass p-4 space-y-3">
                  <video
                    src={job.video_url_4k || job.video_url_1080p || undefined}
                    controls
                    className="w-full rounded-lg"
                  />
                  <div className="flex gap-2">
                    {job.video_url_1080p && (
                      <a href={job.video_url_1080p} download className="btn-secondary flex-1 text-sm">
                        Download 1080p
                      </a>
                    )}
                    {job.video_url_4k && (
                      <a href={job.video_url_4k} download className="btn-primary flex-1 text-sm">
                        Download 4K
                      </a>
                    )}
                  </div>
                </div>
              )}
            </section>
          )}
        </div>
      </div>
    </div>
  );
}