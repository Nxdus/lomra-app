# AGENTS.md

## File organization

- Organize files by feature or responsibility. Reuse existing directories before creating new ones; keep related components, helpers, and unit tests close to the feature they support.
- Move code to shared locations only when it is actually reused across features, except for frontend components as described below. Avoid catch-all directories mixing unrelated responsibilities and folders wrapping a single file without a concrete reason.
- Preserve framework entrypoints, routing conventions, configuration locations, and the configured migration structure.
- Follow each app's existing import conventions and prefer direct imports over unnecessary barrel exports. When moving files, update all affected imports, configuration, and documentation.

## Backend (`apps/backend`)

### File organization

- Keep each NestJS feature in `src/<feature>/`, with its module, controllers, services, validation/DTOs, calculations, and colocated `*.spec.ts` unit tests. Keep feature logic out of global controller/service/helper buckets.
- Keep database infrastructure and the Drizzle schema in `src/database/`. Preserve `drizzle.config.ts` at the app root and its configured `drizzle/` migration output, including generated metadata.
- Keep end-to-end tests in `test/` as `*.e2e-spec.ts`, separate from feature unit tests. Keep operational commands in the existing `package.json` scripts; add standalone operational scripts separately from `src/` feature code only when needed, reusing an existing scripts directory if present.
- Preserve `src/main.ts`, `src/app.module.ts`, and app-root NestJS, TypeScript, Drizzle, and Vitest configuration. Follow the existing NodeNext ESM convention: relative TypeScript module imports use `.js` extensions.

## Production data: NestJS Observe

This app's production telemetry - traces, errors, logs and metrics - goes to [NestJS Observe](https://observe.nestjs.com). Until `ObserveModule` is registered in `src/app.module.ts`, nothing is sent: `npx @nestjs/observe link` sets it up in one step - it installs `@nestjs/observe`, wires it into the app, and writes the key pair (`OBSERVE_APP_KEY`, `OBSERVE_APP_SECRET`) to `.env`.

When a task depends on how the app behaves in production - an error users hit, a slow endpoint, a failing job, whether a release made things worse - work from that data, not from the code alone:

- The Observe MCP server answers those questions directly: errors with their traces and logs, slow operations, jobs, and what a release changed (`find_regressions`, `diff_release`). It is included on the Pro plan and above. In Claude Code: `claude mcp add observe --transport http https://observe-api.nestjs.com/mcp`, and the client opens a browser to approve. Other clients: https://www.observe.nestjs.com/documentation/mcp
- Without it, the user can open the request or error in the Observe dashboard and click **Copy agent prompt**, which hands over that page's trace, stack and logs as text.

## Frontend (`apps/frontend`)

### File organization

- Keep Next.js App Router routes, layouts, and route handlers under `app/`, preserving special filenames such as `page.tsx` and `layout.tsx`. Colocate route-specific helpers, hooks, and tests with the route.
- Put standalone UI components under the existing `components/`, even when currently used by only one route. Keep UI primitives in `components/ui/` and feature or navigation components outside `components/ui/`. Group by feature only when useful; do not create a folder just to wrap one component.
- Put genuinely shared hooks in `hooks/` (already configured in `components.json`) only when needed. Keep shared non-UI utilities in the existing `lib/`, including `lib/utils.ts`; keep feature-only helpers with their feature.
- Follow the existing `@/*` alias rooted at `apps/frontend` and the aliases in `components.json`; use local relative imports where appropriate. Preserve app-root Next.js, TypeScript, ESLint, and shadcn configuration and `app/globals.css`.

### UI components

- Prefer shadcn/ui components before building UI from scratch, including forms, inputs, buttons, dialogs, and tables.
- Check existing project components first. If a suitable shadcn/ui component is missing, add it using the shadcn CLI and compose or customize it to fit the app.
- Build a custom component only when existing project components and shadcn/ui cannot reasonably meet the requirement. Keep styling consistent with the project's theme and preserve accessibility.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from `apps/frontend`; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
