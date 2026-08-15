"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { GenerationJob, Profile } from "@/lib/types";

export default function AdminPage() {
  const supabase = createClient();
  const [me, setMe] = useState<Profile | null>(null);
  const [users, setUsers] = useState<Profile[]>([]);
  const [jobs, setJobs] = useState<GenerationJob[]>([]);
  const [grantAmount, setGrantAmount] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const {
      data: { user }
    } = await supabase.auth.getUser();
    if (!user) {
      setLoading(false);
      return;
    }
    const { data: profile } = await supabase.from("profiles").select("*").eq("id", user.id).single();
    setMe(profile as Profile);

    if ((profile as Profile)?.is_admin) {
      const { data: allUsers } = await supabase
        .from("profiles")
        .select("*")
        .order("created_at", { ascending: false });
      setUsers((allUsers as Profile[]) || []);

      const { data: allJobs } = await supabase
        .from("generation_jobs")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(50);
      setJobs((allJobs as GenerationJob[]) || []);
    }
    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function grantCredits(userId: string) {
    const amount = Number(grantAmount[userId] || 0);
    if (!amount) return;
    setNotice(null);

    const { error } = await supabase.functions.invoke("admin-grant-credits", {
      body: { user_id: userId, amount }
    });

    if (error) {
      setNotice(`Failed to grant credits: ${error.message}`);
      return;
    }
    setNotice("Credits granted.");
    load();
  }

  async function toggleAdmin(userId: string, current: boolean) {
    const { error } = await supabase.functions.invoke("admin-set-admin-flag", {
      body: { user_id: userId, is_admin: !current }
    });
    if (error) {
      setNotice(`Failed to update admin flag: ${error.message}`);
      return;
    }
    load();
  }

  if (loading) return <div className="mx-auto max-w-6xl px-6 py-12 text-mist">Loading…</div>;

  if (!me?.is_admin) {
    return (
      <div className="mx-auto max-w-6xl px-6 py-12">
        <p className="text-mist">You don't have access to this page.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-6 py-12 space-y-10">
      <div>
        <h1 className="font-display text-3xl font-bold">Admin Dashboard</h1>
        <p className="text-mist text-sm mt-1">
          Signed in as {me.display_name} ·{" "}
          <span className="aurora-text font-semibold">
            {me.credits.toLocaleString()} credits (admin — never deducted)
          </span>
        </p>
      </div>

      {notice && <p className="text-sm text-signal3">{notice}</p>}

      <section>
        <h2 className="font-display text-xl font-bold mb-4">Users</h2>
        <div className="glass overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-mist border-b border-line">
                <th className="p-4">Name</th>
                <th className="p-4">Plan</th>
                <th className="p-4">Credits</th>
                <th className="p-4">Admin</th>
                <th className="p-4">Grant credits</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-b border-line/50">
                  <td className="p-4">{u.display_name || u.id.slice(0, 8)}</td>
                  <td className="p-4 capitalize">{u.plan}</td>
                  <td className="p-4">{u.is_admin ? "Unlimited" : u.credits.toLocaleString()}</td>
                  <td className="p-4">
                    <button
                      onClick={() => toggleAdmin(u.id, u.is_admin)}
                      className={`text-xs rounded-full px-3 py-1 border ${
                        u.is_admin ? "border-signal bg-signal/10" : "border-line"
                      }`}
                    >
                      {u.is_admin ? "Admin" : "Make admin"}
                    </button>
                  </td>
                  <td className="p-4">
                    <div className="flex gap-2">
                      <input
                        type="number"
                        placeholder="Amount"
                        value={grantAmount[u.id] || ""}
                        onChange={(e) => setGrantAmount((g) => ({ ...g, [u.id]: e.target.value }))}
                        className="w-24 rounded-lg bg-ink border border-line px-2 py-1"
                      />
                      <button onClick={() => grantCredits(u.id)} className="btn-secondary !py-1 !px-3 text-xs">
                        Grant
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="font-display text-xl font-bold mb-4">Recent generation jobs</h2>
        <div className="glass overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-mist border-b border-line">
                <th className="p-4">Job</th>
                <th className="p-4">Status</th>
                <th className="p-4">Progress</th>
                <th className="p-4">Created</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((j) => (
                <tr key={j.id} className="border-b border-line/50">
                  <td className="p-4">{j.id.slice(0, 8)}</td>
                  <td className="p-4">{j.status}</td>
                  <td className="p-4">{j.progress_percent}%</td>
                  <td className="p-4">{new Date(j.created_at).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
