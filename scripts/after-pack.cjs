const fs = require('node:fs');
const path = require('node:path');

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') {
    return;
  }

  const appDisplayName = context.packager.appInfo.productName;
  const appPath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  const resourcesPath = path.join(appPath, 'Contents', 'Resources');
  const binDir = path.join(resourcesPath, 'bin');
  const piTuiDarwinPrebuilds = path.join(
    resourcesPath,
    'app.asar.unpacked',
    'node_modules',
    '@earendil-works',
    'pi-tui',
    'native',
    'darwin',
    'prebuilds'
  );

  for (const binaryName of ['caul-desktop-backend', 'CaulAudioHelper']) {
    const binaryPath = path.join(binDir, binaryName);

    if (fs.existsSync(binaryPath)) {
      fs.chmodSync(binaryPath, 0o755);
    }
  }

  // Caul's macOS release is arm64-only. pi-tui ships both Darwin prebuilds,
  // and electron-builder unpacks both unless the foreign binary is removed
  // before signing.
  fs.rmSync(path.join(piTuiDarwinPrebuilds, 'darwin-x64'), {
    recursive: true,
    force: true
  });
  fs.rmSync(
    path.join(
      resourcesPath,
      'app.asar.unpacked',
      'node_modules',
      '@mariozechner',
      'clipboard-darwin-x64'
    ),
    { recursive: true, force: true }
  );

  fs.writeFileSync(
    path.join(context.appOutDir, `Drag ${appDisplayName} to Applications folder.txt`),
    `To install ${appDisplayName}:\n\n1. Open your Applications folder.\n2. Drag "${appDisplayName}.app" into Applications.\n3. Launch ${appDisplayName} from Applications.\n\n${appDisplayName} works best when installed in Applications so macOS permissions and updates use the expected app identity.\n`,
    'utf8'
  );
};
