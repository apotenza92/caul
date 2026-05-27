# Agent Instructions

Always use Australian English spelling and punctuation.

Never use em dashes.

## Project Priorities

Susura is a calm, private desktop assistant for live calls and screen work. The project should prioritise:

- Usability before feature breadth.
- Minimal setup from install to a working system.
- Local-first behaviour wherever practical.
- Clear privacy boundaries and no hidden telemetry.
- Strict module boundaries that make the codebase easy to inspect.
- Maintained open-source projects and platform APIs over bespoke implementations.

## Operating Rules

- Read `docs/README.md` before making architectural changes.
- Do not claim features exist before they are implemented.
- Do not add a plugin architecture until the macOS audio workflow is proven.
- Do not vendor or copy competitor code unless licence compatibility is explicitly checked.
- Keep sensitive behaviour inspectable, especially audio capture, screen-adjacent context, local storage and provider calls.
- Update the relevant docs whenever an architectural decision changes.

## Current Direction

- Fully open-source project with a permissive licence.
- Single monorepo.
- Electron and React are the likely future desktop shell.
- Rust is the durable core for audio processing, sessions, provider calls and cross-platform abstractions.
- A small Swift helper is acceptable for macOS ScreenCaptureKit capture.
- The immediate implementation target is macOS 15+ microphone plus system audio capture.
