"use client";

import type { GenerationJob } from "@/lib/types";

const STEPS: { key: GenerationJob["status"]; label: string }[] = [
  { key: "scripting", label: "Writing scenes" },
  { key: "voice_generating", label: "Generating voice" },
  { key: "rendering", label: "Rendering visuals" },
  { key: "compositing", label: "Compositing video" },
  { key: "upscaling", label: "Finalizing 4K export" },
  { key: "complete", label: "Complete" }
];

export default function ProgressPanel({ job }: { job: GenerationJob }) {
  const currentIndex = STEPS.findIndex((s) => s.key === job.status);

  if (job.status === "failed") {
    return (
      <div className="glass p-6 border-red-500/40">
        <p className="font-semibold text-red-400">Generation failed</p>
        <p className="text-sm text-mist mt-1">{job.error_message || "Something went wrong. Your credits were refunded."}</p>
      </div>
    );
  }

  return (
    <div className="glass p-6 space-y-4">
      <div className="w-full h-2 rounded-full bg-line overflow-hidden">
        <div
          className="h-full bg-aurora transition-all duration-500"
          style={{ width: `${job.progress_percent}%` }}
        />
      </div>
      <ul className="space-y-2">
        {STEPS.map((step, i) => (
          <li key={step.key} className="flex items-center gap-3 text-sm">
            <span
              className={`w-2 h-2 rounded-full ${
                i < currentIndex || job.status === "complete"
                  ? "bg-signal3"
                  : i === currentIndex
                  ? "bg-signal animate-pulse"
                  : "bg-line"
              }`}
            />
            <span className={i <= currentIndex ? "text-white" : "text-mist"}>{step.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
