import { rmSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const target = process.argv[2];
const arch = process.argv[3] ?? 'arm64';
const root = process.cwd();

if (target === 'win') {
  rmSync(path.join(root, 'release', `win-${arch}-unpacked`), { recursive: true, force: true });
  rmSync(path.join(root, 'release', `Caul-windows-${arch}-setup.exe`), { force: true });
  rmSync(path.join(root, 'release', `Caul-windows-${arch}-setup.exe.blockmap`), { force: true });
  rmSync(path.join(root, 'release', `Caul-Beta-windows-${arch}-setup.exe`), { force: true });
  rmSync(path.join(root, 'release', `Caul-Beta-windows-${arch}-setup.exe.blockmap`), { force: true });
  rmSync(path.join(root, 'release', 'latest.yml'), { force: true });
} else if (target === 'linux') {
  const electronBuilderArch = arch === 'x64' ? 'x86_64' : arch;
  const appDirName = arch === 'x64' ? 'linux-unpacked' : `linux-${arch}-unpacked`;
  rmSync(path.join(root, 'release', appDirName), { recursive: true, force: true });
  rmSync(path.join(root, 'release', `deb-${arch}`), { recursive: true, force: true });
  rmSync(path.join(root, 'release', `caul-${arch}.AppImage`), { force: true });
  rmSync(path.join(root, 'release', `caul-${electronBuilderArch}.AppImage`), { force: true });
  rmSync(path.join(root, 'release', `caul-${arch}.deb`), { force: true });
  rmSync(path.join(root, 'release', `caul-${arch}.rpm`), { force: true });
  rmSync(path.join(root, 'release', `caul-${electronBuilderArch}.rpm`), { force: true });
  rmSync(path.join(root, 'release', `caul-beta-${arch}.AppImage`), { force: true });
  rmSync(path.join(root, 'release', `caul-beta-${electronBuilderArch}.AppImage`), { force: true });
  rmSync(path.join(root, 'release', `caul-beta-${arch}.deb`), { force: true });
  rmSync(path.join(root, 'release', `caul-beta-${arch}.rpm`), { force: true });
  rmSync(path.join(root, 'release', `caul-beta-${electronBuilderArch}.rpm`), { force: true });
} else {
  console.error('Usage: node scripts/clean-package-output.mjs <win|linux> [arm64|x64]');
  process.exit(1);
}
