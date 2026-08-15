# AnimeForge

Text-to-anime-video web app. Next.js 14 (App Router) + Tailwind frontend,
Supabase for auth/database/storage/edge functions.

## What actually works out of the box

- Landing page, auth (email/password + Google OAuth), Studio UI (script input,
  style/template/voice/subtitle selection, resolution/aspect ratio), Library,
  Account, and an Admin dashboard.
- The full database schema, RLS policies, storage buckets, and credit system.
- The job pipeline (`create-generation-job` → script → voice → visuals →
  composite → upscale) runs end-to-end and updates status/progress live via
  Supabase Realtime — but the actual AI generation calls inside each pipeline
  step are stubs. See "Wiring up real AI providers" below.

## 1. Supabase setup

1. Create a project at supabase.com.
2. In the SQL editor, run `supabase/migrations/0001_init.sql`.
3. In Authentication → Providers, enable Email and (optionally) Google.
4. In Authentication → URL Configuration, add your deployed site URL and
   `http://localhost:3000` as allowed redirect URLs (for `/auth/callback`).
5. Deploy the edge functions (requires the Supabase CLI):

   ```bash
   supabase login
   supabase link --project-ref your-project-ref
   supabase functions deploy create-generation-job
   supabase functions deploy generate-script-breakdown
   supabase functions deploy generate-voiceover
   supabase functions deploy generate-visuals
   supabase functions deploy composite-video
   supabase functions deploy upscale-to-4k
   supabase functions deploy admin-grant-credits
   supabase functions deploy admin-set-admin-flag
   ```

6. Each deployed function needs `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and
   `SUPABASE_SERVICE_ROLE_KEY` available as secrets (the Supabase CLI sets the
   first two automatically; add the service role key yourself):

   ```bash
   supabase secrets set SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
   ```

## 2. Make yourself an admin with unlimited credits

Sign up once through the deployed app first (so your `profiles` row exists),
then in the Supabase SQL editor run:

```sql
update public.profiles
set is_admin = true, credits = 1000000000
where id = (select id from auth.users where email = 'you@example.com');
```

Admin accounts skip the credit-deduction check entirely in
`create-generation-job` — the credit number is mostly cosmetic for admins,
but it's set very high anyway. From the in-app Admin Dashboard (`/admin`)
you can also grant credits to other users or promote them to admin.

## 3. Local development

```bash
npm install
cp .env.example .env.local   # fill in your Supabase URL + anon key
npm run dev
```

## 4. Deploy to Vercel

1. Push this folder to a new GitHub repo.
2. Import the repo in Vercel (framework preset: Next.js — auto-detected).
3. Add environment variables in Vercel Project Settings:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
4. Deploy. Add your Vercel domain to Supabase's allowed redirect URLs.

## 5. Wiring up real AI providers

The five pipeline edge functions in `supabase/functions/` each have a clearly
marked `TODO` where a real provider call needs to go:

| Function | Needs |
|---|---|
| `generate-script-breakdown` | An LLM API (e.g. Anthropic) to turn the script into a scene list |
| `generate-voiceover` | A TTS API (e.g. ElevenLabs) for narration audio + word timestamps |
| `generate-visuals` | An image/video generation API (e.g. Runway, Kling, Stable Diffusion) |
| `composite-video` | A render service (ffmpeg worker or hosted API like Shotstack/Creatomate) to assemble everything |
| `upscale-to-4k` | An upscaling API (e.g. Topaz, Real-ESRGAN) |

Keep every provider API key in Supabase secrets (`supabase secrets set`) —
never in frontend code or Vercel env vars, since these calls must only ever
happen server-side.
