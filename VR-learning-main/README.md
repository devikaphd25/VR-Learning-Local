# UMES VR Classroom

UMES VR Classroom is a synchronous WebXR learning environment built with the Meta Immersive Web SDK, Three.js, Socket.IO, and Supabase. It provides a shared virtual classroom for instructors and students, an integrated Python learning lab, classroom challenges, persistent seating, and instructor result tracking.

## Database setup

The repository now contains a **complete fresh-install SQL path**. You do not need pre-existing Supabase classroom tables.

### Fresh Supabase project — run in this exact order

Open **Supabase → SQL Editor** and run:

1. `supabase/00-base-schema.sql`
   - creates `rooms`, `participants`, `quiz_questions`, and `quiz_responses`;
   - creates the core classroom/quiz RPC functions used by the browser.
2. `supabase/room-code-migration.sql`
   - adds persistent device IDs/seats;
   - creates `create_room()` and `join_latest_active_room()`.
3. `supabase/app-data-migration.sql`
   - creates `app_users` and `game_results`;
   - links participants to persistent users.
4. `supabase/weekly-content-migration.sql`
   - creates `learning_weeks`, `week_lessons`, and `week_activities`;
   - creates the three Week 1 lesson shells and the week-level game.
5. `supabase/w1-1-five-parts-content-update.sql`
6. `supabase/w1-1-d2-loading-classification-update.sql`
7. `supabase/w1-1-d3-language-ladder-update.sql`

Do not reverse the order. On a new Supabase project, `00-base-schema.sql` must be first.

### Tables

| Table | Purpose |
| --- | --- |
| `rooms` | Classroom sessions and presentation/quiz state. |
| `participants` | Instructor/students in a room, device identity, and seat. |
| `quiz_questions` | Multiple-choice challenge questions. |
| `quiz_responses` | Student answers and grading results. |
| `app_users` | Persistent application identities. |
| `game_results` | Persistent lab/game results. |
| `learning_weeks` | Curriculum weeks. |
| `week_lessons` | Lessons belonging to each week. |
| `week_activities` | Presentation, challenge, game, and briefing activities. |

### Environment files

Copy `.env.template` to the local environment files required by the project. Never commit real Supabase secrets.

Browser-safe values belong in `.env.development`:

```env
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_PUBLISHABLE_KEY
VITE_PROFESSOR_VERIFICATION_CODE=YOUR_SIX_DIGIT_PIN
```

Server-only values belong in `.env.server`:

```env
SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_SECRET_KEY=YOUR_SERVER_SECRET_KEY
```

## Run locally

Use a Node.js version supported by `package.json` (for example, Node.js 22.12+ within version 22). Complete the database and environment setup above, then run these commands from the repository root:

```bash
npm install
npm run dev:full
```

**Use `npm run dev:full` for normal classroom development.** It starts both the IWSDK-managed Vite frontend and the Node/Socket.IO backend. Open the frontend URL printed in the terminal. The backend uses port 3001 by default; the Vite configuration proxies `/api` and `/socket.io` to it.

### What each npm script does

Run scripts with `npm run <name>`. `npm install` installs dependencies and is not a package script.

| Command | Purpose / when to use it |
| --- | --- |
| `npm run dev:full` | Start the frontend and backend together in one terminal. Recommended for running the complete classroom locally. |
| `npm run dev` | Start the frontend through the IWSDK development manager in the foreground. Run the backend separately when using classroom features. |
| `npm run dev:runtime` | Start Vite directly. Use when you specifically need the frontend without the IWSDK CLI lifecycle manager. Does not start the backend. |
| `npm run dev:server` | Start the Node/Express/Socket.IO backend from `server.ts`, loading `.env.server` and using `tsx` to run TypeScript. Requires the configured Supabase connection. |
| `npm run dev:status` | Check the status of the IWSDK-managed development service. This does not check the separate classroom backend. |
| `npm run dev:down` | Stop the IWSDK-managed development service. Stop a separately running backend or direct Vite process in its own terminal. |
| `npm run reference:status` | Inspect the status of the IWSDK reference tooling/cache. Optional tooling diagnostic, not an application startup command. |
| `npm run reference:warmup` | Download and initialize the external IWSDK reference corpus and model caches. Use before reference-tool queries; requires network access for uncached downloads. |
| `npm run typecheck` | Run both client and server TypeScript checks without generating output files. Use before submitting code changes. |
| `npm run typecheck:client` | Check frontend TypeScript using `tsconfig.json`. |
| `npm run typecheck:server` | Check backend TypeScript using `tsconfig.server.json`. |
| `npm run build` | Create the frontend production bundle in `dist/` using Vite. Does not start the app or replace the separate TypeScript checks. |
| `npm run preview` | Serve the frontend build locally for inspection after `npm run build`. Classroom features still require the backend and appropriate environment configuration. This is a local preview, not a production deployment command. |

### Run frontend and backend separately

Use two terminals when you want separate logs or need to restart the backend independently. This is an alternative to `dev:full`; do not run both approaches at the same time.

Terminal 1:

```bash
npm run dev
```

Terminal 2:

```bash
npm run dev:server
```

Stop foreground commands with **Ctrl+C**. The backend script does not watch for file changes: after editing server code or `.env.server`, stop and restart `dev:server` (or restart `dev:full` if you started both together). Refresh the instructor and student pages after a backend restart.

### Check changes and preview a build

```bash
npm run typecheck
npm run build
npm run preview
```

`preview` uses Vite's production mode by default. Ensure the required browser environment values are available for the production build (for example, in `.env.production`); values stored only in `.env.development` are for development mode.

## Current workflow

1. Instructor selects **Professor** and enters the configured verification PIN.
2. The application creates the active classroom.
3. Students select **Student** and join the latest active room.
4. Each headset receives a persistent identity, name, and fixed seat.
5. The instructor can run classroom activities, monitor students/results, return students from the lab, and end the class.

## Important database note

The SQL files in `supabase/` are designed so a teammate can reproduce the database from an empty Supabase project. If the hosted database contains experimental tables/functions, do not rely on them unless their definitions are committed to this folder.
