# Susura Knowledge Base

This folder is the durable project memory for future agents and contributors. Keep it compact, current and decisionful.

## Public Download Page

`docs/index.html` is the live Susura download page source. The GitHub repository is public, and the download page is visitable at `https://apotenza92.github.io/susura/`.

The `Publish Download Page` workflow mirrors only the static download page and icon assets into the public `apotenza92.github.io` site repo, keeping the published site independent from the source tree layout.

The page currently offers stable and beta downloads for Apple Silicon macOS, Windows ARM64/x64, Linux ARM64/x64 AppImage, Ubuntu/Debian `.deb` and Fedora/RHEL `.rpm`. macOS also includes Homebrew cask commands for stable and beta channels. Intel macOS builds are not supported. Windows/Linux ARM64 has local Parallels VM release-smoke coverage; Fedora RPM smoke coverage uses the `Fedora 42 ARM64` Parallels VM. Windows/Linux x64 is CI-built from the same platform backend and should not be described as locally smoke-tested until dedicated x64 coverage exists.

## Reading Guide

- `philosophy.md`: Product identity, usability principles and privacy stance.
- `architecture.md`: Monorepo shape, module boundaries and current technical choices.
- `macos-audio.md`: macOS 15+ microphone and system audio capture plan.
- `cross-platform-release-plan.md`: Windows and Linux build, package and E2E release plan.
- `competitor-notes.md`: Public findings from Cluely, Natively and Pluely.
- `resources.md`: Preferred platform docs, reference projects and libraries.
- `llm-first-chunk-optimisation.md`: Benchmark loop for reducing stop-to-first-visible-LLM-text latency.

## Documentation Rules

- Prefer durable principles and current decisions over speculative roadmaps.
- Do not imply that planned features are already implemented.
- Keep documents short enough that agents can read them before making changes.
- Record why a decision was made when the reason will help future maintenance.
- Update these docs whenever an architectural decision changes.

## Current Focus

The current implementation milestone is a clean multi-platform Electron package backed by Rust process boundaries for reliable Apple Silicon macOS, Windows and Ubuntu/Linux capture. The app should keep first-run permissions, Parakeet model setup and Pi provider setup explicit before listening or AI requests are enabled. macOS remains the reference implementation, while Windows and Linux ARM64 have local VM release gates for packaged capture, transcription, onboarding and pre-setup privacy. Windows/Linux x64 artefacts are CI-built from the same backend and published with that caveat. Broader Linux distribution support remains deferred until it has dedicated test coverage.

## Development App Policy

Use `npm run dev` for normal implementation work. It runs a source Electron/Vite loop and should stay screenshot-friendly, Dock-visible and non-private so UI issues can be inspected and marked up quickly.

Use `npm run dist:mac:dev` plus `npm run launch:mac:dev` only for packaged-identity checks such as macOS permissions, onboarding freshness, signing, bundle identity, icon/release layout, packaged resources and packaged `userData` behaviour.
