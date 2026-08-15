"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Profile } from "@/lib/types";

export default function AccountPage() {
  const supabase = createClient();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) return;
      const { data } = await supabase.from("profiles").select("*").eq("id", user.id).single();
      setProfile(data as Profile);
      setDisplayName((data as Profile)?.display_name || "");
    });
  }, [supabase]);

  async function save() {
    if (!profile) return;
    setSaving(true);
    await supabase.from("profiles").update({ display_name: displayName }).eq("id", profile.id);
    setSaving(false);
  }

  if (!profile) return <div className="mx-auto max-w-2xl px-6 py-12 text-mist">Loading…</div>;

  return (
    <div className="mx-auto max-w-2xl px-6 py-12 space-y-8">
      <h1 className="font-display text-3xl font-bold">Account</h1>

      <section className="glass p-6 space-y-4">
        <div>
          <label className="text-sm text-mist">Display name</label>
          <input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            className="mt-1 w-full rounded-lg bg-ink border border-line px-4 py-2.5 outline-none focus:border-signal"
          />
        </div>
        <button onClick={save} disabled={saving} className="btn-primary">
          {saving ? "Saving…" : "Save changes"}
        </button>
      </section>

      <section className="glass p-6">
        <p className="text-sm text-mist">Plan</p>
        <p className="font-semibold capitalize">{profile.plan}</p>
        <p className="text-sm text-mist mt-4">Credits</p>
        <p className="font-semibold">{profile.is_admin ? "Unlimited (Admin)" : profile.credits.toLocaleString()}</p>
      </section>
    </div>
  );
}
