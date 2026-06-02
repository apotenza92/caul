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

const deleteResult = spawnSync('/usr/libexec/PlistBuddy', [
  '-c',
  'Delete :LSUIElement',
  infoPlistPath
], { encoding: 'utf8' });

if (deleteResult.status !== 0 && !String(deleteResult.stderr).includes('Does Not Exist')) {
  console.error(deleteResult.stderr || deleteResult.stdout);
  process.exit(deleteResult.status ?? 1);
}
