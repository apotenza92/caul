# Caul Documentation

This directory contains current product, architecture and release documentation. Durable agent instructions live in the repository root `AGENTS.md`. Changing work belongs in GitHub issues and pull requests, not documentation-shaped plans or handoff files.

## Reading Guide

- `philosophy.md`: product identity, usability principles and privacy stance.
- `architecture.md`: current monorepo shape, module boundaries and technical choices.
- `macos-audio.md`: current macOS microphone and system-audio route.
- `model-recommendation.md`: implemented model catalogue and recommendation policy.
- `release-validation.md`: current package matrix and deterministic release gates.

## Public Download Page

`docs/index.html` is the source for the public download page at `https://apotenza92.github.io/caul/`. The `Publish Download Page` workflow publishes the static page and required icon assets. Keep the main `README.md` description and the download-page subtitle in sync.

Packaged stable and beta apps use GitHub-backed update checks. Stable builds follow stable releases. Beta builds may follow stable and prerelease tags while preserving the beta app identity. Release privacy tests disable update checks so expected GitHub traffic is not counted as hidden pre-setup network activity.

Signed macOS packages support automatic download and restart-to-install updates. Windows NSIS and Linux AppImage packages use an embedded reviewed TUF root to authenticate channel metadata before Electron Updater receives it. TUF trust persists under the app's existing `userData` directory and an older embedded root never replaces advanced persisted trust. Debian and RPM upgrades remain with the system package manager.

Stable and beta are deliberately separate products with distinct application identities, install paths, `userData` directories and update feeds. Windows and Linux packages are not code-signed. The release publishes exact SHA-256 checksums and GitHub provenance in addition to TUF metadata; TUF authenticates automatic-update metadata even if code signing is added later.

## Documentation Rules

- Document implemented behaviour, current decisions and durable reasons.
- Do not use documentation as a backlog, worklog, temporary memory or speculative roadmap.
- Keep documents concise enough to inspect before changing the affected system.
- Preserve legitimate release history in changelogs.
- Update or remove references when code, commands or architecture are removed.
