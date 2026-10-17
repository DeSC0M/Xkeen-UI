import { readFileSync } from 'node:fs';

// Shared by the browser tests of the Modules window (modules_manager_*.spec.mjs).
//
// What the server really answers. The file is written from the lifecycle
// service by scripts/generate_module_manager_e2e_fixtures.py and kept current
// by tests/test_module_manager_e2e_fixtures.py: no answer here is hand-made.
export const server = JSON.parse(readFileSync(new URL('./fixtures/module_manager_server.json', import.meta.url), 'utf8'));
// Mihomo is installed and switched off; the terminal is not installed.
export const installedSnapshot = server.installed;
export const idleStatus = server.status_none;
export const availableSnapshot = server.available;
export const installPlan = server.install_plan;
export const panelUpdatePlan = server.panel_update_plan;
export const runningStatus = server.install_steps.downloading;
export const committedStatus = server.install_committed;
export const terminalEntry = availableSnapshot.modules.find((item) => item.id === 'tool.terminal');
export const TERMINAL = terminalEntry.name;
// The installed snapshot the way the server gives it once Mihomo is switched.
// These tests switch Mihomo on and off again. In the stored answer it is the
// only engine, and the last engine is locked (modules_engine_guard.spec.mjs);
// here another engine is taken to be on, so the switch stays open.
export const mihomoSwitchable = {
  ...server.installed_mihomo_on,
  modules: server.installed_mihomo_on.modules.map((item) => (
    item.id === 'engine.mihomo' ? { ...item, can_disable: true, lock_reason: null } : item
  )),
};
export const withMihomo = (enabled) => (enabled ? mihomoSwitchable : installedSnapshot);

export async function installIdleLifecycleRoutes(page) {
  await page.route('**/api/modules/installed', (route) => route.fulfill({ json: installedSnapshot }));
  await page.route('**/api/modules/operations/status', (route) => route.fulfill({ json: idleStatus }));
  await page.route('**/api/modules/available', (route) => route.fulfill({ json: availableSnapshot }));
}

export async function installLifecycleRoutes(page, { status = idleStatus, installed = installedSnapshot, available = availableSnapshot } = {}) {
  await page.route('**/api/modules/installed', (route) => route.fulfill({ json: installed }));
  await page.route('**/api/modules/operations/status', (route) => route.fulfill({ json: status }));
  await page.route('**/api/modules/available', (route) => route.fulfill({ json: available }));
}

// The timers of the manager are chained through requests: the clock moves
// in steps, so every answer arrives before the next timer is due.
export async function advanceClock(page, ms, step = 500) {
  for (let passed = 0; passed < ms; passed += step) {
    await page.clock.runFor(Math.min(step, ms - passed));
    await new Promise((resolve) => { setTimeout(resolve, 25); });
  }
}

// The runner died while downloading; the undo that could not put a file back;
// the undo made under a running panel, which now has to be restarted.
export const interruptedStatus = server.interrupted;
export const rollbackFailedStatus = server.rollback_failed;
export const restartStatus = server.rolled_back_restart;
