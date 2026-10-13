import { spawn, spawnSync } from 'node:child_process';
import { existsSync, openSync, closeSync, readFileSync } from 'node:fs';
import fs from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';


const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const serverScript = path.join(repoRoot, 'scripts', 'run_e2e_server.py');

const START_TIMEOUT_MS = 120_000;
const STOP_TIMEOUT_MS = 10_000;


function getEnv(name, fallback) {
  const value = String(process.env[name] || '').trim();
  return value || fallback;
}


function moduleProfile() {
  return getEnv('XKEEN_E2E_MODULE_PROFILE', 'full').replace(/[^a-z0-9_-]/gi, '-') || 'full';
}


// Every parallel worker owns one server. The port is the only thing that
// separates their disposable state, so it is part of every per-run name.
export function workerPort(parallelIndex) {
  return Number(getEnv('XKEEN_E2E_PORT', '18188')) + parallelIndex;
}


function e2eRunNamespace(port) {
  return `${moduleProfile()}-${port}`;
}


function authStatePath(port) {
  return path.join(repoRoot, 'e2e', '.auth', `user-${e2eRunNamespace(port)}.json`);
}


function pickPython() {
  const local = [
    path.join(repoRoot, '.venv', 'bin', 'python'),
    path.join(repoRoot, '.venv', 'Scripts', 'python.exe'),
  ].find((candidate) => existsSync(candidate));
  return local || (process.platform === 'win32' ? 'python' : 'python3');
}


function portIsBusy(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port });
    const finish = (busy) => {
      socket.destroy();
      resolve(busy);
    };
    socket.setTimeout(2_000, () => finish(false));
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
  });
}


function logTail(logPath) {
  try {
    return readFileSync(logPath, 'utf8').split(/\r?\n/).slice(-30).join('\n');
  } catch (error) {
    return '';
  }
}


async function waitUntilReady(child, baseURL, logPath) {
  const deadline = Date.now() + START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`E2E server for ${baseURL} exited with code ${child.exitCode}.\n${logTail(logPath)}`);
    }
    try {
      const response = await fetch(`${baseURL}/setup`, { signal: AbortSignal.timeout(5_000) });
      if (response.status < 500) return;
    } catch (error) {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`E2E server for ${baseURL} did not start in ${START_TIMEOUT_MS} ms.\n${logTail(logPath)}`);
}


async function startServer(port) {
  if (await portIsBusy(port)) {
    throw new Error(
      `Port ${port} is already in use, most likely by a server left over from an interrupted run. `
      + 'Stop it or choose another base port with XKEEN_E2E_PORT.',
    );
  }

  const runDir = path.join(repoRoot, '.tmp', 'e2e-runs', e2eRunNamespace(port));
  await fs.mkdir(runDir, { recursive: true });
  const logPath = path.join(runDir, 'server.log');
  const logFd = openSync(logPath, 'a');

  // stdin stays a pipe on purpose: the server exits when it reaches EOF, so a
  // killed worker or an interrupted run cannot leave it listening.
  const child = spawn(pickPython(), [serverScript], {
    cwd: repoRoot,
    stdio: ['pipe', logFd, logFd],
    windowsHide: true,
    env: {
      ...process.env,
      XKEEN_E2E_PORT: String(port),
      XKEEN_UI_PORT: String(port),
      XKEEN_E2E_EXIT_ON_STDIN_EOF: '1',
    },
  });
  closeSync(logFd);
  child.stdin.on('error', () => {});

  try {
    await waitUntilReady(child, `http://127.0.0.1:${port}`, logPath);
  } catch (error) {
    await stopServer(child);
    throw error;
  }
  return child;
}


async function stopServer(child) {
  if (child.exitCode !== null) return;
  const exited = new Promise((resolve) => child.once('exit', resolve));
  child.stdin.end();

  const timer = setTimeout(() => {
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true });
    } else {
      child.kill('SIGKILL');
    }
  }, STOP_TIMEOUT_MS);
  await exited;
  clearTimeout(timer);
}


async function fillAndSubmit(page, formType) {
  const username = getEnv('E2E_USERNAME', 'admin');
  const password = getEnv('E2E_PASSWORD', 'secret123');

  if (formType === 'setup') {
    await page.getByLabel(/логин/i).fill(username);
    await page.getByLabel(/^пароль/i).fill(password);
    await page.getByLabel(/повтор/i).fill(password);
    await page.getByRole('button', { name: /сохранить/i }).click();
    return;
  }

  await page.getByLabel(/логин/i).fill(username);
  await page.getByLabel(/пароль/i).fill(password);
  await page.getByRole('button', { name: /войти/i }).click();
}


async function ensureAuthenticated(page, baseURL) {
  await page.goto(`${baseURL}/`, { waitUntil: 'domcontentloaded' });

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const url = page.url();
    if (!url.includes('/login') && !url.includes('/setup')) {
      await page.waitForLoadState('networkidle').catch(() => {});
      return;
    }

    if (url.includes('/setup')) {
      await fillAndSubmit(page, 'setup');
    } else {
      await fillAndSubmit(page, 'login');
    }

    await page.waitForLoadState('networkidle').catch(() => {});
  }

  const errorText = await page.locator('.auth-error').textContent().catch(() => '');
  throw new Error(
    [
      `Playwright auth bootstrap failed at ${page.url()}.`,
      'If you are targeting an existing server, provide E2E_USERNAME/E2E_PASSWORD.',
      errorText ? `Server response: ${errorText.trim()}` : '',
    ]
      .filter(Boolean)
      .join(' '),
  );
}


async function signIn(browser, baseURL, authPath) {
  await fs.mkdir(path.dirname(authPath), { recursive: true });
  // Never reuse an authenticated browser state from another server run. The
  // local E2E server recreates its fixture at startup, invalidating old
  // sessions by design.
  await fs.rm(authPath, { force: true });

  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  try {
    await ensureAuthenticated(await context.newPage(), baseURL);
    await context.storageState({ path: authPath });
  } finally {
    await context.close();
  }
}


// Starts the worker's own panel (or targets E2E_BASE_URL), signs in and hands
// the address and the saved session to `use`.
export async function withPanelServer(browser, parallelIndex, use) {
  const port = workerPort(parallelIndex);
  const externalURL = getEnv('E2E_BASE_URL', '');
  const baseURL = externalURL || `http://127.0.0.1:${port}`;
  const storageState = authStatePath(port);
  const child = externalURL ? null : await startServer(port);

  try {
    await signIn(browser, baseURL, storageState);
    await use({ baseURL, storageState });
  } finally {
    if (child) await stopServer(child);
  }
}
