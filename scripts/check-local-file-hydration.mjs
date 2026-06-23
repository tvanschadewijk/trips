#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { platform } from 'node:os';
import { basename, extname } from 'node:path';

const CRITICAL_FILES = [
  'tsconfig.build.json',
  'tsconfig.json',
  'next-env.d.ts',
  'next.config.ts',
  'node_modules/typescript/bin/tsc',
  'node_modules/typescript/lib/tsc.js',
  'node_modules/typescript/lib/_tsc.js',
];

const SCAN_ROOTS = [
  'src',
  'scripts',
  '.next/types',
  '.next/dev/types',
  'node_modules',
];

const TYPECHECK_EXTENSIONS = new Set([
  '.cjs',
  '.cts',
  '.d.ts',
  '.js',
  '.jsx',
  '.mjs',
  '.mts',
  '.ts',
  '.tsx',
]);

function statFlags(file) {
  try {
    return execFileSync('stat', ['-f', '%Sf', file], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 2000,
    }).trim();
  } catch {
    return '';
  }
}

function findDatalessFiles(roots) {
  const existingRoots = roots.filter((root) => existsSync(root));
  if (!existingRoots.length) return [];

  try {
    return execFileSync('find', [...existingRoots, '-type', 'f', '-flags', '+dataless', '-print'], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 10000,
    })
      .split('\n')
      .map((file) => file.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function isTypecheckRelevant(file) {
  if (CRITICAL_FILES.includes(file)) return true;
  if (file.startsWith('node_modules/') && basename(file) === 'package.json') return true;
  return TYPECHECK_EXTENSIONS.has(extname(file));
}

if (platform() !== 'darwin') {
  process.exit(0);
}

const datalessFiles = [
  ...CRITICAL_FILES.filter((file) => (
    existsSync(file) && statFlags(file).split(',').includes('dataless')
  )),
  ...findDatalessFiles(SCAN_ROOTS).filter(isTypecheckRelevant),
].filter((file, index, files) => files.indexOf(file) === index);

if (!datalessFiles.length) {
  process.exit(0);
}

console.error('');
console.error('Typecheck cannot start because macOS reports critical project files as dataless/offloaded:');
for (const file of datalessFiles.slice(0, 30)) {
  console.error(`  - ${file}`);
}
if (datalessFiles.length > 30) {
  console.error(`  - ...and ${datalessFiles.length - 30} more`);
}
console.error('');
console.error('This usually comes from iCloud Drive or Optimize Mac Storage. Hydrate the files or reinstall dependencies before running typecheck:');
console.error('  npm ci');
console.error('');
console.error('If the files keep becoming dataless, move this checkout out of an iCloud-synced folder or disable Optimize Mac Storage for it.');
console.error('');
process.exit(1);
