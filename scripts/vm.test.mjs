import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  getVmProfile,
  resolveVmProfile
} from './vm/profiles.mjs';
import {
  createPowerShellEncodedArgs,
  macGuestShellArgs,
  parseDebPackageVersion,
  parseMacAppVersion
} from './vm/commands.mjs';
import {
  createVmE2eSummary,
  validateVmE2eSummary
} from './vm/summary.mjs';
import {
  assertDisposableVmPath,
  shouldRemoveVmReleaseArtefact
} from './vm/cleanup.mjs';

const tempRoots = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

function makeTempRoot() {
  const root = mkdtempSync(path.join(tmpdir(), 'caul-vm-test-'));
  tempRoots.push(root);
  return root;
}

describe('VM release profiles', () => {
  it('resolves canonical macOS defaults', () => {
    const profile = getVmProfile('macos');

    expect(profile.vmName).toBe('macOS');
    expect(profile.packageType).toBe('app');
    expect(profile.stagedPackagePath).toBe('/Users/alex/caul-e2e/Caul.app');
    expect(profile.releaseDir).toBe('/Users/alex/caul-e2e/release');
    expect(profile.modelDir).toContain('parakeet-tdt-0.6b-v3-int8');
  });

  it('allows environment overrides without mutating profile defaults', () => {
    const profile = resolveVmProfile('linux', {
      CAUL_LINUX_VM_NAME: 'Ubuntu Test',
      CAUL_LINUX_PACKAGE_PATH: '/tmp/caul-test/caul-arm64.deb'
    });

    expect(profile.vmName).toBe('Ubuntu Test');
    expect(profile.stagedPackagePath).toBe('/tmp/caul-test/caul-arm64.deb');
    expect(getVmProfile('linux').vmName).toBe('Ubuntu 24.04.3 ARM64');
  });
});

describe('VM command helpers', () => {
  it('encodes PowerShell without losing UNC paths or dollar variables', () => {
    const script = "$src='\\\\Mac\\Home\\code\\caul'; $dst='C:\\\\Users\\\\alex\\\\caul-e2e'";
    const args = createPowerShellEncodedArgs(script);
    const encoded = args.at(-1);
    const decoded = Buffer.from(encoded, 'base64').toString('utf16le');

    expect(args).toEqual(['powershell.exe', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded]);
    expect(decoded).toContain("\\\\Mac\\Home\\code\\caul");
    expect(decoded).toContain("$dst='C:\\\\Users\\\\alex\\\\caul-e2e'");
  });

  it('quotes macOS guest shell scripts as a single zsh command argument', () => {
    const args = macGuestShellArgs("test -d '/Users/alex/caul-e2e/models/parakeet'");

    expect(args).toEqual([
      '--current-user',
      '/bin/zsh',
      '-lc',
      "'test -d '\\''/Users/alex/caul-e2e/models/parakeet'\\'''"
    ]);
  });

  it('parses macOS app bundle versions', () => {
    const root = makeTempRoot();
    const plistPath = path.join(root, 'Caul.app', 'Contents', 'Info.plist');
    mkdirSync(path.dirname(plistPath), { recursive: true });
    writeFileSync(plistPath, [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<plist version="1.0">',
      '<dict>',
      '<key>CFBundleShortVersionString</key>',
      '<string>0.1.20</string>',
      '</dict>',
      '</plist>'
    ].join('\n'));

    expect(parseMacAppVersion(path.join(root, 'Caul.app'))).toBe('0.1.20');
  });

  it('parses Debian control package versions', () => {
    const control = [
      'Package: caul',
      'Version: 0.1.20',
      'Architecture: arm64'
    ].join('\n');

    expect(parseDebPackageVersion(control)).toBe('0.1.20');
  });
});

describe('VM summary helpers', () => {
  it('rejects summaries missing required release gates', () => {
    const summary = {
      profile: 'linux',
      vmName: 'Ubuntu 24.04.3 ARM64',
      packagePath: '/home/parallels/caul-e2e/release/caul-arm64.deb',
      packageVersion: '0.1.20',
      gates: {
        package: true,
        onboarding: true
      }
    };

    expect(validateVmE2eSummary(summary).ok).toBe(false);
    expect(validateVmE2eSummary(summary).missing).toContain('privacy');
  });

  it('accepts complete passing summaries', () => {
    const gates = Object.fromEntries([
      'package',
      'onboarding',
      'systemAudio',
      'microphone',
      'audioIsolation',
      'transcription',
      'ai',
      'privacy',
      'cleanup'
    ].map((gate) => [gate, true]));

    const summary = createVmE2eSummary({
      profile: 'win',
      vmName: 'Windows 11 ARM',
      packagePath: 'C:\\Users\\alex\\caul-e2e\\release\\Caul-windows-arm64-setup.exe',
      packageVersion: '0.1.20',
      gates
    });

    expect(summary.ok).toBe(true);
    expect(validateVmE2eSummary(summary)).toEqual({ ok: true, missing: [] });
  });
});

describe('VM cleanup helpers', () => {
  it('allows disposable VM release artefacts', () => {
    expect(shouldRemoveVmReleaseArtefact('/home/parallels/caul-e2e/release/caul-arm64.deb', 'linux')).toBe(true);
    expect(shouldRemoveVmReleaseArtefact('C:\\Users\\alex\\caul-e2e\\release\\Caul-windows-arm64-setup.exe', 'win')).toBe(true);
  });

  it('refuses shared source paths', () => {
    expect(() => assertDisposableVmPath('/media/psf/caul/release/caul-arm64.deb', 'linux')).toThrow(/shared source/i);
    expect(() => assertDisposableVmPath('\\\\Mac\\Home\\code\\caul\\release\\Caul-windows-arm64-setup.exe', 'win')).toThrow(/shared source/i);
  });
});
