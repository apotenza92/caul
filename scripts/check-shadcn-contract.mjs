import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const uiDirectory = join(root, 'src/components/ui');
const domainDirectory = join(root, 'src/components/domain-ui');
const expectedPreset = 'b2fA';
const expectedGeneratedHashes = {
  'alert-dialog.tsx': '7abcaccfeb706cdaecc56f02a1b0ccb1be3f26ff2de8cf172a46b2bd550c1987',
  'alert.tsx': '126a26b401ab2cd3f3855551d012b5dca7a96b7d6984a921add3ce2d441af4b6',
  'badge.tsx': '968b0403af74a785c9408ca69a677235e49d0c80b2c27fb9858ad421a8778c7d',
  'button-group.tsx': 'fe97631e1a07bc0add09503c5032002e37f4c71ef5dd3c7475b856a29848583d',
  'button.tsx': 'd14549ab3ba7a9d5d1f424c2599233bffa0b317121abf3b6efa2fb902d5e2781',
  'card.tsx': 'd8113cbf964f8d1aadf2649d2944d8bbc6e3cfd49d36746f76868cbc4dde3cfe',
  'checkbox.tsx': 'ffab01da29fc013583e62d55aac4c5fd5e328a40133aea8bad7535d3a1e5c851',
  'dialog.tsx': 'dd373d38c46f0e2227238fb517a7e58351cba91cd8b4a663641b7cfab7fbd697',
  'empty.tsx': 'e65ee3ba54a21ed61e3c50041bb12a6a3fcb215c56611cda6795c23a7bd89f61',
  'field.tsx': '8c22c6645b6d894b020c9d6dd93131f4f5f5b14b922b86e24337eafa26cdfe22',
  'input-group.tsx': '80aa50078def5811cb80ceaee2e9f75472ea00b3e4966abf757f207716f645fb',
  'input.tsx': 'f7d6ecff9a4d631feeaf401c02bb87e26ddb38131c55d15a43b9290747390847',
  'label.tsx': 'fc58859ab5ee622b2fe853a6501a0ed8008d022ab34a4f0bf98bb7324c5b3619',
  'popover.tsx': '59a0d01d22af44dc9969c3c2aac7cc2f5b712c51ee4c73e8453d81f3d9819ed1',
  'progress.tsx': '1094f7bfab6d69aa0fd8132987147be4ea3583efd826050278344629e9a6d555',
  'select.tsx': '41685f5d3a488b4e512bc9cee80738087f3e84c92f67e89eed9fc4858f81abe6',
  'separator.tsx': '082aff76b823256112a622d92dcef79dd008fe8c252611e184c002db770763f3',
  'spinner.tsx': '900f722c961fa6e1c28104809d56831c9056dc69599e49d364cc13a6f33966a3',
  'tabs.tsx': '84c1ebcee9c620b4b9543b1fe097307051a68ee7bd2901241a962360337f1191',
  'textarea.tsx': '58b58d84fc54ba5f4ca46937870c619349fd9eccc4d494250ac7bc73a94e05e9',
  'toggle-group.tsx': 'f7776d68b06148d9742fe4f21df45f931b2a259592192d4bda16a7039f508d15',
  'toggle.tsx': '38b81d3872be232a2617a791069a43e2cc415208e3eff14814324319559fdde9',
  'tooltip.tsx': 'a9f7b6823ef80334f2a70ee0e7eb40e01f095d63f7e354be6b7c499e2d2c84aa'
};
const expectedDomainFiles = [
  'app-tooltip-content.tsx',
  'macos-window-button.tsx',
  'overlay-handle-button.tsx',
  'overlay-resize-handles.tsx',
  'vertical-toggle-group.tsx'
];
const allowedBaseUiDomainFiles = new Set([
  'src/components/domain-ui/vertical-toggle-group.tsx'
]);
const allowedGeneratedLayoutReferences = new Set([
  'aiManualPromptInput',
  'compactToolbarButton',
  'homeToolbarBottomActionGroup',
  'modalCloseButton',
  'modalCloseButtonDesktop',
  'pickerList',
  'pickerListScrollable',
  'promptTemplateTrigger',
  'promptTemplateTriggerVertical',
  'sectionCollapseButton',
  'sectionPreviewTooltip',
  'settingsInlineGroup',
  'settingsPageStack',
  'settingsSectionBody',
  'sideToolbarButton',
  'sideToolbarIconButton',
  'windowTitleBarButton',
  'windowTitleBarHistoryButtonDesktop',
  'windowTitleBarHistoryButtonMac',
  'windowTitleBarNotificationButtonDesktop',
  'windowTitleBarNotificationButtonMac',
  'windowTitleBarQuitButton',
  'windowTitleBarSettingsButton',
  'windowTitleBarSettingsButtonDesktop',
  'windowTitleBarSettingsButtonMac'
]);
const errors = [];

function readJson(path) {
  return JSON.parse(readFileSync(join(root, path), 'utf8'));
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function fail(message) {
  errors.push(message);
}

const config = readJson('components.json');
const expectedConfig = {
  style: 'base-nova',
  rsc: false,
  tsx: true,
  iconLibrary: 'lucide',
  rtl: false,
  menuColor: 'default',
  menuAccent: 'subtle'
};
for (const [key, value] of Object.entries(expectedConfig)) {
  if (config[key] !== value) fail(`components.json ${key} must be ${JSON.stringify(value)}.`);
}
if (config.tailwind?.css !== 'src/styles.css' || config.tailwind?.baseColor !== 'neutral' || config.tailwind?.cssVariables !== true || config.tailwind?.prefix !== '') {
  fail('components.json Tailwind configuration drifted from the reviewed Nova contract.');
}
const expectedAliases = {
  components: '@/components',
  utils: '@/lib/utils',
  ui: '@/components/ui',
  lib: '@/lib',
  hooks: '@/hooks'
};
if (JSON.stringify(config.aliases) !== JSON.stringify(expectedAliases) || Object.keys(config.registries ?? {}).length !== 0) {
  fail('components.json aliases or registries drifted from the reviewed Nova contract.');
}

const packageJson = readJson('package.json');
if (packageJson.packageManager !== 'npm@11.13.0') fail('packageManager must remain pinned to npm@11.13.0.');
if (packageJson.devDependencies?.shadcn !== '4.16.1') fail('shadcn must remain pinned exactly to 4.16.1.');
if (packageJson.devDependencies?.['@base-ui/react'] !== '1.6.0') fail('@base-ui/react must remain pinned exactly to 1.6.0.');
for (const section of ['dependencies', 'devDependencies', 'peerDependencies']) {
  for (const dependency of Object.keys(packageJson[section] ?? {})) {
    if (dependency.startsWith('@radix-ui/')) fail(`Radix package is prohibited: ${dependency}.`);
  }
}

const skillLock = readJson('skills-lock.json');
if (!existsSync(join(root, '.agents/skills/shadcn/SKILL.md')) || skillLock.skills?.shadcn?.source !== 'shadcn/ui') {
  fail('The official project-scoped shadcn skill and lock entry are required.');
}

const generatedFiles = readdirSync(uiDirectory).filter((name) => name.endsWith('.tsx')).sort();
const expectedGeneratedFiles = Object.keys(expectedGeneratedHashes).sort();
if (JSON.stringify(generatedFiles) !== JSON.stringify(expectedGeneratedFiles)) {
  fail(`Generated directory contents changed. Expected ${expectedGeneratedFiles.join(', ')}; received ${generatedFiles.join(', ')}.`);
}
for (const [name, expectedHash] of Object.entries(expectedGeneratedHashes)) {
  const path = join(uiDirectory, name);
  if (!existsSync(path) || sha256(path) !== expectedHash) fail(`Generated component drifted from reviewed ${expectedPreset} output: ${name}.`);
}

const domainFiles = existsSync(domainDirectory)
  ? readdirSync(domainDirectory).filter((name) => name.endsWith('.tsx')).sort()
  : [];
if (JSON.stringify(domainFiles) !== JSON.stringify(expectedDomainFiles)) {
  fail(`Domain UI allowlist changed. Expected ${expectedDomainFiles.join(', ')}; received ${domainFiles.join(', ')}.`);
}
for (const name of expectedDomainFiles) {
  const source = readFileSync(join(domainDirectory, name), 'utf8');
  if (!source.includes('official') || !source.includes('considered') || !source.includes('data-domain-ui=')) {
    fail(`Domain UI exception lacks its official-alternative explanation or marker: ${name}.`);
  }
}
const domainTest = join(root, 'src/components/domain-ui.test.tsx');
if (!existsSync(domainTest)) {
  fail('Domain UI exceptions require deterministic behaviour and accessibility coverage.');
} else {
  const testSource = readFileSync(domainTest, 'utf8');
  for (const marker of ['app-tooltip-content', 'macos-window-button', 'overlay-handle-button', 'overlay-resize-handles', 'vertical-toggle-group']) {
    if (!testSource.includes(marker)) fail(`Domain UI tests do not cover ${marker}.`);
  }
}

const sourceFiles = execFileSync('git', ['ls-files', '-co', '--exclude-standard'], { cwd: root, encoding: 'utf8' })
  .trim()
  .split('\n')
  .filter((name) => /\.(?:[cm]?[jt]sx?|css)$/.test(name) && existsSync(join(root, name)));
for (const name of sourceFiles) {
  if (name.startsWith('src/components/ui/')) continue;
  if (name === 'scripts/check-shadcn-contract.mjs') continue;
  const source = readFileSync(join(root, name), 'utf8');
  if (/@radix-ui\//i.test(source) || /\basChild\b/.test(source) || /--radix-/i.test(source) || /data-\[state(?:=|\])/i.test(source)) {
    fail(`Prohibited Radix pattern found in ${name}.`);
  }
  if (/from\s+['"]@base-ui\/react(?:\/|['"])/.test(source) && !allowedBaseUiDomainFiles.has(name)) {
    fail(`Application composition must import generated UI instead of Base UI directly: ${name}.`);
  }
  if (/\bbase-rhea\b|\brhea-specific\b/i.test(source)) fail(`Rhea application pattern found in ${name}.`);
  if (/onDoubleClick\s*=|\bdblclick\b/i.test(source)) fail(`Hidden double-click behaviour found in ${name}.`);
}

const rawControls = [];
for (const name of sourceFiles.filter((file) => file.endsWith('.tsx') && !file.startsWith('src/components/ui/'))) {
  const source = readFileSync(join(root, name), 'utf8');
  for (const match of source.matchAll(/<(button|input|select|textarea)\b[^>]*>/g)) {
    rawControls.push({ name, tag: match[1], markup: match[0] });
  }
}
for (const control of rawControls) {
  const allowedDomainButton = expectedDomainFiles.some((name) => control.name === `src/components/domain-ui/${name}`) && control.tag === 'button';
  const allowedHiddenInput = control.name === 'src/App.tsx' && control.tag === 'input' && /type="hidden"/.test(control.markup);
  if (!allowedDomainButton && !allowedHiddenInput) fail(`Raw ${control.tag} is not allowlisted in ${control.name}.`);
}

function tokenIsAppearanceOverride(token) {
  let value = token.replace(/^!/, '');
  while (/^(?:sm|md|lg|xl|2xl|dark|hover|active|focus|focus-visible|focus-within|disabled|aria-[^:]+|data-[^:]+|group-[^:]+):/.test(value)) {
    value = value.slice(value.indexOf(':') + 1).replace(/^!/, '');
  }
  return /^(?:bg-|border(?:-|$)|rounded(?:-|$)|shadow(?:-|$)|ring(?:-|$)|outline(?:-|$)|text-|font-|leading-|tracking-|opacity-|transition(?:-|$)|duration-|ease-|animate-|fill-|stroke-|decoration-)/.test(value);
}

for (const name of sourceFiles.filter((file) => file.endsWith('.tsx') && !file.startsWith('src/components/ui/'))) {
  const path = join(root, name);
  const source = readFileSync(path, 'utf8');
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const generatedNames = new Set();
  for (const statement of file.statements) {
    if (!ts.isImportDeclaration(statement) || !statement.moduleSpecifier.text.startsWith('@/components/ui/')) continue;
    const bindings = statement.importClause?.namedBindings;
    if (bindings && ts.isNamedImports(bindings)) {
      for (const element of bindings.elements) generatedNames.add(element.name.text);
    }
  }

  function inspect(node) {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = node.tagName.getText(file);
      if (generatedNames.has(tag)) {
        const attribute = node.attributes.properties.find((item) => ts.isJsxAttribute(item) && item.name.text === 'className');
        if (attribute) {
          const text = attribute.getText(file);
          const line = file.getLineAndCharacterOfPosition(attribute.getStart(file)).line + 1;
          for (const literal of text.matchAll(/['"`]([^'"`]*)['"`]/g)) {
            for (const token of literal[1].split(/\s+/).filter(Boolean)) {
              if (tokenIsAppearanceOverride(token) && token !== 'sr-only') {
                fail(`Generated ${tag} receives appearance class ${token} in ${name}:${line}.`);
              }
            }
          }
          for (const reference of text.matchAll(/layout\.([A-Za-z0-9_]+)/g)) {
            if (!allowedGeneratedLayoutReferences.has(reference[1])) {
              fail(`Generated ${tag} uses unreviewed layout class reference layout.${reference[1]} in ${name}:${line}.`);
            }
          }
        }
      }
    }
    ts.forEachChild(node, inspect);
  }
  inspect(file);
}

const trackedFiles = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' }).trim().split('\n');
const reviewedPathFixtureFiles = new Set(['scripts/vm.test.mjs', 'scripts/vm/profiles.mjs', 'src/App.test.tsx']);
for (const name of trackedFiles) {
  if (/(^|\/)(?:dist|coverage|test-results|playwright-report)(?:\/|$)|\.DS_Store$|\/screenshots?\//i.test(name)) {
    fail(`Tracked generated or machine-specific artefact is prohibited: ${name}.`);
  }
  if (/\.(?:ts|tsx|js|mjs|cjs|json|md|css|html|yml|yaml)$/.test(name)) {
    if (!existsSync(join(root, name))) continue;
    const source = readFileSync(join(root, name), 'utf8');
    if (/\/Users\/[A-Za-z0-9._-]+\//.test(source) && !reviewedPathFixtureFiles.has(name)) {
      fail(`Machine-specific absolute path found in ${name}.`);
    }
  }
}

if (errors.length > 0) {
  console.error(`shadcn contract check failed with ${errors.length} issue(s):`);
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(`shadcn contract check passed: Base UI Nova preset ${expectedPreset}, ${generatedFiles.length} canonical components, ${domainFiles.length} domain exceptions.`);
