import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import path from 'node:path';
import process from 'node:process';

const release = process.argv.includes('--release');
const cargo = resolveCargo();
const args = ['build', '-p', 'caul-desktop-backend'];
const cargoTarget = resolveCargoTarget();

if (release) {
  args.push('--release');
}

if (cargoTarget) {
  args.push('--target', cargoTarget);
}

const result = spawnSync(cargo, args, {
  stdio: 'inherit',
  env: {
    ...process.env,
    RUSTC: resolveRustc()
  }
});

process.exit(result.status ?? 1);

function resolveCargoTarget() {
  if (process.env.CAUL_DESKTOP_BACKEND_TARGET) {
    return process.env.CAUL_DESKTOP_BACKEND_TARGET;
  }

  const packagePlatform = process.env.CAUL_PACKAGE_PLATFORM;
  const packageArch = process.env.CAUL_PACKAGE_ARCH ?? process.arch;

  if (!packagePlatform || matchesHostPlatform(packagePlatform, packageArch)) {
    return null;
  }

  if ((packagePlatform === 'linux' || packagePlatform === 'linux-arm64') && packageArch === 'arm64') {
    return 'aarch64-unknown-linux-gnu';
  }

  if ((packagePlatform === 'linux' || packagePlatform === 'linux-x64') && packageArch === 'x64') {
    return 'x86_64-unknown-linux-gnu';
  }

  if ((packagePlatform === 'win' || packagePlatform === 'win32') && packageArch === 'arm64') {
    return 'aarch64-pc-windows-msvc';
  }

  if ((packagePlatform === 'win' || packagePlatform === 'win32') && packageArch === 'x64') {
    return 'x86_64-pc-windows-msvc';
  }

  return null;
}

function matchesHostPlatform(packagePlatform, packageArch) {
  const normalisedPackagePlatform = packagePlatform === 'win' ? 'win32' : packagePlatform === 'mac' ? 'darwin' : packagePlatform;
  return normalisedPackagePlatform === process.platform && packageArch === process.arch;
}

function resolveCargo() {
  if (process.env.CAUL_CARGO) {
    return process.env.CAUL_CARGO;
  }

  if (process.platform === 'win32') {
    const rustupCargo = 'C:\\WINDOWS\\system32\\config\\systemprofile\\.cargo\\bin\\cargo.exe';

    if (existsSync(rustupCargo)) {
      return rustupCargo;
    }
  }

  const userCargo = path.join(homedir(), '.cargo', 'bin', process.platform === 'win32' ? 'cargo.exe' : 'cargo');

  if (existsSync(userCargo)) {
    return userCargo;
  }

  return 'cargo';
}

function resolveRustc() {
  if (process.env.RUSTC) {
    return process.env.RUSTC;
  }

  if (process.platform === 'win32') {
    const rustupRustc = 'C:\\WINDOWS\\system32\\config\\systemprofile\\.cargo\\bin\\rustc.exe';

    if (existsSync(rustupRustc)) {
      return rustupRustc;
    }
  }

  const userRustc = path.join(homedir(), '.cargo', 'bin', process.platform === 'win32' ? 'rustc.exe' : 'rustc');

  if (existsSync(userRustc)) {
    return userRustc;
  }

  return 'rustc';
}
