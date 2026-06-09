import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, rmSync, symlinkSync, writeFileSync, chmodSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import process from 'node:process';

const require = createRequire(import.meta.url);
const packageJson = require('../package.json');

const root = process.cwd();
const releaseDir = path.join(root, 'release');
const arch = process.argv[2] ?? process.env.CAUL_PACKAGE_ARCH ?? 'arm64';
const debArchitecture = arch === 'x64' ? 'amd64' : arch;
const isBeta = process.env.FORCE_BETA_BUILD === 'true'
  || packageJson.version.includes('-alpha')
  || packageJson.version.includes('-beta')
  || packageJson.version.includes('-rc');
const electronBuilderArch = arch === 'x64' ? 'x86_64' : arch;
const appDirName = arch === 'x64' ? 'linux-unpacked' : `linux-${arch}-unpacked`;
const appImageSourcePath = path.join(releaseDir, `caul${isBeta ? '-beta' : ''}-${electronBuilderArch}.AppImage`);
const appImageOutputPath = path.join(releaseDir, `caul${isBeta ? '-beta' : ''}-${arch}.AppImage`);
const appDir = path.join(releaseDir, appDirName);
const packageDir = path.join(releaseDir, `deb-${arch}`);
const outputPath = path.join(releaseDir, `caul${isBeta ? '-beta' : ''}-${arch}.deb`);
const appDisplayName = isBeta ? 'Caul Beta' : 'Caul';
const packageName = isBeta ? 'caul-beta' : 'caul';
const executableName = isBeta ? 'caul-beta' : 'caul';
const installDir = path.join(packageDir, 'opt', appDisplayName);
const controlDir = path.join(packageDir, 'DEBIAN');
const maintainer = 'Alex Potenza <apotenza92@users.noreply.github.com>';
const dependencies = [
  'libgtk-3-0',
  'libnotify4',
  'libnss3',
  'libxss1',
  'libxtst6',
  'xdg-utils',
  'libatspi2.0-0',
  'libuuid1',
  'libsecret-1-0'
];

if (!existsSync(appDir)) {
  console.error(`Linux unpacked app is missing: ${appDir}`);
  console.error('Run electron-builder for the Linux AppImage target before building the Debian package.');
  process.exit(1);
}

if (appImageSourcePath !== appImageOutputPath && existsSync(appImageSourcePath)) {
  rmSync(appImageOutputPath, { force: true });
  cpSync(appImageSourcePath, appImageOutputPath);
  rmSync(appImageSourcePath, { force: true });
}

rmSync(packageDir, { recursive: true, force: true });
mkdirSync(installDir, { recursive: true });
mkdirSync(controlDir, { recursive: true });
chmodSync(controlDir, 0o755);

cpSync(appDir, installDir, { recursive: true });
chmodSync(path.join(installDir, executableName), 0o755);

const chromeSandbox = path.join(installDir, 'chrome-sandbox');
if (existsSync(chromeSandbox)) {
  chmodSync(chromeSandbox, 0o4755);
}

const iconBase = path.join(packageDir, 'usr', 'share', 'icons', 'hicolor');
for (const size of ['16x16', '22x22', '24x24', '32x32', '48x48', '64x64', '72x72', '96x96', '128x128', '256x256', '512x512']) {
  const source = path.join(root, 'assets', 'icons', isBeta ? 'beta' : '', 'linux', `${size}.png`);
  if (!existsSync(source)) {
    continue;
  }

  const targetDir = path.join(iconBase, size, 'apps');
  mkdirSync(targetDir, { recursive: true });
  cpSync(source, path.join(targetDir, `${packageName}.png`));
}

const binDir = path.join(packageDir, 'usr', 'bin');
mkdirSync(binDir, { recursive: true });
symlinkSync(`/opt/${appDisplayName}/${executableName}`, path.join(binDir, packageName));

const applicationsDir = path.join(packageDir, 'usr', 'share', 'applications');
mkdirSync(applicationsDir, { recursive: true });
writeFileSync(
  path.join(applicationsDir, `${packageName}.desktop`),
  `[Desktop Entry]
Name=${appDisplayName}
Exec="/opt/${appDisplayName}/${executableName}" %U
Terminal=false
Type=Application
Icon=${packageName}
StartupWMClass=Caul
Comment=${packageJson.description}
Categories=Utility;
`
);

const installedSize = Math.ceil(directorySize(packageDir) / 1024);
writeFileSync(
  path.join(controlDir, 'control'),
  `Package: ${packageName}
Version: ${packageJson.version}
Section: utils
Priority: optional
Architecture: ${debArchitecture}
Maintainer: ${maintainer}
Installed-Size: ${installedSize}
Depends: ${dependencies.join(', ')}
Homepage: https://github.com/apotenza92/caul
Description: ${packageJson.description}
`
);

rmSync(outputPath, { force: true });
execFileSync('dpkg-deb', ['--root-owner-group', '--build', packageDir, outputPath], {
  stdio: 'inherit'
});

console.log(`Built Debian package: ${outputPath}`);

function directorySize(directory) {
  let total = 0;
  const entries = [directory];

  while (entries.length > 0) {
    const current = entries.pop();
    const currentStat = lstatSync(current);

    if (currentStat.isDirectory()) {
      for (const entry of readdirSync(current)) {
        entries.push(path.join(current, entry));
      }
      continue;
    }

    if (currentStat.isFile() || currentStat.isSymbolicLink()) {
      total += currentStat.size;
    }
  }

  return total;
}
