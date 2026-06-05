#!/usr/bin/env node

const path = require('node:path');
const { spawnSync } = require('node:child_process');

const rootDir = path.resolve(__dirname, '..');

async function main() {
  console.log('Using assets/caul-icon.svg as the canonical icon source.');

  const result = spawnSync(process.execPath, [path.join(__dirname, 'generate-icons.cjs')], {
    cwd: rootDir,
    stdio: 'inherit'
  });

  process.exit(result.status ?? 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
