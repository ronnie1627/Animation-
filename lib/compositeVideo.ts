"use client";

// Client-side video compositor using ffmpeg.wasm. Runs entirely in the
// browser since Supabase edge functions can't do real video encoding.
//
// For each scene: downloads its AI-generated image + narration audio,
// applies a pan/zoom ("Ken Burns") effect sized to the audio's duration,
// and burns in the narration line as a subtitle. All scene clips are then
// concatenated into the final video.

import { FFmpeg } from "@ffmpeg/ffmpeg";
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

const FFMPEG_CORE_VERSION = "0.12.6";

function escapeForDrawtext(text: string): string {
  // ffmpeg's drawtext filter treats these characters specially inside its
  // own mini-syntax, so they need escaping or the filter graph breaks.
  return text
    .replace(/\\/g, "\\\\")
    .replace(/:/g, "\\:")
    .replace(/'/g, "\u2019") // swap apostrophes for a safe lookalike char
    .replace(/%/g, "\\%");
}

export async function compositeVideo(
  scenes: SceneAsset[],
  options: CompositeOptions
): Promise<Blob> {
  const { aspectRatio, subtitlesEnabled, onProgress } = options;
  const report = (percent: number, label: string) => onProgress?.(percent, label);

  const ffmpeg = new FFmpeg();

  report(2, "Loading video engine…");
  const baseURL = `https://unpkg.com/@ffmpeg/core@${FFMPEG_CORE_VERSION}/dist/esm`;
  await ffmpeg.load({
    coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, "text/javascript"),
    wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, "application/wasm")
  });

  const [width, height] = aspectRatio === "9:16" ? [720, 1280] : [1280, 720];
  const fps = 24;

  // Download every scene's image + audio and write them into ffmpeg's
  // virtual filesystem.
  for (let i = 0; i < scenes.length; i++) {
    const scene = scenes[i];
    report(5 + Math.round((i / scenes.length) * 25), `Downloading scene ${i + 1} assets…`);
    const imageData = await fetchFile(scene.visual_url);
    const audioData = await fetchFile(scene.audio_url);
    await ffmpeg.writeFile(`img${i}.jpg`, imageData);
    await ffmpeg.writeFile(`audio${i}.mp3`, audioData);
  }

  const sceneOutputFiles: string[] = [];

  for (let i = 0; i < scenes.length; i++) {
    const scene = scenes[i];
    report(30 + Math.round((i / scenes.length) * 45), `Rendering scene ${i + 1} of ${scenes.length}…`);

    // A little buffer beyond the estimated duration so -shortest trims to
    // the real audio length rather than the video cutting audio short.
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
      "-loop",
      "1",
      "-i",
      `img${i}.jpg`,
      "-i",
      `audio${i}.mp3`,
      "-vf",
      `${zoompanFilter}${subtitleFilter},format=yuv420p`,
      "-c:v",
      "libx264",
      "-preset",
      "ultrafast",
      "-c:a",
      "aac",
      "-shortest",
      "-r",
      String(fps),
      outputFile
    ]);

    sceneOutputFiles.push(outputFile);
  }

  report(80, "Combining scenes…");

  const concatListContent = sceneOutputFiles.map((f) => `file '${f}'`).join("\n");
  await ffmpeg.writeFile("concat_list.txt", concatListContent);

  await ffmpeg.exec([
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    "concat_list.txt",
    "-c",
    "copy",
    "final_output.mp4"
  ]);

  report(95, "Finishing up…");

  const outputData = await ffmpeg.readFile("final_output.mp4");
  const blob = new Blob([new Uint8Array(outputData as Uint8Array)], { type: "video/mp4" });

  report(100, "Done");

  return blob;
}