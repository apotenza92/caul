# Agent Instructions

Always use Australian English spelling and punctuation.

Never use em dashes.

## Project Priorities

Caul is a calm, private desktop assistant for live calls and screen work. The project should prioritise:

- Usability before feature breadth.
- Minimal setup from install to a working system.
- Local-first behaviour wherever practical.
- Clear privacy boundaries and no hidden telemetry.
- Strict module boundaries that make the codebase easy to inspect.
- Maintained open-source projects and platform APIs over bespoke implementations.

## Operating Rules

- Read `docs/README.md` before making architectural changes.
- Do not claim features exist before they are implemented.
- Keep the main `README.md` description and `docs/index.html` download page subtitle in sync.
- Do not add a plugin architecture until the macOS audio workflow is proven.
- Do not vendor or copy competitor code unless licence compatibility is explicitly checked.
- Keep sensitive behaviour inspectable, especially audio capture, screen-adjacent context, local storage and provider calls.
- Update the relevant docs whenever an architectural decision changes.
- Choose the lightest valid verification and launch loop for each change. Do not default to full packaging or rebuilding: use focused tests, renderer rebuilds, Vite reloads, Electron dev relaunches, native target rebuilds or packaged `Caul Dev.app` rebuilds only when the changed code path actually requires them.
- Do not reset macOS TCC permissions unless the task explicitly requires permission prompt testing. Never run an all-app `tccutil reset ScreenCapture` or `tccutil reset AudioCapture` during ordinary iteration. Use `npm run launch:mac:dev -- --reset-permissions` only when deliberately retesting `dev.caul.app.dev` permission prompts.
- Treat the packaged `Caul Dev.app` as a specialised packaged-identity test target, not the default development app. Use it only for permission, onboarding, signing, bundle identity, LaunchServices, icon, release-layout or app `userData` behaviour. For normal app iteration, use the codebase dev loop.

## Development Commands

- `npm install`: install JavaScript and Electron dependencies.
- `npm run dev`: build the Rust backend and Swift helper, start Vite, and launch the primary Electron app. This is the default loop for normal app iteration.
- `npm run build`: type-check the renderer and build the web assets.
- `npm test`: run the React and TypeScript foundation tests.
- `npm run check`: run the web build and frontend tests together.
- `npm run dist:mac:dev`: package a local `Caul Dev.app` with bundle ID `dev.caul.app.dev`. Use this only when testing packaged macOS identity, signing, permission, onboarding, release-layout or app `userData` behaviour.
- `npm run launch:mac:dev`: wipe `~/Library/Application Support/caul-dev`, preserve downloaded models, and launch the local packaged dev app. Pass `-- --keep-data` to preserve app data. Pass `-- --reset-permissions` only when deliberately retesting permission prompts for `dev.caul.app.dev`.
- `npm run smoke:electron`: launch Electron against Vite, exercise the preload runtime and capture bridge, then exit.
- `npm run smoke:electron:built`: launch the built Electron app and verify the production renderer is not blank.
- `npm run smoke:onboarding`: launch Electron with fresh temporary app data, force incomplete setup, verify the onboarding window opens, and capture step screenshots in `artifacts/onboarding/`.
- `npm run macos-audio:build`: build and ad-hoc sign the Swift Core Audio helper with the local audio-input entitlement.
- `cargo build -p caul-desktop-backend`: build the Rust backend binary spawned by Electron.
- `cargo run -p caul-desktop-backend -- --stream-system-audio`: run system audio capture through the Rust backend.
- `cargo test`: run Rust workspace tests.

## Iteration Workflow

- React, CSS and renderer-only changes: run focused tests and use Vite or Electron dev reloads. Do not package.
- Electron main or preload changes: restart the dev Electron app unless the change depends on packaged layout, bundle identifiers, TCC permissions or `app.asar`.
- Rust or Swift changes: rebuild the affected native target, then use `npm run dev` when packaged signing and TCC behaviour are not under test.
- Packaged permission, onboarding, app identity, signing, icon, LaunchServices or release-layout changes: use `npm run dist:mac:dev` and `npm run launch:mac:dev`. Add `-- --reset-permissions` only when the permission prompt state is part of the test.
- Only repackage continuously when the behaviour being tested is genuinely packaged-only.

## Parallels macOS VM Testing

- Use the Parallels macOS VM as a repeatable test target for onboarding and permission flows.
- Current VM target: `macOS Tahoe`.
- Current host dev server address seen from the guest: `http://10.211.55.2:5173/`.
- When the capture layer is touched, verify fresh install setup, microphone permission prompt and denial recovery, Screen and System Audio Recording prompt and denial recovery, mic level movement, system audio level movement, and clean stop/restart without relaunching the app.
- Do not write VM passwords into this repository.

## Current Direction

- Fully open-source project with a permissive licence.
- Single monorepo.
- Electron and React are the likely future desktop shell.
- Rust is the durable core for audio processing, sessions, provider calls and cross-platform abstractions.
- A small Swift helper is acceptable for macOS ScreenCaptureKit capture.
- The immediate implementation target is macOS 15+ microphone plus system audio capture.
