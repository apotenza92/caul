import { copyFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

if (process.platform !== 'win32') {
  process.exit(0);
}

const system7z = 'C:\\Program Files\\7-Zip\\7z.exe';

if (!existsSync(system7z)) {
  console.error(`Windows NSIS packaging requires system 7-Zip at ${system7z}.`);
  console.error('Install it with: choco install 7zip -y');
  process.exit(1);
}

// The 7zip-bin package returns the bare name "7za" when USE_SYSTEM_7ZA=true
// and builder-util chmods that path before spawning it. Providing a local copy
// keeps that chmod check happy while PATH resolution can use 7za.exe.
copyFileSync(system7z, path.join(process.cwd(), '7za'));

try {
  copyFileSync(system7z, 'C:\\ProgramData\\chocolatey\\bin\\7za.exe');
} catch {
  // The repo-local 7za file is enough for builder-util's chmod check. If the
  // PATH copy cannot be written, the user's existing PATH may still provide it.
}
