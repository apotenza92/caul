# Caul Knowledge Base

This folder is the durable project memory for future agents and contributors. Keep it compact, current and decisionful.

## Public Download Page

`docs/index.html` is the live Caul download page source. The GitHub repository is public, and the download page is visitable at `https://apotenza92.github.io/caul/`.

The `Publish Download Page` workflow mirrors only the static download page and icon assets into the public `apotenza92.github.io` site repo, keeping the published site independent from the source tree layout.

The page currently offers a primary autodetected stable download button plus optional stable/beta selectors for Apple Silicon macOS, Windows x64/ARM64, Linux x64/ARM64 AppImage, Ubuntu/Debian `.deb` and Linux x64 Fedora/RHEL `.rpm`. macOS also includes Homebrew cask commands for stable and beta channels inside the optional selector area. Intel macOS builds are not supported. Windows/Linux ARM64 has local Parallels VM release-smoke coverage. Windows/Linux x64 is CI-built from the same platform backend and should not be described as locally smoke-tested until dedicated x64 coverage exists.

## Updates

Packaged stable and beta apps include GitHub-backed update checks. Stable builds stay on stable releases. Beta builds track the newest release across stable and prerelease tags while preserving the beta app identity. Automatic checks default to weekly and can be changed from `Settings > General > Updates`. Release privacy smokes disable update checks with `CAUL_DISABLE_UPDATE_CHECKS=1` so expected GitHub release traffic is not counted as hidden pre-setup network activity.

## Reading Guide

- `philosophy.md`: Product identity, usability principles and privacy stance.
- `architecture.md`: Monorepo shape, module boundaries and current technical choices.
- `macos-audio.md`: macOS 15+ microphone and system audio capture plan.
- `cross-platform-release-plan.md`: Windows and Linux build, package and E2E release plan.
- `competitor-notes.md`: Public findings from Cluely, Natively and Pluely.
- `resources.md`: Preferred platform docs, reference projects and libraries.
- `model-recommendation.md`: Benchmark-grounded model catalogue and recommendation policy.
- `llm-first-chunk-optimisation.md`: Benchmark loop for reducing stop-to-first-visible-LLM-text latency.

## Documentation Rules

- Prefer durable principles and current decisions over speculative roadmaps.
- Do not imply that planned features are already implemented.
- Keep documents short enough that agents can read them before making changes.
- Record why a decision was made when the reason will help future maintenance.
- Update these docs whenever an architectural decision changes.

## Current Focus

The current implementation milestone is a clean multi-platform Electron package backed by Rust process boundaries for reliable Apple Silicon macOS, Windows and Ubuntu/Linux capture. The app should keep first-run permissions and local transcription model setup explicit before listening is enabled, while ChatGPT sign-in remains optional and required only before cloud AI requests. macOS remains the reference implementation, while macOS, Windows and Linux ARM64 have local VM release gates for packaged capture, transcription, AI response, onboarding and pre-setup privacy. Windows/Linux x64 artefacts are CI-built from the same backend and published with that caveat. Broader Linux distribution support remains deferred until it has dedicated test coverage.

Release validation uses Parallels VM E2E gates for macOS, Windows and Ubuntu Linux. The gates must prove packaged launch or install, onboarding, audio capture, local transcription, renderer AI response and pre-setup privacy. macOS and Windows require Electron content protection on both the overlay and floating handle. Linux records the same protection path as best effort because Electron content protection is only supported on macOS and Windows. Fedora currently remains an RPM install/package gate.

## Development App Policy

Use `npm run dev` for normal implementation work. It runs a source Electron/Vite loop and should stay screenshot-friendly, Dock-visible and non-private so UI issues can be inspected and marked up quickly.

Use `npm run dist:mac:dev` plus `npm run launch:mac:dev` only for packaged-identity checks such as macOS permissions, onboarding freshness, signing, bundle identity, icon/release layout, packaged resources and packaged `userData` behaviour.

Use `npm run dist:mac:dev:private` plus `npm run launch:mac:dev:private` when the packaged app itself needs to match the released Dockless privacy shape before pushing a release. This writes `Caul Dev-Private.app` to `release-dev-private/`, leaves the normal packaged dev output alone, and uses the separate `dev.caul.app.dev-private` identity so LaunchServices, Dock state and local TCC checks do not collide with the inspectable `Caul Dev.app`. The `Dev-Private` runtime is stricter than normal development: it is Dockless and applies screenshot protection to all app windows so local screenshots can verify privacy behaviour.
