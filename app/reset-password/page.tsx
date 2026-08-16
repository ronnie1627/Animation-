"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function ResetPasswordPage() {
  const supabase = createClient();
  const router = useRouter();

  const [ready, setReady] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    // The recovery link puts an access_token in the URL hash. The Supabase
    // client automatically parses it and establishes a session on load —
    // we just need to wait for that to happen before showing the form.
    const {
      data: { subscription }
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY" || event === "SIGNED_IN") {
        setReady(true);
      }
    });

    // Also check immediately in case the session was already established
    // by the time this component mounted.
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) setReady(true);
    });

    return () => subscription.unsubscribe();
  }, [supabase]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords don't match.");
      return;
    }

    setSaving(true);
    const { error } = await supabase.auth.updateUser({ password });
    setSaving(false);

    if (error) {
      setError(error.message);
      return;
    }

    setDone(true);
    setTimeout(() => router.push("/studio"), 1500);
  }

  if (done) {
    return (
      <div className="mx-auto max-w-md px-6 py-24 text-center">
        <h1 className="font-display text-2xl font-bold mb-3">Password updated</h1>
        <p className="text-mist">Taking you to the Studio…</p>
      </div>
    );
  }

  if (!ready) {
    return (
      <div className="mx-auto max-w-md px-6 py-24 text-center">
        <h1 className="font-display text-2xl font-bold mb-3">Verifying link…</h1>
        <p className="text-mist text-sm">
          If this takes more than a few seconds, the link may have expired — request a new
          password reset and try again.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md px-6 py-20">
      <h1 className="font-display text-3xl font-bold mb-8 text-center">Set a new password</h1>
      <form onSubmit={handleSubmit} className="glass p-8 space-y-4">
        <div>
          <label className="text-sm text-mist">New password</label>
          <input
            type="password"
            required
            minLength={6}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 w-full rounded-lg bg-ink border border-line px-4 py-2.5 outline-none focus:border-signal"
          />
        </div>
        <div>
          <label className="text-sm text-mist">Confirm password</label>
          <input
            type="password"
            required
            minLength={6}
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            className="mt-1 w-full rounded-lg bg-ink border border-line px-4 py-2.5 outline-none focus:border-signal"
          />
        </div>
        {error && <p className="text-sm text-red-400">{error}</p>}
        <button type="submit" disabled={saving} className="btn-primary w-full">
          {saving ? "Saving…" : "Update password"}
        </button>
      </form>
    </div>
  );
}
