# Susura Knowledge Base

This folder is the durable project memory for future agents and contributors. Keep it compact, current and decisionful.

## Public Download Page

`docs/index.html` is the live Susura download page source. The GitHub repository is private for now, but the download page is intentionally public and visitable at `https://apotenza92.github.io/susura/`.

GitHub Pages is not currently enabled directly from the private `apotenza92/susura` repository because the account plan does not support Pages for that private repo. The `Publish Download Page` workflow mirrors only the static download page and icon assets into the public `apotenza92.github.io` site repo.

The page currently offers macOS downloads only. Windows and Linux must show `Coming soon` until those packaged apps have been built and tested.

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

The first implementation milestone is an Electron setup shell using shadcn/ui defaults, backed by Rust process boundaries for reliable macOS 15+ microphone and system audio capture. Full overlay UX, provider orchestration and cross-platform capture should follow only after that path is stable.
