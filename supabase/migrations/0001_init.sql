-- =========================================================
-- AnimeForge initial schema
-- =========================================================

create extension if not exists "uuid-ossp";

-- ---------- profiles ----------
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  avatar_url text,
  credits bigint not null default 3,
  plan text not null default 'free',
  is_admin boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "profiles: select own" on public.profiles
  for select using (auth.uid() = id);

-- Users may update their own row, but NEVER their own credits or admin flag.
create policy "profiles: update own (safe columns)" on public.profiles
  for update using (auth.uid() = id)
  with check (
    auth.uid() = id
    and credits = (select credits from public.profiles where id = auth.uid())
    and is_admin = (select is_admin from public.profiles where id = auth.uid())
  );

-- Auto-create a profile row whenever a new auth user signs up.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name, credits, is_admin)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)),
    3,
    false
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ---------- styles ----------
create table public.styles (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  description text not null,
  thumbnail_url text,
  sort_order int not null default 0
);

alter table public.styles enable row level security;
create policy "styles: public read" on public.styles for select using (true);

insert into public.styles (name, description, sort_order) values
  ('Shonen Action', 'Bold linework, dynamic energy', 1),
  ('Shoujo Soft', 'Pastel, dreamy, emotional', 2),
  ('Cyberpunk Neon', 'Dark neon-lit futuristic', 3),
  ('Studio Classic', 'Painterly, nostalgic 90s anime look', 4),
  ('Dark Fantasy', 'Moody, gothic, high-contrast', 5),
  ('Chibi/Comedy', 'Cute, exaggerated, playful', 6),
  ('3D Model Anime', 'Stylized 3D-rendered CGI look', 7),
  ('Anime Cinematic', 'Film-grade lighting, wide shots, camera framing', 8),
  ('Comic Book', 'Bold ink outlines, halftone shading', 9),
  ('Realistic Anime', 'Semi-realistic proportions and lighting', 10),
  ('Whimsical', 'Storybook/fairytale illustration feel', 11);

-- ---------- templates ----------
create table public.templates (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  description text not null,
  narrator_tone text not null,
  subtitle_format text not null,
  music_mood text not null,
  pacing text not null,
  sort_order int not null default 0
);

alter table public.templates enable row level security;
create policy "templates: public read" on public.templates for select using (true);

insert into public.templates (name, description, narrator_tone, subtitle_format, music_mood, pacing, sort_order) values
  ('Epic Trailer', 'Deep dramatic narrator, bold captions, punchy pacing', 'dramatic', 'bold_cinematic', 'building_epic', 'fast', 1),
  ('Emotional Drama', 'Soft warm narrator, minimal fade captions', 'calm', 'fade_line', 'ambient_soft', 'slow', 2),
  ('Comedy Skit', 'Energetic narrator, bouncy captions', 'energetic', 'karaoke', 'upbeat', 'fast', 3),
  ('Documentary', 'Calm authoritative narrator, clean captions', 'calm', 'minimal_clean', 'ambient_soft', 'steady', 4),
  ('Mysterious/Whisper', 'Hushed suspenseful narrator, word-reveal captions', 'whisper', 'karaoke', 'tense_low', 'steady', 5),
  ('Custom', 'Configure everything manually', 'calm', 'minimal_clean', 'ambient_soft', 'steady', 6);

-- ---------- voices ----------
create table public.voices (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  gender text not null,
  language text not null default 'en',
  sample_audio_url text,
  provider_voice_id text
);

alter table public.voices enable row level security;
create policy "voices: public read" on public.voices for select using (true);

insert into public.voices (name, gender, language) values
  ('Warm Female', 'female', 'en'),
  ('Deep Male', 'male', 'en'),
  ('Youthful Narrator', 'neutral', 'en'),
  ('Dramatic', 'neutral', 'en');

-- ---------- projects ----------
create table public.projects (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  title text,
  script_text text not null,
  style_id uuid references public.styles(id),
  voice_id uuid references public.voices(id),
  template_id uuid references public.templates(id),
  narrator_tone text not null default 'calm',
  subtitle_format text not null default 'minimal_clean',
  resolution text not null default '1080p' check (resolution in ('1080p', '4k')),
  aspect_ratio text not null default '16:9' check (aspect_ratio in ('16:9', '9:16')),
  subtitles_enabled boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.projects enable row level security;

create policy "projects: select own" on public.projects for select using (auth.uid() = user_id);
create policy "projects: insert own" on public.projects for insert with check (auth.uid() = user_id);
create policy "projects: delete own" on public.projects for delete using (auth.uid() = user_id);

-- ---------- generation_jobs ----------
create table public.generation_jobs (
  id uuid primary key default uuid_generate_v4(),
  project_id uuid not null references public.projects(id) on delete cascade,
  status text not null default 'queued' check (
    status in ('queued','scripting','voice_generating','rendering','compositing','upscaling','complete','failed')
  ),
  progress_percent int not null default 0,
  error_message text,
  video_url_1080p text,
  video_url_4k text,
  thumbnail_url text,
  duration_seconds int,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.generation_jobs enable row level security;

create policy "jobs: select own" on public.generation_jobs for select using (
  exists (select 1 from public.projects p where p.id = project_id and p.user_id = auth.uid())
);

-- Inserts/updates to jobs happen only via edge functions using the service role key,
-- which bypasses RLS — no direct client insert/update policy is defined on purpose.

alter publication supabase_realtime add table public.generation_jobs;

-- ---------- credit_transactions ----------
create table public.credit_transactions (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  amount bigint not null,
  reason text not null,
  project_id uuid references public.projects(id),
  created_at timestamptz not null default now()
);

alter table public.credit_transactions enable row level security;
create policy "credit_transactions: select own" on public.credit_transactions
  for select using (auth.uid() = user_id);

-- =========================================================
-- Storage buckets
-- =========================================================
insert into storage.buckets (id, name, public) values
  ('video-exports', 'video-exports', true),
  ('thumbnails', 'thumbnails', true),
  ('style-previews', 'style-previews', true),
  ('voice-samples', 'voice-samples', true)
on conflict (id) do nothing;

create policy "video-exports: public read" on storage.objects
  for select using (bucket_id = 'video-exports');
create policy "thumbnails: public read" on storage.objects
  for select using (bucket_id = 'thumbnails');

-- =========================================================
-- Make yourself an admin with a very large credit balance.
-- Run this AFTER you've signed up once through the app, so your
-- profile row already exists. Replace the email below with your own.
-- =========================================================
-- update public.profiles
-- set is_admin = true, credits = 1000000000
-- where id = (select id from auth.users where email = 'you@example.com');
