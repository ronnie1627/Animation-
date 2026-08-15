"use client";

import type { GenerationJob, Project } from "@/lib/types";

export default function VideoCard({
  project,
  job,
  onDelete
}: {
  project: Project;
  job: GenerationJob;
  onDelete: (projectId: string) => void;
}) {
  return (
    <div className="glass overflow-hidden">
      <div className="aspect-video bg-gradient-to-br from-signal/20 via-signal2/20 to-signal3/20 flex items-center justify-center">
        {job.thumbnail_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={job.thumbnail_url} alt={project.title || "Video thumbnail"} className="w-full h-full object-cover" />
        ) : (
          <span className="text-xs text-mist">{job.status}</span>
        )}
      </div>
      <div className="p-4">
        <p className="font-semibold text-sm truncate">{project.title || "Untitled video"}</p>
        <p className="text-xs text-mist mt-1">
          {new Date(project.created_at).toLocaleDateString()} · {job.duration_seconds || "--"}s
        </p>
        <div className="flex gap-2 mt-3">
          {job.video_url_1080p && (
            <a href={job.video_url_1080p} download className="btn-secondary flex-1 !py-1.5 text-xs">
              Download
            </a>
          )}
          <button onClick={() => onDelete(project.id)} className="btn-secondary !py-1.5 text-xs !px-3">
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}
