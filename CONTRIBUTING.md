# Contributing to Lomra

Use [GitHub Issues](https://github.com/Nxdus/lomra-app/issues) for bugs and feature
requests. For bugs, include your OS, Lomra version or commit, and steps to
reproduce with sample data you can share. See [SECURITY.md](SECURITY.md) for
vulnerability reports.

Follow the [source setup](README.md#run-from-source) and the repository
instructions in [AGENTS.md](AGENTS.md). Keep each PR focused and describe what
changed, how to try it, and what you checked.

Run these checks from the repository root before opening a PR.

```sh
bun run --cwd apps/frontend test
bun run --cwd apps/frontend lint
bun run --cwd apps/frontend build
bun run --cwd apps/desktop test
```

The frontend build includes TypeScript checking. For Electron changes, also run
`bun run --cwd apps/desktop dev` with `LOMRA_SMOKE=1` in your environment. The
smoke check can download a Whisper model if one is missing. Set
`LOMRA_WORKSPACE` to a scratch folder to keep test data separate.
For frontend development from another host, set `LOMRA_DEV_ORIGIN` to the
hostname or IP you use to access Next.js.

Contributions are licensed under [Apache-2.0](LICENSE). Include attribution and
license notices when adding third-party material.

## Releasing

Set the version in `apps/desktop/package.json`, merge the release changes, and
tag that commit with the matching version. For example, from an up-to-date
`main` with desktop version `0.1.0`, run:

```sh
git tag v0.1.0
git push origin v0.1.0
```

CI runs the checks above, builds the Windows x64 installer, and publishes it
with generated notes on [GitHub Releases](https://github.com/Nxdus/lomra-app/releases).
The current Windows installer is unsigned.
