# Release Packaging

Release artifacts are generated locally or in GitHub Actions with:

```bash
bun run package:release
```

The command writes:

- `dist/nipux-local-ai-<version>.zip`
- `dist/nipux-local-ai-<version>-manifest.json`
- `dist/SHA256SUMS.txt`

The zip is a source distribution. It includes the app source, web UI, scripts, docs, lockfile, and release metadata. It intentionally excludes `node_modules`, local data, tests, coverage, and prior `dist` output.

## Release Checklist

1. Run `bun run check`.
2. Run `bun test`.
3. Run `bun run preflight --json`.
4. Run `bun run package:release`.
5. Verify `dist/SHA256SUMS.txt`.
6. Tag the release, for example `git tag v0.1.0 && git push origin v0.1.0`.

The `Release` GitHub Actions workflow runs the same checks and uploads the zip, manifest, and checksums as build artifacts for tags matching `v*`.

## Install Paths

The recommended install path remains the one-command installer:

```bash
curl -fsSL https://raw.githubusercontent.com/nipuxx/nipux-local-ai/main/scripts/install.sh | bash
```

Windows:

```powershell
irm https://raw.githubusercontent.com/nipuxx/nipux-local-ai/main/scripts/install.ps1 | iex
```

The release zip is for pinned/offline inspection, manual installs, and CI artifacts. After extracting it:

```bash
bun install --frozen-lockfile
bun run setup
bun run preflight
bun run local
```

The install scripts run `bun run setup`, print `bun run capabilities`, print a non-fatal `bun run ready` summary, and then point users at `bun run local`. `bun run setup` writes a launch profile, env file, and local launcher scripts under `NIPUX_HOME`. Recreate them later with `bun run launch:write`. Use `bun run src/cli.ts local --dry-run` to inspect which bundled workers will start before launching.
