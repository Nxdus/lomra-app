# lomra-app

## Google Sign-In

Google Sign-In uses Better Auth in the NestJS backend, with PostgreSQL sessions
and a same-origin Next.js proxy at `/api/auth`. Google credentials stay in
`apps/backend/.env` and must never use a `NEXT_PUBLIC_` variable.

Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `BETTER_AUTH_URL` (locally
`http://localhost:3000`), and a random `BETTER_AUTH_SECRET` of at least 32
characters. Keep this secret stable: it also derives the encryption identity
for each account's saved API keys. Run `bun run db:migrate` in `apps/backend`,
then start the backend and frontend. The backend requires these variables.

In the Google Cloud OAuth client, authorize `http://localhost:3000` as a
JavaScript origin and `http://localhost:3000/api/auth/callback/google` as the
redirect URI. Use the actual HTTPS origin and matching callback in production,
and add test users while Google's consent screen is in Testing mode.

Click **Sign in with Google** at the top right. Chats, API keys, canvas files,
layout, zoom, custom models, selected models and prompt position belong to
that account across devices. Signing out restores the browser's separate guest
data. On sign-in, the current browser's guest chats, keys, settings and canvas
are copied into the account once. API keys are re-encrypted for the account;
existing account keys/chats are preserved and canvas items are merged by ID.
A guest identity can only be imported into one account, and guest originals
remain available after sign-out. Existing browser-only canvas and settings are copied when server data is
missing; the first signed-in account claims that browser import so a second
account does not inherit another account's local data. Originals remain local.
The app still supports guests, so this is not a login requirement for provider
or transcription requests. Keep the backend private behind the frontend proxy.

Canvas media is stored as binary data in PostgreSQL (`saved_files`), with a
small ordered manifest in `saved_data`. Existing file size limits apply (20 MB
images, 50 MB GLB, 100 MB video); moving or resizing files only saves metadata.
Run `bun run db:migrate` after pulling schema changes. For larger deployments,
move binary media to object storage. Unreferenced uploads are retained for now.

Storage validation and account isolation are covered by unit tests. To run the
PostgreSQL integration test against the configured local database, set
`STORAGE_INTEGRATION=1` and run `bun run test:e2e` in `apps/backend`. It creates
random test accounts, exercises two sessions and another account, then cleans up
only its own rows.

References: [Better Auth Google setup](https://better-auth.com/docs/authentication/google)
and [Express integration](https://better-auth.com/docs/integrations/express).

## OpenRouter and Fal.AI setup

Open **Settings** at the top right of the canvas to enter your own API keys.
Each provider has **Save key**, **Remove**, and **Test connection** controls.
Keys are encrypted in PostgreSQL and restored for the signed-in account, or for
the same guest browser after refresh. See Google Sign-In and guest storage below.
Saving a key does not validate it. Connection checks do not generate content.
Fal's connection check reads model pricing and requires permission for that API.

Create keys at [OpenRouter](https://openrouter.ai/settings/keys) and
[Fal.AI](https://fal.ai/dashboard/keys). API reference:
[OpenRouter authentication](https://openrouter.ai/docs/api/reference/authentication),
[Fal queue](https://fal.ai/docs/documentation/model-apis/inference/queue), and
[Fal pricing](https://fal.ai/docs/documentation/model-apis/pricing).

For UI integration, `useApiProviders()` exposes `keys`, `setKey`, and
`request(provider, options)`. Examples:

```tsx
const { request } = useApiProviders();
await request("openrouter", {
  action: "chat", model: "<author/model>",
  input: [{ role: "user", content: "Hello" }],
});
const job = await request("fal", {
  action: "submit", model: "<owner/app/model-path>", input: { prompt: "A cat" },
});
// Use the returned request_id with action: "status", then "result";
// supply the same model and requestId for both calls.
```

Requests go through `POST /api/providers`, with the user's key in `x-api-key`.
The proxy uses fixed provider hosts, disables caching and redirects, and never
stores keys. Deploy over HTTPS and keep API-key headers out of infrastructure
logs. Generation calls use the user's provider credits; the canvas send button
is still disabled until generation is connected to the canvas.

## Voice input

Start the frontend with `bun run dev` from `apps/frontend`, along with the backend
and Whisper below. Record audio in the floating prompt, then stop to automatically
transcribe and append the text to your prompt. Failed requests
can be retried without recording again; cancel keeps your existing prompt.
The frontend proxies `/api/transcriptions` to the backend at
`http://127.0.0.1:3001`; set `BACKEND_URL` in `apps/frontend/.env.local` to override.
Recordings must be at most 25 MB. Microphone access requires localhost or HTTPS.

## Backend (NestJS)

```sh
docker compose up -d postgres
cd apps/backend
cp .env.example .env
bun install
bun run start:dev
```

The backend runs at `http://localhost:3001`. Set `PORT` to override the port.
Development and debug watchers compile to `dist-dev`, so running a production
build in `dist` does not remove files used by the running development server.
Run `bun run build`, `bun run test`, and `bun run test:e2e` from `apps/backend`.

## Local PostgreSQL

Start the database:

```sh
docker compose up -d postgres
```

Default connection URL:

```text
postgresql://lomra:lomra@localhost:5432/lomra
```

These credentials are for local development. Override `POSTGRES_DB`,
`POSTGRES_USER`, `POSTGRES_PASSWORD`, or `POSTGRES_PORT` through shell
environment variables or a local `.env` file.

Check status with `docker compose ps`. Stop with `docker compose down`;
the named volume preserves database data. `docker compose down -v` deletes it.

Credentials initialize an empty volume only; changing environment variables
does not update users or databases in an existing volume.

## Local S3 storage (SeaweedFS)

```sh
docker compose up -d seaweedfs
```

SeaweedFS 4.53 runs in [mini mode](https://github.com/seaweedfs/seaweedfs/wiki/Quick-Start-with-weed-mini)
with a persistent `seaweedfs_data` volume and a pre-created `lomra-canvas` bucket.
The S3 endpoint is `http://localhost:8333` on the host or `http://seaweedfs:8333`
inside Compose. Use region `us-east-1` and path-style S3 requests.
Only the S3 port is published, bound to localhost.

Local development credentials default to access key `lomra-local` and secret
`lomra-local-development-only`. Override `SEAWEEDFS_ACCESS_KEY`,
`SEAWEEDFS_SECRET_KEY`, `SEAWEEDFS_BUCKET`, and `SEAWEEDFS_S3_PORT` through shell
environment variables or a root `.env` file. Use private credentials before
exposing the service outside this machine. Credentials seed initial IAM state;
manage existing credentials through SeaweedFS IAM after initialization.

Check status with `docker compose ps seaweedfs` and logs with
`docker compose logs -f seaweedfs`. `docker compose down -v` deletes its stored
objects along with the other Compose volumes.

Start SeaweedFS before the backend. The backend uses the `S3_*` settings in
`apps/backend/.env.example`; their local defaults match Compose. Changing
Compose credentials also requires updating the backend settings.
The S3 endpoint must be reachable by the backend and Next.js server only.
For remote development with socat/Tailscale, forward port 3000; the browser
does not need access to port 8333.

Canvas uploads are validated by the backend and stored in SeaweedFS; downloads
use private, account-scoped presigned URLs valid for 15 minutes, consumed by
the Next.js proxy. The browser downloads through `/api/storage/files/:id` on
the app's origin. CORS permits downloads from `BETTER_AUTH_URL` only. Layout,
settings and chat history remain in PostgreSQL. Existing database files are
copied to S3 on first read, with their originals retained. Guest-to-account
imports copy S3 objects too. Downloads run with at most four files in flight.
Unreferenced S3 objects are retained until a retention policy is defined.

## Self-hosted Whisper

Start the CPU transcription service:

```sh
docker compose up -d whisper
```

API docs: http://localhost:9000/docs. The service uses `faster_whisper` with
the multilingual `small` model and `int8` quantization; no GPU or API key is
required. The first startup downloads the model and can take several minutes.
The `whisper_models` volume preserves it across container restarts.

Transcribe a Thai audio file (use `curl.exe` in Windows PowerShell):

```sh
curl -X POST "http://localhost:9000/asr?task=transcribe&language=th&output=json" -F "audio_file=@recording.mp3"
```

Override `WHISPER_MODEL` or `WHISPER_PORT` through shell environment variables
or a root `.env` file. Use `base` for a lighter model. Containers on the Compose
network can call `http://whisper:9000`; the backend running on the host can call
`http://localhost:9000`.

Check readiness with `docker compose ps whisper` and startup progress with
`docker compose logs -f whisper`. Stop it with `docker compose stop whisper`.
`docker compose down -v` also deletes the cached models and PostgreSQL data.

Image and API reference: [Whisper ASR Webservice](https://ahmetoner.github.io/whisper-asr-webservice/).
## Anonymous database storage

Chat history and provider API keys are saved in PostgreSQL. Run `bun run db:migrate`
in `apps/backend` before starting the app. The frontend uses `BACKEND_URL`
(default `http://127.0.0.1:3001`).

In guest mode, an HttpOnly, SameSite cookie identifies each browser without login.
Clearing that cookie loses access to guest data. Google accounts have separate
storage that can be accessed after signing in on another device. Existing
IndexedDB chats are copied once, preserving the local originals.
API keys use AES-256-GCM with a key derived from the browser's random secret;
the database stores only its hash and encrypted keys. Serve production over HTTPS.
Keep the backend private behind the frontend proxy. Chat payloads are limited to
50 MB; generated media hosted by providers can still expire.

## Canvas media tools

Select source files on the canvas and ask in chat, for example: “remove the background”,
“upscale 2x”, “extract frames at 1 and 3 seconds”, “trim from 2 to 8 seconds”, or
“render front, right, back and left views”. Results become new canvas files.
Background removal uses [Fal BiRefNet V2](https://fal.ai/models/fal-ai/birefnet/v2/api);
upscaling uses [Fal ESRGAN](https://fal.ai/models/fal-ai/esrgan/api) at 2x or 4x.
Both require a Fal key in Settings and use provider credits.
Frame extraction (up to 16 PNGs) and GLB views (1024px PNGs, model axes) run locally.
Trimming runs in compatible browsers such as Chrome, preserves audio, and re-encodes
to WebM at up to 30fps in real time. Keep the tab active; clips are limited to
120 seconds and 8.3 megapixels per frame. Originals are preserved.

