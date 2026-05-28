# Susura Knowledge Base

This folder is the durable project memory for future agents and contributors. Keep it compact, current and decisionful.

## Public Download Page

`docs/index.html` is the live Susura download page source. The GitHub repository is public, and the download page is visitable at `https://apotenza92.github.io/susura/`.

The `Publish Download Page` workflow mirrors only the static download page and icon assets into the public `apotenza92.github.io` site repo, keeping the published site independent from the source tree layout.

The page currently offers Apple Silicon macOS downloads only. Intel macOS builds are not supported. Windows and Linux must show `Coming soon` until those packaged apps have been built and tested.

## Reading Guide

- `philosophy.md`: Product identity, usability principles and privacy stance.
- `architecture.md`: Monorepo shape, module boundaries and current technical choices.
- `macos-audio.md`: macOS 15+ microphone and system audio capture plan.
- `competitor-notes.md`: Public findings from Cluely, Natively and Pluely.
- `resources.md`: Preferred platform docs, reference projects and libraries.
- `development.md`: Local commands and Parallels macOS VM testing notes.
- `llm-first-chunk-optimisation.md`: Benchmark loop for reducing stop-to-first-visible-LLM-text latency.

## Documentation Rules

- Prefer durable principles and current decisions over speculative roadmaps.
- Do not imply that planned features are already implemented.
- Keep documents short enough that agents can read them before making changes.
- Record why a decision was made when the reason will help future maintenance.
- Update these docs whenever an architectural decision changes.

## Current Focus

The current implementation milestone is an Electron onboarding and overlay shell backed by Rust process boundaries for reliable Apple Silicon macOS 15+ microphone and system audio capture. The app should keep first-run permissions, Parakeet model setup and Pi provider setup explicit before listening or AI requests are enabled. Cross-platform capture should follow only after the macOS path is stable.
