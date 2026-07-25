# Agent Instructions

Always use Australian English spelling and punctuation. Never use em dashes.

## Product Priorities

Caul is a calm, private desktop assistant for live calls and screen work. Prioritise:

- Usability before feature breadth.
- Minimal setup from install to a working system.
- Local-first behaviour wherever practical.
- Clear privacy boundaries and no hidden telemetry.
- Strict, inspectable module boundaries.
- Maintained open-source projects and platform APIs over bespoke implementations.

## Repository Rules

- Read `docs/README.md` before making architectural changes.
- Keep durable instructions in this file. Use GitHub issues and pull requests for changing work state. Do not commit temporary plans, handoffs, worklogs or generated artefacts.
- Do not claim features exist before they are implemented.
- Keep the main `README.md` description and the `docs/index.html` download-page subtitle in sync.
- Keep sensitive behaviour inspectable, especially capture, screen-adjacent context, local storage and provider calls.
- Do not add a plugin architecture until the macOS audio workflow is proven.
- Do not vendor or copy third-party code until licence compatibility is checked.
- Update the relevant current documentation whenever an architectural decision changes.

## Architecture and UI

- Electron and React own the current desktop UI. Rust owns the durable backend boundary. The Swift helper owns Apple framework integration for macOS system audio.
- Keep capture, transcription, providers and UI separated. Capture code must not own AI provider logic, UI code must not parse raw audio, and provider code must not know platform permission details.
- Use ScreenCaptureKit for the normal macOS system-audio route. Keep Core Audio Process Tap as an explicit diagnostic backend only.
- Do not use Electron `desktopCapturer` or browser `getDisplayMedia` as a system-audio fallback.
- Build visible UI from the repository's official shadcn/ui components using Base UI primitives, the Rhea style and the shared CSS variables. Extend local shadcn components before introducing one-off controls, styling systems or parallel component libraries.

## Verification

- Choose the lightest valid verification and launch loop for each change. Use focused tests and rebuild only the affected layer.
- Run `npm run check` for renderer and TypeScript changes. Run `cargo test` for Rust changes. Run both for cross-boundary changes.
- Use `npm run dev` for normal application iteration.
- Restart Electron after main or preload changes. Rebuild the affected native target after Rust or Swift changes.
- Use `npm run dist:mac:dev` and `npm run launch:mac:dev` only for packaged identity, permissions, onboarding, signing, icons, release layout or app `userData` behaviour.
- Do not reset macOS TCC permissions unless permission-prompt testing is explicitly required. Never run an all-app `tccutil reset ScreenCapture` or `tccutil reset AudioCapture` during ordinary iteration.
- Follow `docs/release-validation.md` for packaged release gates. Do not store VM passwords in the repository.

## GitHub automation

- Keep deterministic verification manually dispatchable and callable by the tag-only release workflow. Do not run routine push or pull-request CI.
- Keep the download-page publisher manual-only because it writes to another repository.
- Keep releases restricted to deliberate `v*` tags whose commits are reachable from `main`.
