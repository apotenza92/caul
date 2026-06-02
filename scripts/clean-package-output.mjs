import { rmSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const target = process.argv[2];
const arch = process.argv[3] ?? 'arm64';
const root = process.cwd();

if (target === 'win') {
  rmSync(path.join(root, 'release', `win-${arch}-unpacked`), { recursive: true, force: true });
  rmSync(path.join(root, 'release', `Susura-windows-${arch}-setup.exe`), { force: true });
  rmSync(path.join(root, 'release', `Susura-windows-${arch}-setup.exe.blockmap`), { force: true });
  rmSync(path.join(root, 'release', `Susura-Beta-windows-${arch}-setup.exe`), { force: true });
  rmSync(path.join(root, 'release', `Susura-Beta-windows-${arch}-setup.exe.blockmap`), { force: true });
  rmSync(path.join(root, 'release', 'latest.yml'), { force: true });
} else if (target === 'linux') {
  const electronBuilderArch = arch === 'x64' ? 'x86_64' : arch;
  const appDirName = arch === 'x64' ? 'linux-unpacked' : `linux-${arch}-unpacked`;
  rmSync(path.join(root, 'release', appDirName), { recursive: true, force: true });
  rmSync(path.join(root, 'release', `deb-${arch}`), { recursive: true, force: true });
  rmSync(path.join(root, 'release', `susura-${arch}.AppImage`), { force: true });
  rmSync(path.join(root, 'release', `susura-${electronBuilderArch}.AppImage`), { force: true });
  rmSync(path.join(root, 'release', `susura-${arch}.deb`), { force: true });
  rmSync(path.join(root, 'release', `susura-beta-${arch}.AppImage`), { force: true });
  rmSync(path.join(root, 'release', `susura-beta-${electronBuilderArch}.AppImage`), { force: true });
  rmSync(path.join(root, 'release', `susura-beta-${arch}.deb`), { force: true });
} else {
  console.error('Usage: node scripts/clean-package-output.mjs <win|linux> [arm64|x64]');
  process.exit(1);
}
