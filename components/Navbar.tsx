"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Profile } from "@/lib/types";

export default function Navbar() {
  const supabase = createClient();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    async function load() {
      const {
        data: { user }
      } = await supabase.auth.getUser();

      if (!user) {
        if (mounted) {
          setProfile(null);
          setLoading(false);
        }
        return;
      }

      const { data } = await supabase.from("profiles").select("*").eq("id", user.id).single();
      if (mounted) {
        setProfile(data as Profile);
        setLoading(false);
      }
    }

    load();

    const { data: sub } = supabase.auth.onAuthStateChange(() => load());
    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, [supabase]);

  async function signOut() {
    await supabase.auth.signOut();
    window.location.href = "/";
  }

  return (
    <header className="fixed top-0 inset-x-0 z-50 border-b border-line/60 bg-ink/80 backdrop-blur-xl">
      <div className="mx-auto max-w-6xl px-6 h-20 flex items-center justify-between">
        <Link href="/" className="font-display text-xl font-bold tracking-tight">
          Anime<span className="aurora-text">Forge</span>
        </Link>

        <nav className="hidden md:flex items-center gap-8 text-sm text-mist">
          <Link href="/studio" className="hover:text-white transition-colors">
            Studio
          </Link>
          <Link href="/library" className="hover:text-white transition-colors">
            Library
          </Link>
          {profile?.is_admin && (
            <Link href="/admin" className="hover:text-white transition-colors">
              Admin
            </Link>
          )}
        </nav>

        <div className="flex items-center gap-4">
          {!loading && profile && (
            <span className="hidden sm:inline text-xs text-mist border border-line rounded-full px-3 py-1.5">
              {profile.credits.toLocaleString()} credits
            </span>
          )}
          {!loading && profile ? (
            <>
              <Link href="/account" className="text-sm text-mist hover:text-white transition-colors">
                Account
              </Link>
              <button onClick={signOut} className="btn-secondary !px-4 !py-2 text-sm">
                Sign out
              </button>
            </>
          ) : !loading ? (
            <>
              <Link href="/login" className="text-sm text-mist hover:text-white transition-colors">
                Log in
              </Link>
              <Link href="/signup" className="btn-primary !px-4 !py-2 text-sm">
                Start Creating
              </Link>
            </>
          ) : null}
        </div>
      </div>
    </header>
  );
}
