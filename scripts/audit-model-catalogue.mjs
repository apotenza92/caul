import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const catalogue = JSON.parse(readFileSync(resolve(root, 'model-catalog.json'), 'utf8'));

console.log(`Caul model catalogue v${catalogue.version}`);
console.log(`Last reviewed: ${catalogue.lastReviewed}`);
console.log('');
console.log('Grounding sources:');

for (const source of Object.values(catalogue.sources)) {
  console.log(`- ${source.name}: ${source.url}`);
  if (source.paperUrl) {
    console.log(`  Paper: ${source.paperUrl}`);
  }
}

console.log('');
console.log('Entries to review:');

for (const group of ['transcription', 'aiResponse']) {
  console.log(`\n${group}:`);
  for (const model of catalogue[group]) {
    console.log(`- ${model.id}: ${model.name}`);
    console.log(`  Runtime: ${model.runtime}; implemented: ${model.implemented}`);
    console.log(`  Reviewed: ${model.reviewedAt}; source: ${model.provenanceUrl}`);
  }
}

console.log('');
console.log('Use npm run models:refresh for live source refresh. This audit script intentionally does not fetch online sources or rewrite model-catalog.json.');
