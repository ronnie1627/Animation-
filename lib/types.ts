export type Profile = {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
  credits: number;
  plan: string;
  is_admin: boolean;
  created_at: string;
};

export type Style = {
  id: string;
  name: string;
  description: string;
  thumbnail_url: string | null;
  sort_order: number;
};

export type Template = {
  id: string;
  name: string;
  description: string;
  narrator_tone: string;
  subtitle_format: string;
  music_mood: string;
  pacing: string;
  sort_order: number;
};

export type Voice = {
  id: string;
  name: string;
  gender: string;
  language: string;
  sample_audio_url: string | null;
};

export type GenerationJob = {
  id: string;
  project_id: string;
  status:
    | "queued"
    | "scripting"
    | "voice_generating"
    | "rendering"
    | "compositing"
    | "upscaling"
    | "complete"
    | "failed";
  progress_percent: number;
  error_message: string | null;
  video_url_1080p: string | null;
  video_url_4k: string | null;
  thumbnail_url: string | null;
  duration_seconds: number | null;
  scenes_data: unknown | null;
  created_at: string;
  updated_at: string;
};

export type Project = {
  id: string;
  user_id: string;
  title: string | null;
  script_text: string;
  style_id: string;
  voice_id: string;
  template_id: string | null;
  narrator_tone: string;
  subtitle_format: string;
  resolution: "1080p" | "4k";
  aspect_ratio: "16:9" | "9:16";
  subtitles_enabled: boolean;
  created_at: string;
};