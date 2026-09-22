# UMES VR Classroom — Base44 Dev Environment

## Project overview

WebXR synchronous VR classroom (Meta Immersive Web SDK + Three.js + Socket.IO + Supabase).
- **Frontend**: Vite dev server on port 8081, entry `index.html` → `src/index.ts`. Uses `@iwsdk/vite-plugin-dev` (Quest emulator) and `@iwsdk/vite-plugin-uikitml` (compiles `ui/` → `public/ui/`).
- **Backend**: Node/Express/Socket.IO server from `server.ts` on port 3001, run with `tsx`.
- **Database**: Supabase (external cloud PostgreSQL). The backend throws on boot without `SUPABASE_URL` / `SUPABASE_SECRET_KEY`. The SQL migration files in `supabase/` must be applied to the Supabase project in order (see README).

## Architecture in the sandbox

Single compose service (`docker-compose.base44.yml`) runs both the frontend and backend in one container so the Vite proxy (`/api` and `/socket.io` → `localhost:3001`) works without cross-container networking. Host port 3000 maps to the Vite dev server's port 8081.

## Key setup decisions

- **Socket.IO URL**: `src/network/socket.ts` connects via `window.location.origin` (same origin) so the Vite proxy handles routing. The original code hardcoded `http://<host>:3001` which only works when port 3001 is directly reachable.
- **mkcert**: Disabled by default (conditional on `VITE_USE_MKCERT=true`) because HTTPS from the dev server breaks the preview's HTTP proxy. Set `VITE_USE_MKCERT=true` for local HTTPS testing with a headset.
- **Env files**: `.env.base44-defaults` holds placeholder values so the app boots without real credentials. Real Supabase credentials are delivered via `/run/base44/app.env` (platform-managed, listed last in compose `env_file` so it always wins).

## Required external credentials

All five are in `.base44/environment.json` and generated as development placeholders until the user provides real values:
- `VITE_SUPABASE_URL` / `SUPABASE_URL` — same Supabase project URL
- `VITE_SUPABASE_ANON_KEY` — Supabase anon public key
- `SUPABASE_SECRET_KEY` — Supabase service_role key
- `VITE_PROFESSOR_VERIFICATION_CODE` — 6-digit instructor login PIN

## How to verify

```bash
docker compose -f docker-compose.base44.yml up -d --build
docker compose -f docker-compose.base44.yml logs -f app
curl -s http://localhost:3000 | head -20   # should serve index.html
```

The frontend renders the VR scene + login panel even without the backend. The backend requires real Supabase credentials to start (it queries `app_users` on boot). Without them it crashes silently in the background while the frontend continues.

## npm scripts

- `npm run dev:runtime` — Vite directly (used in compose)
- `npm run dev:server` — backend with `tsx` (uses `--env-file=.env.server`; compose runs without `--env-file` and relies on container env)
- `npm run dev:full` — both via `concurrently` (local dev alternative)
- `npm run typecheck` — client + server TypeScript checks
