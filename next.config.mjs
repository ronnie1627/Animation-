/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [{ protocol: "https", hostname: "**" }]
  },
  // ffmpeg.wasm (used for client-side video compositing on /studio) needs
  // "cross-origin isolation" enabled to use SharedArrayBuffer, even in its
  // single-threaded build. Scoped to just /studio so the rest of the site
  // (which loads cross-origin resources like Google Fonts) isn't affected.
  // COEP "credentialless" (rather than "require-corp") is used so it
  // doesn't require every cross-origin resource we fetch — like images and
  // audio from Supabase Storage — to send special CORP headers themselves.
  async headers() {
    return [
      {
        source: "/studio",
        headers: [
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "Cross-Origin-Embedder-Policy", value: "credentialless" }
        ]
      }
    ];
  }
};
export default nextConfig;
