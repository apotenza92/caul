#!/usr/bin/env node

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

export function extractReleaseNotes(changelog, version) {
  const lines = String(changelog).split(/\r?\n/);
  const heading = `## [${version}]`;
  const start = lines.findIndex((line) => line === heading || line.startsWith(`${heading} `));
  const nextHeading = start < 0
    ? -1
    : lines.findIndex((line, index) => index > start && /^## \[[^\]]+\]/.test(line));
  const notes = start < 0
    ? ''
    : lines.slice(start + 1, nextHeading < 0 ? undefined : nextHeading).join('\n').trim();

  if (!notes) {
    throw new Error(`CHANGELOG.md does not contain release notes for ${version}.`);
  }

  return notes;
}

function parseArguments(args) {
  const options = {
    changelog: 'CHANGELOG.md',
    output: null,
    version: null
  };

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];

    if (argument === '--changelog') {
      options.changelog = args[index + 1];
      index += 1;
    } else if (argument === '--output') {
      options.output = args[index + 1];
      index += 1;
    } else if (argument === '--version') {
      options.version = args[index + 1];
      index += 1;
    } else {
      throw new Error(`Unknown release-notes argument: ${argument}`);
    }
  }

  if (!options.version) {
    throw new Error('Release notes require --version.');
  }

  return options;
}

function main(args = process.argv.slice(2)) {
  const options = parseArguments(args);
  const changelog = readFileSync(path.resolve(options.changelog), 'utf8');
  const notes = `${extractReleaseNotes(changelog, options.version)}\n`;

  if (options.output) {
    writeFileSync(path.resolve(options.output), notes, 'utf8');
    return;
  }

  process.stdout.write(notes);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
