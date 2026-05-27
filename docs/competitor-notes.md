# Competitor Notes

These notes summarise public information used to guide Susura. Treat competitor projects as references only. Do not copy GPL or AGPL code into Susura unless licence compatibility is explicitly checked and documented.

## Cluely

Public sources describe Cluely as an Electron desktop app with an always-on-top overlay, live meeting assistance and strong invisibility marketing. Third-party desktop inspection has reported a large macOS bundle footprint.

Useful lessons:

- Electron can support the overlay product shape.
- A polished first-run and overlay workflow matters more than a large dashboard.
- Strong evasion language creates trust, ethics and positioning problems that Susura should avoid.

## Natively

Natively publicly describes an Electron, React, Vite, TypeScript and Tailwind app with Rust native audio, `napi::Buffer` transfers, SQLite, local RAG and bring-your-own-key support.

Useful lessons:

- Electron plus Rust native audio is a validated shape for this product category.
- Separating system audio and microphone paths is valuable.
- Local storage and BYOK are important trust signals.
- A rich dashboard can add power, but Susura should not require one for first value.

## Pluely

Pluely publicly describes a Tauri, Rust and React app with local SQLite storage, multiple AI and speech-to-text providers, small bundle size and local-first positioning.

Useful lessons:

- Local-first configuration and direct provider calls fit Susura's direction.
- Small app size and fast startup are valuable product qualities.
- Tauri validates a Rust-backed desktop approach, but Susura currently prefers Electron for a consistent bundled UI runtime.

## Susura Takeaways

- Build a calm private overlay rather than an evasion product.
- Keep setup shorter than competitors.
- Keep capture, provider calls and local storage inspectable.
- Reuse maintained open-source projects and platform APIs instead of hand-rolling low-level pieces.
- Avoid GPL and AGPL contamination while the project is intended to use a permissive licence.
- Match the legitimate private-overlay mechanics used by comparable apps: Dock-less runtime, global hotkeys, protected full-app overlay windows, floating handle recovery and panic hide. Do not copy process, icon or system-app impersonation patterns, and keep Susura visible in normal macOS surfaces such as Finder, Spotlight, Activity Monitor, Privacy settings and process lists.
