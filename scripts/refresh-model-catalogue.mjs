import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const require = createRequire(import.meta.url);
const {
  loadModelCatalogue,
  writeLiveModelCatalogue
} = require('../electron/modelRecommendation.cjs');
const {
  refreshModelCatalogue
} = require('../electron/modelCatalogueRefresh.cjs');

const args = new Set(process.argv.slice(2));
const outputArg = getArgValue('--output');
const userDataArg = getArgValue('--user-data');
const writeBundled = args.has('--write-bundled');
const writeLive = Boolean(userDataArg);
const root = resolve(import.meta.dirname, '..');
const bundledPath = resolve(root, 'model-catalog.json');

if (writeBundled && outputArg) {
  throw new Error('Use either --write-bundled or --output, not both.');
}

const bundled = loadModelCatalogue(bundledPath);
const result = await refreshModelCatalogue(bundled);
const next = result.catalogue;

console.log(`Reviewed live model catalogue: ${result.reviewedAt}`);
console.log('');
console.log('Sources checked:');
for (const report of result.sourceReports) {
  console.log(`- ${report.ok ? 'ok' : 'warn'} ${report.source}: ${report.detail}`);
  console.log(`  ${report.url}`);
}

console.log('');
console.log('Local AI candidates:');
for (const model of next.aiResponse.filter((entry) => entry.local)) {
  console.log(`- ${model.id}: ${model.name}`);
  console.log(`  implemented=${model.implemented}; runtime=${model.runtime}; reviewed=${model.reviewedAt}`);
  console.log(`  quality=${model.benchmark?.qualitySource ?? 'unknown'}; download=${model.downloadSizeGb ?? 'unknown'} GB`);
}

if (writeBundled) {
  writeJsonFile(bundledPath, next);
  console.log('');
  console.log(`Updated bundled catalogue: ${bundledPath}`);
} else if (outputArg) {
  const outputPath = resolve(outputArg);
  writeJsonFile(outputPath, next);
  console.log('');
  console.log(`Wrote refreshed catalogue: ${outputPath}`);
} else if (writeLive) {
  const livePath = writeLiveModelCatalogue(resolve(userDataArg), next);
  console.log('');
  console.log(`Wrote live catalogue cache: ${livePath}`);
} else {
  console.log('');
  console.log('Dry run only. Use --output <path>, --user-data <path>, or --write-bundled to write results.');
}

function getArgValue(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) {
    return null;
  }

  const value = process.argv[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`${name} requires a value.`);
  }

  return value;
}

function writeJsonFile(filePath, value) {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}
