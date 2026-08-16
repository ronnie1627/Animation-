"use client";

import { useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

export default function ForgotPasswordPage() {
  const supabase = createClient();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`
    });

    setLoading(false);

    if (error) {
      setError(error.message);
      return;
    }

    setSent(true);
  }

  if (sent) {
    return (
      <div className="mx-auto max-w-md px-6 py-24 text-center">
        <h1 className="font-display text-2xl font-bold mb-3">Check your inbox</h1>
        <p className="text-mist">
          If an account exists for {email}, a reset link is on its way. Click it as soon as it
          arrives — the link expires after a while.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md px-6 py-20">
      <h1 className="font-display text-3xl font-bold mb-8 text-center">Reset your password</h1>
      <form onSubmit={handleSubmit} className="glass p-8 space-y-4">
        <div>
          <label className="text-sm text-mist">Email</label>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 w-full rounded-lg bg-ink border border-line px-4 py-2.5 outline-none focus:border-signal"
          />
        </div>
        {error && <p className="text-sm text-red-400">{error}</p>}
        <button type="submit" disabled={loading} className="btn-primary w-full">
          {loading ? "Sending…" : "Send reset link"}
        </button>
        <p className="text-sm text-mist text-center">
          <Link href="/login" className="text-white underline">
            Back to login
          </Link>
        </p>
      </form>
    </div>
  );
}
