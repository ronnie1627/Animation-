export const FALLBACK_STYLES = [
  { id: "shonen", name: "Shonen Action", description: "Bold linework, dynamic energy" },
  { id: "shoujo", name: "Shoujo Soft", description: "Pastel, dreamy, emotional" },
  { id: "cyberpunk", name: "Cyberpunk Neon", description: "Dark, neon-lit, futuristic" },
  { id: "classic", name: "Studio Classic", description: "Painterly, nostalgic 90s look" },
  { id: "darkfantasy", name: "Dark Fantasy", description: "Moody, gothic, high-contrast" },
  { id: "chibi", name: "Chibi/Comedy", description: "Cute, exaggerated, playful" },
  { id: "3dmodel", name: "3D Model Anime", description: "Stylized 3D-rendered CGI look" },
  { id: "cinematic", name: "Anime Cinematic", description: "Film-grade lighting, wide shots" },
  { id: "comicbook", name: "Comic Book", description: "Ink outlines, halftone shading" },
  { id: "realistic", name: "Realistic Anime", description: "Semi-realistic proportions & lighting" },
  { id: "whimsical", name: "Whimsical", description: "Storybook illustration, soft colors" }
];

export const FALLBACK_TEMPLATES = [
  { id: "epic", name: "Epic Trailer", description: "Deep dramatic narrator, bold captions, punchy pacing", narrator_tone: "dramatic", subtitle_format: "bold_cinematic", music_mood: "building_epic", pacing: "fast" },
  { id: "drama", name: "Emotional Drama", description: "Soft warm narrator, minimal fade captions", narrator_tone: "calm", subtitle_format: "fade_line", music_mood: "ambient_soft", pacing: "slow" },
  { id: "comedy", name: "Comedy Skit", description: "Energetic narrator, bouncy captions", narrator_tone: "energetic", subtitle_format: "karaoke", music_mood: "upbeat", pacing: "fast" },
  { id: "doc", name: "Documentary", description: "Calm authoritative narrator, clean captions", narrator_tone: "calm", subtitle_format: "minimal_clean", music_mood: "ambient_soft", pacing: "steady" },
  { id: "mystery", name: "Mysterious/Whisper", description: "Hushed suspenseful narrator, word-reveal captions", narrator_tone: "whisper", subtitle_format: "karaoke", music_mood: "tense_low", pacing: "steady" },
  { id: "custom", name: "Custom", description: "Configure everything manually", narrator_tone: "calm", subtitle_format: "minimal_clean", music_mood: "ambient_soft", pacing: "steady" }
];
