import { readFile } from 'node:fs/promises';

import { parseDebPackageVersion, parseMacAppVersion, runCommand } from './commands.mjs';

export async function getPackageVersion(profile, packagePath = profile.stagedPackagePath) {
  if (profile.packageType === 'app') {
    return parseMacAppVersion(packagePath);
  }

  if (profile.packageType === 'deb') {
    const result = await runCommand('dpkg-deb', ['-f', packagePath, 'Version'], { timeout: 15_000 });

    if (result.ok && result.stdout) {
      return result.stdout.trim();
    }

    const control = await readFile(packagePath, 'utf8');
    return parseDebPackageVersion(control);
  }

  if (profile.packageType === 'exe') {
    const manifestPath = `${packagePath}.version`;
    return (await readFile(manifestPath, 'utf8')).trim();
  }

  throw new Error(`Unsupported package type: ${profile.packageType}`);
}
