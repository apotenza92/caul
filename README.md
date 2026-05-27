# Susura

<img src="assets/icons/icon-rounded-readme.png" alt="Susura icon" width="128" />

<a href="https://apotenza92.github.io/susura/">
  <img src="https://img.shields.io/badge/Download-Susura-0f766e?style=for-the-badge" alt="Download Susura" height="40">
</a>
<br><br>

Susura is a simple, calm AI overlay for live calls and screen work.

The product goal is to feel usable by normal people: one install, one setup flow, one small overlay, and no dashboard unless the user deliberately opens settings.

## Product Direction

- Invisible or non-disruptive overlay during meetings and screen shares.
- Bring-your-own-key support for common AI providers.
- Plain-text custom instructions as the primary context mechanism.
- Optional screenshots, audio transcript, and selected files later.
- Local-first settings and history where possible.
- Minimal UI: hotkey, prompt box, answer panel, and settings.

## Non-Goals

- A complex meeting CRM.
- A full knowledge-base app on day one.
- A surveillance-style product identity.
- A cluttered dashboard-first interface.

## Working Name

Susura comes from the Romance-language root for whispering or murmuring. It is close to Italian `sussurra`, but easier to spell.

## Current Foundation

The repository currently contains:

- Electron and React desktop shell with shadcn/ui defaults.
- Rust backend for local microphone capture, system-audio orchestration, endpointing and Parakeet transcription.
- Swift macOS helper for Core Audio system capture.
- Rust Dioxus Native experiment kept for comparison.
- Project knowledge base in `docs/`.

## Audio Privacy Boundary

Susura hot-prepares selected audio sources at app startup to make Start listening feel immediate. That means microphone or system-audio streams may be opened while the app is idle, depending on the selected sources and macOS permissions. The Rust backend drops all frames while idle and must not emit transcript chunks or send provider requests until the user clicks Start listening. The project is open source so this boundary remains inspectable.

## Development

```sh
npm run dev
```

Rust workspace checks:

```sh
cargo test
cargo check -p susura-desktop-ui
```

Legacy Electron prototype checks:

```sh
npm install
npm test
npm run build
```

See `docs/development.md` for local commands and Parallels macOS VM testing notes.
