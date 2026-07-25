import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repositoryRoot = path.resolve(import.meta.dirname, '..');

function trackedFiles() {
  return execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
    cwd: repositoryRoot,
    encoding: 'utf8'
  }).split('\0').filter((file) => file && existsSync(path.join(repositoryRoot, file)));
}

describe('repository hygiene', () => {
  it('keeps one durable agent instruction source', () => {
    const agentInstructions = trackedFiles().filter((file) => path.basename(file) === 'AGENTS.md');

    expect(agentInstructions).toEqual(['AGENTS.md']);
  });

  it('does not track disposable output or temporary planning files', () => {
    const disposableSegments = new Set([
      '.build',
      '.vite',
      'artifacts',
      'dist',
      'dist-electron',
      'node_modules',
      'release',
      'release-dev',
      'release-dev-private',
      'target',
      'test-results'
    ]);
    const temporaryNames = new Set(['backlog', 'handoff', 'memory', 'now', 'plan', 'roadmap', 'worklog']);

    const violations = trackedFiles().filter((file) => {
      const segments = file.split('/');
      const extensionlessName = path.basename(file, path.extname(file)).toLowerCase();

      return segments.some((segment) => disposableSegments.has(segment))
        || segments.some((segment) => segment.toLowerCase() === 'plans')
        || temporaryNames.has(extensionlessName)
        || /(?:-|_)(?:backlog|handoff|memory|now|plan|roadmap|worklog)$/i.test(extensionlessName)
        || file.includes('/icon.iconset/')
        || file.includes('/ico-rounded/');
    });

    expect(violations).toEqual([]);
  });

  it('does not restore abandoned implementation roots', () => {
    const abandonedRoots = [
      'assets/caul.af',
      'crates/desktop-ui/',
      'crates/session-core/'
    ];
    const violations = trackedFiles().filter((file) => abandonedRoots.some((root) => file === root || file.startsWith(root)));

    expect(violations).toEqual([]);
  });

  it('does not restore confirmed obsolete release and planning paths', () => {
    const obsolete = new Set([
      'docs/competitor-notes.md',
      'docs/cross-platform-release-plan.md',
      'docs/llm-first-chunk-optimisation.md',
      'docs/resources.md',
      'docs/superpowers/plans/2026-06-10-harden-vm-release-e2e.md',
      'scripts/assert-vm-e2e-summaries.mjs',
      'scripts/check-parallels-macos-vm.mjs',
      'scripts/package-fedora-rpm-vm.sh',
      'scripts/smoke-parallels-backend-vm.mjs',
      'scripts/smoke-parallels-macos-vm.mjs'
    ]);

    expect(trackedFiles().filter((file) => obsolete.has(file))).toEqual([]);
  });

  it('keeps package script file references valid', () => {
    const packageJson = JSON.parse(readFileSync(path.join(repositoryRoot, 'package.json'), 'utf8'));
    const referencedScripts = new Set();

    for (const command of Object.values(packageJson.scripts)) {
      for (const match of command.matchAll(/scripts\/[A-Za-z0-9._/-]+/g)) {
        referencedScripts.add(match[0]);
      }
    }

    const missing = [...referencedScripts].filter((file) => !existsSync(path.join(repositoryRoot, file)));

    expect(missing).toEqual([]);
  });

  it('pins workflow actions and keeps workflow script references valid', () => {
    const workflowFiles = trackedFiles().filter((file) => file.startsWith('.github/workflows/'));
    const unpinned = [];
    const missing = [];
    for (const workflowFile of workflowFiles) {
      const contents = readFileSync(path.join(repositoryRoot, workflowFile), 'utf8');
      for (const match of contents.matchAll(/^\s*uses:\s*([^\s#]+)/gm)) {
        if (!match[1].startsWith('./') && !/@[a-f0-9]{40}$/.test(match[1])) {
          unpinned.push(`${workflowFile}: ${match[1]}`);
        }
      }
      for (const match of contents.matchAll(/(?:release-source\/)?(scripts\/[A-Za-z0-9._/-]+\.(?:cjs|mjs|js|py|sh))/g)) {
        if (!existsSync(path.join(repositoryRoot, match[1]))) missing.push(`${workflowFile}: ${match[1]}`);
      }
    }
    expect(unpinned).toEqual([]);
    expect(missing).toEqual([]);
  });

  it('does not restore retired release credential paths', () => {
    const releaseSources = trackedFiles().filter((file) => (
      file.startsWith('.github/workflows/')
      || file === 'electron-builder.config.cjs'
      || file === 'scripts/release.sh'
      || /^scripts\/(?:build-signed-macos|notarize-macos)\./.test(file)
    ));
    const retired = /\b(?:APPLE_ID|APPLE_APP_SPECIFIC_PASSWORD|CSC_LINK|CSC_KEY_PASSWORD)\b/;
    expect(releaseSources.filter((file) => retired.test(readFileSync(path.join(repositoryRoot, file), 'utf8')))).toEqual([]);
  });

  it('keeps releases independent of disposable local VM evidence', () => {
    const releaseScript = readFileSync(path.join(repositoryRoot, 'scripts', 'release.sh'), 'utf8');

    expect(releaseScript).not.toMatch(/CAUL_REQUIRE_VM_E2E|assert-vm-e2e-summaries|artifacts\/vm-e2e/);
    expect(releaseScript).toContain('releases must be tagged from main');
    expect(releaseScript).toContain('git rev-parse origin/main');
    expect(releaseScript).not.toContain('Continue anyway?');
  });
});
