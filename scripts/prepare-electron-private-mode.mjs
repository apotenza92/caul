import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

if (process.platform !== 'darwin') {
  process.exit(0);
}

const infoPlistPath = path.join(
  process.cwd(),
  'node_modules',
  'electron',
  'dist',
  'Electron.app',
  'Contents',
  'Info.plist'
);

if (!existsSync(infoPlistPath)) {
  console.warn(`Electron Info.plist not found at ${infoPlistPath}`);
  process.exit(0);
}

const printResult = spawnSync('/usr/libexec/PlistBuddy', [
  '-c',
  'Print :LSUIElement',
  infoPlistPath
], { encoding: 'utf8' });

const command = printResult.status === 0
  ? 'Set :LSUIElement true'
  : 'Add :LSUIElement bool true';

const updateResult = spawnSync('/usr/libexec/PlistBuddy', [
  '-c',
  command,
  infoPlistPath
], { encoding: 'utf8' });

if (updateResult.status !== 0) {
  console.error(updateResult.stderr || updateResult.stdout);
  process.exit(updateResult.status ?? 1);
}
