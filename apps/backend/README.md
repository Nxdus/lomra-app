# Lomra backend

NestJS API with PostgreSQL and Drizzle ORM.

Copy `.env.example` to `.env` and set `DATABASE_URL`. Start PostgreSQL using the Docker Compose instructions in the root README.

```sh
bun install
bun run start:dev
```

Runs at http://localhost:3001 (`PORT` overrides it).

## Audio transcription

Start Whisper with `docker compose up -d whisper` from the repository root.
Set `WHISPER_URL` in `.env` (default `http://127.0.0.1:9000`; use
`http://whisper:9000` if the backend joins the Compose network).

`POST /transcriptions` accepts one audio file in the multipart field `file`,
up to 25 MiB. The file stays in memory and is not saved. Audio formats recognized
by file signatures and WebM recordings are accepted; Whisper decodes them with FFmpeg.

```sh
curl -X POST http://localhost:3001/transcriptions -F "file=@recording.mp3"
```

Use `curl.exe` in Windows PowerShell. The response is HTTP 200:

```json
{ "text": "สวัสดีครับ", "language": "th" }
```

Whisper detects the language automatically and transcribes in the source language.
It supports multiple languages across uploads; detection selects one language per
file, so accuracy for language switching within a file may vary. See the
[Whisper API reference](https://ahmetoner.github.io/whisper-asr-webservice/endpoints/).
Requests time out after five minutes (HTTP 504); upstream failures return HTTP 502.
Missing, empty, or unsupported files return HTTP 400; oversized uploads return HTTP 413.

```sh
bun run lint
bun run build
bun run test
bun run test:e2e
```

Tests replace the database service and do not require PostgreSQL.

```sh
bun run db:generate
bun run db:migrate
bun run db:studio
```
