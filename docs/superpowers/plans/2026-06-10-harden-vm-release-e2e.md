# Harden VM Release E2E Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Caul's macOS, Windows and Linux Parallels release E2E gates reliable, staged, version-checked, muted and cleanup-safe.

**Architecture:** Split VM release testing into small lifecycle scripts backed by shared helpers under `scripts/vm/`. E2E scripts consume already-staged packages instead of discovering, copying or building them implicitly. macOS release E2E proves native capture first, then uses smoke-ready setup state for onboarding completion instead of depending on live permission prompts.

**Tech Stack:** Node.js ESM scripts, Vitest, Parallels `prlctl`, SSH/rsync, PowerShell encoded commands, Electron packaged smoke modes.

---

### Task 1: Shared VM Helper Tests

**Files:**
- Create: `scripts/vm/profiles.mjs`
- Create: `scripts/vm/commands.mjs`
- Create: `scripts/vm/summary.mjs`
- Create: `scripts/vm/cleanup.mjs`
- Create: `scripts/vm/stage.mjs`
- Create: `scripts/vm.test.mjs`

- [ ] Write tests for profile resolution, encoded PowerShell, package version parsing, summary validation and cleanup path safety.
- [ ] Run `npx vitest run scripts/vm.test.mjs` and confirm the tests fail because helpers do not exist.
- [ ] Implement the shared helpers with no VM side effects at import time.
- [ ] Run `npx vitest run scripts/vm.test.mjs` and confirm the tests pass.

### Task 2: Lifecycle Scripts

**Files:**
- Create: `scripts/vm-prepare.mjs`
- Create: `scripts/vm-package.mjs`
- Create: `scripts/vm-stage.mjs`
- Modify: `package.json`

- [ ] Add prepare/package/stage scripts for `macos`, `win` and `linux`.
- [ ] Ensure prepare verifies VM readiness, mutes audio, stops stale Caul processes, checks disk space and checks the model fixture path.
- [ ] Ensure package builds are explicit and platform-specific, not hidden inside E2E.
- [ ] Ensure stage verifies package version equals `package.json`.
- [ ] Run `node scripts/vm-prepare.mjs --help`, `node scripts/vm-package.mjs --help`, and `node scripts/vm-stage.mjs --help`.

### Task 3: E2E Refactor

**Files:**
- Modify: `scripts/smoke-parallels-macos-e2e.mjs`
- Modify: `scripts/smoke-parallels-release-vm.mjs`
- Modify: `scripts/assert-vm-e2e-summaries.mjs`

- [ ] Refactor E2E scripts to consume staged package paths from profiles.
- [ ] Make macOS release E2E run backend capture smokes before seeding smoke-ready onboarding state.
- [ ] Keep live macOS permission prompt testing out of normal `vm:e2e:macos`.
- [ ] Ensure summaries include `packageVersion`, named gates, evidence paths and cleanup status.
- [ ] Ensure cleanup removes staged release artefacts after success and preserves model fixtures.

### Task 4: Documentation and Verification

**Files:**
- Modify: `docs/README.md`
- Modify: `docs/cross-platform-release-plan.md`

- [ ] Document the new lifecycle and explain that normal release E2E is not the macOS permission-prompt test.
- [ ] Run `npx vitest run scripts/vm.test.mjs scripts/audio-isolation-gate.test.mjs scripts/launch-mac-dev-app.test.mjs`.
- [ ] Run `npm run build`.
- [ ] Run `git diff --check`.
