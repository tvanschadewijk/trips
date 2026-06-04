import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const platform = process.platform;
const arch = process.arch;

if (platform !== 'linux') {
  process.exit(0);
}

const supportedArch = arch === 'x64' || arch === 'arm64';
if (!supportedArch) {
  throw new Error(`Unsupported Claude Agent SDK Linux architecture: ${arch}`);
}

const packageName = `@anthropic-ai/claude-agent-sdk-linux-${arch}`;
const binaryPath = join(process.cwd(), 'node_modules', packageName, 'claude');

if (existsSync(binaryPath)) {
  console.log(`Claude Agent SDK binary present: ${packageName}`);
  process.exit(0);
}

const sdkPackageJsonPath = join(
  process.cwd(),
  'node_modules',
  '@anthropic-ai',
  'claude-agent-sdk',
  'package.json'
);
const sdkPackageJson = JSON.parse(readFileSync(sdkPackageJsonPath, 'utf8'));
const version = sdkPackageJson.version;

console.log(`Claude Agent SDK binary missing; installing ${packageName}@${version}`);
execFileSync(
  'npm',
  [
    'install',
    '--no-save',
    '--package-lock=false',
    '--ignore-scripts',
    `${packageName}@${version}`,
  ],
  { stdio: 'inherit' }
);

if (!existsSync(binaryPath)) {
  throw new Error(`Claude Agent SDK binary still missing after install: ${binaryPath}`);
}
