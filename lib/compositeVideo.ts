"use client";

// NOTE: this loads ffmpeg.wasm via a <script> tag pointing at its UMD build
// on jsdelivr, rather than importing the @ffmpeg/ffmpeg npm package
// directly. The npm package's internal worker creation
// (`new Worker(new URL(...), { type: "module" })`) has a long-standing,
// still-unresolved compatibility conflict with Next.js's webpack bundler
// (see ffmpegwasm/ffmpeg.wasm issues #793, #678, #815 — ffmpeg.load()
// hangs indefinitely with no error). Loading the UMD build as a global
// script avoids that bundling path entirely.

import { fetchFile, toBlobURL } from "@ffmpeg/util";

export type SceneAsset = {
  index: number;
  narration_line: string;
  visual_url: string;
  audio_url: string;
  duration_estimate_seconds: number;
};

export type CompositeOptions = {
  aspectRatio: "16:9" | "9:16";
  subtitlesEnabled: boolean;
  onProgress?: (percent: number, label: string) => void;
};

const FFMPEG_VERSION = "0.12.10";
const FFMPEG_CORE_VERSION = "0.12.10";

function escapeForDrawtext(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/:/g, "\\:").replace(/'/g, "\u2019").replace(/%/g, "\\%");
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms / 1000}s`)), ms)
    )
  ]);
}

let umdScriptLoadPromise: Promise<void> | null = null;

function loadFFmpegUMDScript(): Promise<void> {
  if (umdScriptLoadPromise) return umdScriptLoadPromise;

  umdScriptLoadPromise = new Promise((resolve, reject) => {
    if ((window as any).FFmpegWASM) {
      resolve();
      return;
    }
    const script = document.createElement("script");
    script.src = `https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@${FFMPEG_VERSION}/dist/umd/ffmpeg.js`;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Failed to load ffmpeg.wasm UMD script from CDN"));
    document.head.appendChild(script);
  });

  return umdScriptLoadPromise;
}

export async function compositeVideo(
  scenes: SceneAsset[],
  options: CompositeOptions
): Promise<Blob> {
  const { aspectRatio, subtitlesEnabled, onProgress } = options;
  const report = (percent: number, label: string) => onProgress?.(percent, label);

  console.log("[compositeVideo] starting, scenes:", scenes.length);

  report(2, "Loading video engine…");
  await withTimeout(loadFFmpegUMDScript(), 20000, "Loading ffmpeg.wasm script");
  console.log("[compositeVideo] UMD script loaded, FFmpegWASM global:", !!(window as any).FFmpegWASM);

  const { FFmpeg } = (window as any).FFmpegWASM;
  const ffmpeg = new FFmpeg();

  ffmpeg.on("log", ({ message }: { message: string }) => {
    console.log("[ffmpeg]", message);
  });

  const baseURL = `https://cdn.jsdelivr.net/npm/@ffmpeg/core@${FFMPEG_CORE_VERSION}/dist/umd`;

  console.log("[compositeVideo] fetching core JS…");
  const coreURL = await withTimeout(
    toBlobURL(`${baseURL}/ffmpeg-core.js`, "text/javascript"),
    30000,
    "Fetching ffmpeg-core.js"
  );
  console.log("[compositeVideo] core JS fetched, fetching wasm…");

  const wasmURL = await withTimeout(
    toBlobURL(`${baseURL}/ffmpeg-core.wasm`, "application/wasm"),
    30000,
    "Fetching ffmpeg-core.wasm"
  );
  console.log("[compositeVideo] wasm fetched, calling ffmpeg.load()…");

  await withTimeout(ffmpeg.load({ coreURL, wasmURL }), 30000, "ffmpeg.load()");
  console.log("[compositeVideo] ffmpeg.load() resolved successfully");

  const [width, height] = aspectRatio === "9:16" ? [720, 1280] : [1280, 720];
  const fps = 24;

  for (let i = 0; i < scenes.length; i++) {
    const scene = scenes[i];
    report(5 + Math.round((i / scenes.length) * 25), `Downloading scene ${i + 1} assets…`);
    console.log(`[compositeVideo] downloading scene ${i} assets`);
    const imageData = await fetchFile(scene.visual_url);
    const audioData = await fetchFile(scene.audio_url);
    await ffmpeg.writeFile(`img${i}.jpg`, imageData);
    await ffmpeg.writeFile(`audio${i}.mp3`, audioData);
  }

  const sceneOutputFiles: string[] = [];

  for (let i = 0; i < scenes.length; i++) {
    const scene = scenes[i];
    report(30 + Math.round((i / scenes.length) * 45), `Rendering scene ${i + 1} of ${scenes.length}…`);
    console.log(`[compositeVideo] rendering scene ${i}`);

    const clipDuration = Math.max(scene.duration_estimate_seconds + 1.5, 3);
    const totalFrames = Math.round(clipDuration * fps);

    const zoompanFilter = `zoompan=z='min(zoom+0.0012,1.15)':d=${totalFrames}:s=${width}x${height}:fps=${fps}`;

    const subtitleFilter = subtitlesEnabled
      ? `,drawtext=text='${escapeForDrawtext(scene.narration_line)}':fontcolor=white:fontsize=${Math.round(
          height * 0.045
        )}:x=(w-text_w)/2:y=h-th-${Math.round(height * 0.08)}:box=1:boxcolor=black@0.55:boxborderw=14:line_spacing=6`
      : "";

    const outputFile = `scene_${i}.mp4`;

    await ffmpeg.exec([
      "-loop", "1", "-i", `img${i}.jpg`, "-i", `audio${i}.mp3`,
      "-vf", `${zoompanFilter}${subtitleFilter},format=yuv420p`,
      "-c:v", "libx264", "-preset", "ultrafast", "-c:a", "aac",
      "-shortest", "-r", String(fps), outputFile
    ]);

    sceneOutputFiles.push(outputFile);
  }

  report(80, "Combining scenes…");
  console.log("[compositeVideo] concatenating scenes");

  const concatListContent = sceneOutputFiles.map((f) => `file '${f}'`).join("\n");
  await ffmpeg.writeFile("concat_list.txt", concatListContent);

  await ffmpeg.exec(["-f", "concat", "-safe", "0", "-i", "concat_list.txt", "-c", "copy", "final_output.mp4"]);

  report(95, "Finishing up…");

  const outputData = await ffmpeg.readFile("final_output.mp4");
  const blob = new Blob([new Uint8Array(outputData as Uint8Array)], { type: "video/mp4" });

  console.log("[compositeVideo] done, blob size:", blob.size);
  report(100, "Done");

  return blob;
}