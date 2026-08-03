import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const executable = join(root, 'node_modules', '.bin', process.platform === 'win32' ? 'shadcn.cmd' : 'shadcn');
const protectedFiles = ['components.json', 'package.json', 'package-lock.json'];

function run(args) {
  const result = spawnSync(executable, args, {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' }
  });
  if (result.status !== 0) {
    process.stderr.write(result.stdout ?? '');
    process.stderr.write(result.stderr ?? '');
    process.exit(result.status ?? 1);
  }
  return result.stdout;
}

function hash(path) {
  return createHash('sha256').update(readFileSync(join(root, path))).digest('hex');
}

function collectFiles(directory) {
  return readdirSync(join(root, directory)).flatMap((name) => {
    const path = join(directory, name);
    return statSync(join(root, path)).isDirectory() ? collectFiles(path) : [path];
  });
}

const snapshotFiles = [...protectedFiles, ...collectFiles('src'), ...collectFiles('scripts')].sort();
const before = new Map(snapshotFiles.map((path) => [path, hash(path)]));

const info = JSON.parse(run(['info', '--json']));
const expected = {
  style: 'base-nova',
  base: 'base',
  iconLibrary: 'lucide',
  rsc: false,
  typescript: true,
  tailwindVersion: 'v4',
  presetCode: 'b2fA'
};
const observed = {
  style: info.config?.style,
  base: info.config?.base,
  iconLibrary: info.config?.iconLibrary,
  rsc: info.config?.rsc,
  typescript: info.config?.typescript,
  tailwindVersion: info.project?.tailwindVersion,
  presetCode: info.preset?.code
};
if (JSON.stringify(observed) !== JSON.stringify(expected)) {
  throw new Error(`Live shadcn contract drifted. Expected ${JSON.stringify(expected)}, received ${JSON.stringify(observed)}.`);
}
const expectedValues = {
  style: 'nova',
  baseColor: 'neutral',
  theme: 'neutral',
  chartColor: 'neutral',
  iconLibrary: 'lucide',
  font: 'geist',
  fontHeading: 'inherit',
  radius: 'default',
  menuAccent: 'subtle',
  menuColor: 'default'
};
if (JSON.stringify(info.preset?.values) !== JSON.stringify(expectedValues) || (info.preset?.fallbacks ?? []).length !== 0) {
  throw new Error('Live Nova preset values no longer match the reviewed baseline.');
}

const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
if (packageJson.devDependencies?.shadcn !== '4.16.1' || packageJson.devDependencies?.['@base-ui/react'] !== '1.6.0') {
  throw new Error('Exact reviewed dependency pins are missing.');
}

const components = [...new Set(info.components ?? [])].sort();
const canonicalFiles = [];
for (const component of components) {
  const registryItems = JSON.parse(run(['view', component]));
  const files = registryItems.flatMap((item) => item.files ?? []).filter((file) => file.type === 'registry:ui');
  if (files.length === 0) throw new Error(`No canonical registry:ui file was reported for ${component}.`);

  for (const file of files) {
    const target = `src/components/ui/${file.path.split('/').at(-1)}`;
    canonicalFiles.push(target);
    const output = run(['add', component, '--dry-run', '--diff', target]);
    if (!output.includes('No changes.') || /\((?:create|update|overwrite)\)/i.test(output)) {
      process.stderr.write(output);
      throw new Error(`Official registry drift detected for ${component}: ${target}.`);
    }
  }
}

const afterSnapshotFiles = [...protectedFiles, ...collectFiles('src'), ...collectFiles('scripts')].sort();
if (JSON.stringify(afterSnapshotFiles) !== JSON.stringify(snapshotFiles)) {
  throw new Error('Read-only audit created or removed a protected source file.');
}
for (const path of snapshotFiles) {
  if (hash(path) !== before.get(path)) throw new Error(`Read-only audit modified ${path}.`);
}

console.log(`shadcn live audit passed: ${components.length} components and ${canonicalFiles.length} canonical registry files are clean.`);
