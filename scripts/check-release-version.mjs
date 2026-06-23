#!/usr/bin/env node
import { execFileSync } from 'node:child_process';

const REQUIRED_RELEASE_FILES = ['package.json', 'package-lock.json', 'CHANGELOG.md'];

const RELEASE_RELEVANT_PATTERNS = [
  /^src\//,
  /^node-backend\//,
  /^public\//,
  /^scripts\/(generate-static-content|ensure-claude-agent-binary|generate-our-trips-brand-video|compose-our-trips-brand-video)\b/,
  /^package(?:-lock)?\.json$/,
  /^next\.config\./,
  /^postcss\.config\./,
  /^tailwind\.config\./,
  /^eslint\.config\./,
  /^tsconfig(?:\.[^.]+)?\.json$/,
  /^wrangler(?:\.[^.]+)?\.jsonc$/,
  /^cloudflare-env\.d\.ts$/,
];

function git(args) {
  return execFileSync('git', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function isZeroSha(value) {
  return /^0{40}$/.test(value ?? '');
}

function resolveBase(head) {
  const envBase = process.env.BASE_SHA || process.argv[2];
  if (envBase && !isZeroSha(envBase)) {
    return envBase;
  }

  try {
    return git(['rev-parse', `${head}^`]);
  } catch {
    return null;
  }
}

function readJsonAt(ref, filePath) {
  return JSON.parse(git(['show', `${ref}:${filePath}`]));
}

function readTextAt(ref, filePath) {
  return git(['show', `${ref}:${filePath}`]);
}

function parseVersion(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(version ?? '');
  if (!match) {
    throw new Error(`Expected a semver version, got "${version}"`);
  }

  return match.slice(1, 4).map(Number);
}

function compareVersions(left, right) {
  const a = parseVersion(left);
  const b = parseVersion(right);

  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) {
      return a[index] - b[index];
    }
  }

  return 0;
}

function isReleaseRelevant(filePath) {
  return RELEASE_RELEVANT_PATTERNS.some((pattern) => pattern.test(filePath));
}

function fail(message, details = []) {
  console.error(message);
  for (const detail of details) {
    console.error(`- ${detail}`);
  }
  process.exit(1);
}

const head = process.env.HEAD_SHA || process.argv[3] || 'HEAD';
const base = resolveBase(head);

if (!base) {
  console.log('No base commit available; skipping release version check.');
  process.exit(0);
}

const changedFiles = git(['diff', '--name-only', '--diff-filter=ACMRTD', base, head])
  .split('\n')
  .filter(Boolean);

const releaseRelevantFiles = changedFiles.filter(isReleaseRelevant);

if (releaseRelevantFiles.length === 0) {
  console.log('No production-impacting files changed; release version check skipped.');
  process.exit(0);
}

const missingReleaseFiles = REQUIRED_RELEASE_FILES.filter((filePath) => !changedFiles.includes(filePath));
if (missingReleaseFiles.length > 0) {
  fail('Production-impacting changes must include a version bump and changelog entry.', [
    `Changed production-impacting files: ${releaseRelevantFiles.join(', ')}`,
    `Missing release files: ${missingReleaseFiles.join(', ')}`,
  ]);
}

const previousPackageJson = readJsonAt(base, 'package.json');
const nextPackageJson = readJsonAt(head, 'package.json');
const nextPackageLock = readJsonAt(head, 'package-lock.json');
const nextVersion = nextPackageJson.version;

if (compareVersions(nextVersion, previousPackageJson.version) <= 0) {
  fail('package.json version must increase for production-impacting changes.', [
    `Previous version: ${previousPackageJson.version}`,
    `Next version: ${nextVersion}`,
  ]);
}

const lockfileVersion = nextPackageLock.version;
const rootPackageVersion = nextPackageLock.packages?.['']?.version;
if (lockfileVersion !== nextVersion || rootPackageVersion !== nextVersion) {
  fail('package-lock.json must match the package.json version.', [
    `package.json: ${nextVersion}`,
    `package-lock.json version: ${lockfileVersion}`,
    `package-lock root package version: ${rootPackageVersion}`,
  ]);
}

const changelog = readTextAt(head, 'CHANGELOG.md');
if (!changelog.includes(nextVersion)) {
  fail('CHANGELOG.md must mention the new package version.', [`Missing version: ${nextVersion}`]);
}

console.log(`Release version check passed: ${previousPackageJson.version} -> ${nextVersion}`);
