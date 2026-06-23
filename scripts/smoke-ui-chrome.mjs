#!/usr/bin/env node

import { spawn, execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';

const DEFAULT_PATHS = [
  '/',
  '/onboarding',
  '/trips/new',
];

const VIEWPORTS = {
  desktop: { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false },
  mobile: { width: 390, height: 844, deviceScaleFactor: 2, mobile: true },
};

const HELP = `Usage:
  npm run smoke:ui
  SMOKE_BASE_URL=http://127.0.0.1:3000 npm run smoke:ui
  node scripts/smoke-ui-chrome.mjs /onboarding /trips/new

Environment:
  SMOKE_BASE_URL       Base URL for the running app. Default: http://localhost:3000
  SMOKE_VIEWPORT       desktop, mobile, or both. Default: desktop
  SMOKE_SCREENSHOTS    1 to save screenshots, 0 to skip. Default: 1
  SMOKE_SCREENSHOT_DIR Screenshot output dir. Default: OS temp directory
  CHROME_PATH          Override Chrome executable path.
`;

function parseArgs(argv) {
  if (argv.includes('--help') || argv.includes('-h')) {
    process.stdout.write(HELP);
    process.exit(0);
  }
  return argv.filter((arg) => !arg.startsWith('-'));
}

function commandExists(command) {
  try {
    return execFileSync('which', [command], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
}

function resolveChromePath() {
  const envPath = process.env.CHROME_PATH;
  if (envPath && existsSync(envPath)) return envPath;

  const candidates = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }

  for (const command of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser']) {
    const found = commandExists(command);
    if (found) return found;
  }

  throw new Error('Chrome was not found. Set CHROME_PATH to a Chrome or Chromium executable.');
}

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

async function waitFor(fn, label, timeoutMs = 10_000) {
  const started = Date.now();
  let lastError;
  while (Date.now() - started < timeoutMs) {
    try {
      const value = await fn();
      if (value) return value;
    } catch (err) {
      lastError = err;
    }
    await sleep(100);
  }
  throw new Error(`Timed out waiting for ${label}${lastError ? `: ${lastError.message}` : ''}`);
}

async function waitForDevToolsPort(profileDir) {
  const portFile = join(profileDir, 'DevToolsActivePort');
  const content = await waitFor(async () => {
    if (!existsSync(portFile)) return null;
    const text = await readFile(portFile, 'utf8');
    return text.trim() ? text : null;
  }, 'Chrome DevTools port');

  const [port] = content.split('\n');
  return Number(port);
}

async function stopChrome(chrome, profileDir) {
  if (chrome.exitCode === null && !chrome.killed) {
    chrome.kill('SIGTERM');
    await Promise.race([
      new Promise((resolveStop) => chrome.once('exit', resolveStop)),
      sleep(1500),
    ]);
  }
  await rm(profileDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }).catch(() => {});
}

async function createTarget(port) {
  const response = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, {
    method: 'PUT',
  });
  if (!response.ok) {
    throw new Error(`Could not create Chrome target: HTTP ${response.status}`);
  }
  const target = await response.json();
  if (!target.webSocketDebuggerUrl) {
    throw new Error('Chrome target did not expose a WebSocket debugger URL.');
  }
  return target.webSocketDebuggerUrl;
}

function connectCdp(webSocketUrl) {
  return new Promise((resolveConnect, rejectConnect) => {
    const ws = new WebSocket(webSocketUrl);
    const pending = new Map();
    const listeners = new Set();
    let nextId = 1;

    const cleanupOpen = () => {
      ws.removeEventListener('open', onOpen);
      ws.removeEventListener('error', onInitialError);
    };
    const onOpen = () => {
      cleanupOpen();
      resolveConnect({
        onEvent(listener) {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
        send(method, params = {}) {
          const id = nextId;
          nextId += 1;
          const payload = JSON.stringify({ id, method, params });
          return new Promise((resolveSend, rejectSend) => {
            pending.set(id, { resolveSend, rejectSend, method });
            ws.send(payload);
          });
        },
        close() {
          ws.close();
        },
      });
    };
    const onInitialError = () => {
      cleanupOpen();
      rejectConnect(new Error('Could not connect to Chrome DevTools WebSocket.'));
    };

    ws.addEventListener('open', onOpen);
    ws.addEventListener('error', onInitialError);
    ws.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id && pending.has(message.id)) {
        const pendingCall = pending.get(message.id);
        pending.delete(message.id);
        if (message.error) {
          pendingCall.rejectSend(
            new Error(`${pendingCall.method} failed: ${message.error.message}`)
          );
        } else {
          pendingCall.resolveSend(message.result ?? {});
        }
        return;
      }
      for (const listener of listeners) listener(message);
    });
    ws.addEventListener('close', () => {
      for (const { rejectSend, method } of pending.values()) {
        rejectSend(new Error(`${method} failed: Chrome DevTools WebSocket closed.`));
      }
      pending.clear();
    });
  });
}

function toUrl(baseUrl, pathOrUrl) {
  if (/^https?:\/\//iu.test(pathOrUrl)) return pathOrUrl;
  return new URL(pathOrUrl, baseUrl).toString();
}

function screenshotName(url, viewportName) {
  const parsed = new URL(url);
  const pathname = parsed.pathname === '/' ? 'home' : parsed.pathname.replace(/^\/|\/$/gu, '');
  const safePath = pathname.replace(/[^a-z0-9_-]+/giu, '-').toLowerCase();
  return `${safePath || 'page'}-${viewportName}.png`;
}

async function waitForDocumentComplete(cdp) {
  await waitFor(async () => {
    const result = await cdp.send('Runtime.evaluate', {
      expression: 'document.readyState',
      returnByValue: true,
    });
    return result.result?.value === 'complete';
  }, 'document.readyState === complete', 20_000);
}

async function inspectPage(cdp) {
  const result = await cdp.send('Runtime.evaluate', {
    returnByValue: true,
    expression: `(() => {
      const bodyText = document.body?.innerText?.trim() ?? '';
      const errorText = [
        'Unhandled Runtime Error',
        'Application error',
        'Hydration failed',
        'Internal Server Error',
        'This page could not be found'
      ];
      return {
        url: location.href,
        title: document.title,
        h1: document.querySelector('h1')?.textContent?.trim() ?? '',
        bodyTextLength: bodyText.length,
        hasNextError: errorText.some((text) => bodyText.includes(text)),
        visibleSample: bodyText.slice(0, 220)
      };
    })()`,
  });
  return result.result?.value;
}

async function waitForUsablePage(cdp, url) {
  return waitFor(async () => {
    const inspection = await inspectPage(cdp);
    if (!inspection) return null;
    if (inspection.hasNextError) {
      throw new Error(`${url} rendered a Next.js/runtime error.`);
    }
    if (inspection.bodyTextLength >= 20) return inspection;
    return null;
  }, `visible page content for ${url}`, 15_000);
}

function formatRuntimeFindings(findings) {
  if (!findings.length) return '';
  const unique = [...new Set(findings)].slice(0, 5);
  return ` Runtime findings: ${unique.join(' | ')}`;
}

async function captureScreenshot(cdp, outputDir, url, viewportName) {
  await mkdir(outputDir, { recursive: true });
  const result = await cdp.send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: false,
  });
  const file = join(outputDir, screenshotName(url, viewportName));
  await writeFile(file, Buffer.from(result.data, 'base64'));
  return file;
}

async function runSmoke() {
  const baseUrl = process.env.SMOKE_BASE_URL ?? 'http://localhost:3000';
  const requestedPaths = parseArgs(process.argv.slice(2));
  const pages = requestedPaths.length ? requestedPaths : DEFAULT_PATHS;
  const viewportMode = process.env.SMOKE_VIEWPORT ?? 'desktop';
  const viewportEntries = viewportMode === 'both'
    ? Object.entries(VIEWPORTS)
    : [[viewportMode, VIEWPORTS[viewportMode]]];

  if (!viewportEntries.every(([, viewport]) => viewport)) {
    throw new Error('SMOKE_VIEWPORT must be desktop, mobile, or both.');
  }

  const probe = await fetch(baseUrl, { redirect: 'manual' }).catch((err) => {
    throw new Error(`Could not reach ${baseUrl}. Start the app first. ${err.message}`);
  });
  if (probe.status >= 500) {
    throw new Error(`${baseUrl} returned HTTP ${probe.status}.`);
  }

  const chromePath = resolveChromePath();
  const profileDir = await mkdtemp(join(tmpdir(), 'ourtrips-chrome-profile-'));
  const screenshotDir = process.env.SMOKE_SCREENSHOT_DIR
    ? resolve(process.env.SMOKE_SCREENSHOT_DIR)
    : join(tmpdir(), 'ourtrips-ui-smoke');
  const shouldScreenshot = process.env.SMOKE_SCREENSHOTS !== '0';

  const chrome = spawn(chromePath, [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-networking',
    '--disable-dev-shm-usage',
    '--remote-debugging-port=0',
    `--user-data-dir=${profileDir}`,
    'about:blank',
  ], {
    stdio: ['ignore', 'ignore', 'pipe'],
  });

  let chromeError = '';
  chrome.stderr.on('data', (chunk) => {
    chromeError += chunk.toString();
  });

  try {
    const port = await waitForDevToolsPort(profileDir);
    const wsUrl = await createTarget(port);
    const cdp = await connectCdp(wsUrl);
    const documentResponses = [];
    const runtimeFindings = [];

    cdp.onEvent((message) => {
      if (message.method === 'Network.responseReceived' && message.params?.type === 'Document') {
        documentResponses.push(message.params.response);
      }
      if (message.method === 'Runtime.exceptionThrown') {
        const details = message.params?.exceptionDetails;
        runtimeFindings.push(
          details?.exception?.description
          ?? details?.text
          ?? 'Uncaught runtime exception'
        );
      }
      if (message.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(message.params?.type)) {
        const args = message.params.args ?? [];
        const text = args.map((arg) => arg.value ?? arg.description).filter(Boolean).join(' ');
        if (text) runtimeFindings.push(`console.${message.params.type}: ${text}`);
      }
      if (message.method === 'Log.entryAdded' && ['error', 'warning'].includes(message.params?.entry?.level)) {
        runtimeFindings.push(`log.${message.params.entry.level}: ${message.params.entry.text}`);
      }
    });

    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Network.enable');
    await cdp.send('Log.enable');

    const results = [];
    for (const [viewportName, viewport] of viewportEntries) {
      await cdp.send('Emulation.setDeviceMetricsOverride', viewport);

      for (const page of pages) {
        const url = toUrl(baseUrl, page);
        documentResponses.length = 0;
        runtimeFindings.length = 0;
        const navigation = await cdp.send('Page.navigate', { url });
        if (navigation.errorText) {
          throw new Error(`${url} navigation failed: ${navigation.errorText}`);
        }

        await waitForDocumentComplete(cdp);
        let inspection;
        try {
          inspection = await waitForUsablePage(cdp, url);
        } catch (err) {
          throw new Error(`${err.message}.${formatRuntimeFindings(runtimeFindings)}`);
        }
        const response = documentResponses.at(-1);

        if (response?.status >= 400) {
          throw new Error(`${url} returned HTTP ${response.status}.`);
        }

        const screenshot = shouldScreenshot
          ? await captureScreenshot(cdp, screenshotDir, url, viewportName)
          : null;

        results.push({
          viewport: viewportName,
          requested: url,
          finalUrl: inspection.url,
          status: response?.status ?? 'unknown',
          title: inspection.title,
          h1: inspection.h1,
          screenshot,
        });
      }
    }

    cdp.close();
    process.stdout.write(`UI smoke passed for ${results.length} page load${results.length === 1 ? '' : 's'}.\n`);
    for (const result of results) {
      const label = `${result.viewport} ${new URL(result.requested).pathname}`;
      const title = result.h1 || result.title || basename(new URL(result.finalUrl).pathname) || result.finalUrl;
      process.stdout.write(`- ${label}: HTTP ${result.status}, ${title}`);
      if (result.finalUrl !== result.requested) {
        process.stdout.write(` -> ${result.finalUrl}`);
      }
      if (result.screenshot) {
        process.stdout.write(` (${result.screenshot})`);
      }
      process.stdout.write('\n');
    }
  } finally {
    await stopChrome(chrome, profileDir);
    if (chrome.exitCode === 1 && chromeError.trim()) {
      process.stderr.write(chromeError);
    }
  }
}

runSmoke().catch((err) => {
  process.stderr.write(`UI smoke failed: ${err.message}\n`);
  process.exit(1);
});
