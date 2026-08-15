"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import VideoCard from "@/components/VideoCard";
import type { GenerationJob, Project } from "@/lib/types";

export default function LibraryPage() {
  const supabase = createClient();
  const [rows, setRows] = useState<{ project: Project; job: GenerationJob }[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    const {
      data: { user }
    } = await supabase.auth.getUser();
    if (!user) {
      setLoading(false);
      return;
    }

    const { data: projects } = await supabase
      .from("projects")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });

    if (!projects) {
      setLoading(false);
      return;
    }

    const { data: jobs } = await supabase
      .from("generation_jobs")
      .select("*")
      .in("project_id", projects.map((p) => p.id));

    const merged = projects
      .map((project) => {
        const job = jobs?.find((j) => j.project_id === project.id);
        return job ? { project, job } : null;
      })
      .filter(Boolean) as { project: Project; job: GenerationJob }[];

    setRows(merged);
    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleDelete(projectId: string) {
    await supabase.from("projects").delete().eq("id", projectId);
    setRows((r) => r.filter((row) => row.project.id !== projectId));
  }

  return (
    <div className="mx-auto max-w-6xl px-6 py-12">
      <h1 className="font-display text-3xl font-bold mb-8">Library</h1>

      {loading && <p className="text-mist">Loading…</p>}

      {!loading && rows.length === 0 && (
        <div className="glass p-12 text-center">
          <p className="font-semibold">No videos yet</p>
          <p className="text-mist text-sm mt-1">Head to the Studio to generate your first one.</p>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        {rows.map(({ project, job }) => (
          <VideoCard key={project.id} project={project} job={job} onDelete={handleDelete} />
        ))}
      </div>
    </div>
  );
}
