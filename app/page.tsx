import Link from "next/link";
import { FALLBACK_STYLES } from "@/lib/styles-data";

export default function LandingPage() {
  return (
    <div>
      <section className="mx-auto max-w-6xl px-6 pt-20 pb-28 text-center">
        <span className="inline-block text-xs tracking-widest uppercase text-mist border border-line rounded-full px-4 py-1.5 mb-8">
          Script to screen, in under a minute
        </span>
        <h1 className="font-display text-5xl md:text-7xl font-bold leading-[1.05] tracking-tight">
          Turn your story into
          <br />
          <span className="aurora-text">anime.</span>
        </h1>
        <p className="mt-6 text-lg text-mist max-w-xl mx-auto">
          Write a scene, pick an art style, and get a fully narrated, subtitled anime-style
          video — rendered up to 4K.
        </p>
        <div className="mt-10 flex items-center justify-center gap-4">
          <Link href="/signup" className="btn-primary">
            Start Creating
          </Link>
          <Link href="/studio" className="btn-secondary">
            Open Studio
          </Link>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 pb-24">
        <h2 className="font-display text-2xl font-bold mb-6">Pick your world</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {FALLBACK_STYLES.map((s) => (
            <div key={s.id} className="glass p-5 hover:border-signal/50 transition-colors">
              <div className="aspect-video rounded-xl mb-4 bg-gradient-to-br from-signal/20 via-signal2/20 to-signal3/20" />
              <p className="font-semibold">{s.name}</p>
              <p className="text-sm text-mist mt-1">{s.description}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 pb-28 grid md:grid-cols-3 gap-6">
        {[
          { step: "Write", body: "Drop in your story or script — a few sentences is enough." },
          { step: "Style", body: "Choose an anime style, a narrator tone, and a caption format." },
          { step: "Generate", body: "Get a rendered, narrated, subtitled video ready to download." }
        ].map((item) => (
          <div key={item.step} className="glass p-6">
            <p className="font-display font-bold text-lg aurora-text">{item.step}</p>
            <p className="text-mist mt-2 text-sm">{item.body}</p>
          </div>
        ))}
      </section>
    </div>
  );
}
