import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import path from 'node:path';
import process from 'node:process';

const release = process.argv.includes('--release');
const cargo = resolveCargo();
const args = ['build', '-p', 'susura-desktop-backend'];

if (release) {
  args.push('--release');
}

const result = spawnSync(cargo, args, {
  stdio: 'inherit',
  env: {
    ...process.env,
    RUSTC: resolveRustc()
  }
});

process.exit(result.status ?? 1);

function resolveCargo() {
  if (process.env.SUSURA_CARGO) {
    return process.env.SUSURA_CARGO;
  }

  if (process.platform === 'win32') {
    const rustupCargo = 'C:\\WINDOWS\\system32\\config\\systemprofile\\.cargo\\bin\\cargo.exe';

    if (existsSync(rustupCargo)) {
      return rustupCargo;
    }
  }

  const userCargo = path.join(homedir(), '.cargo', 'bin', 'cargo');

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

  const userRustc = path.join(homedir(), '.cargo', 'bin', 'rustc');

  if (existsSync(userRustc)) {
    return userRustc;
  }

  return 'rustc';
}
