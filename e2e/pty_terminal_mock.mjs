// A PTY terminal for specs that need one. The stand itself answers `pty: false`
// on Windows, and the panel then opens the lite terminal, which hides the
// PTY-only chrome (quick commands, overflow menu, buffer group).

export const PTY_CAPABILITIES = {
  websocket: true,
  terminal: {
    lite: true,
    pty: true,
    ws: true,
    shell: {
      enabled: true,
      env: 'XKEEN_ALLOW_SHELL',
      default: '1',
      message: '',
      hint: '',
      requires_restart: false,
    },
  },
  remoteFs: { enabled: false, supported: false },
  storageUsb: { enabled: false },
};


export async function mockPtyCapabilities(page) {
  await page.route('**/api/capabilities', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(PTY_CAPABILITIES),
  }));
}


// Answers the PTY token and socket; returns the input the page sent to it.
export async function mockPty(page, options = {}) {
  const inputs = [];
  await page.route('**/api/ws-token', async (route) => {
    let scope = '';
    try { scope = String((route.request().postDataJSON() || {}).scope || ''); } catch (error) { scope = ''; }
    if (scope !== 'pty') {
      await route.fallback();
      return;
    }
    await route.fulfill({ json: { ok: true, token: 'e2e-token', ttl: 60, scope: 'pty' } });
  });
  await page.routeWebSocket(/\/ws\/pty/, (ws) => {
    if (options.refuse) {
      ws.close({ code: 1011, reason: 'e2e refuses pty' });
      return;
    }
    ws.onMessage((raw) => {
      let message = null;
      try { message = JSON.parse(String(raw)); } catch (error) { message = null; }
      if (message && message.type === 'input') inputs.push(String(message.data || ''));
    });
    ws.send(JSON.stringify({ type: 'init', session_id: 'e2e-session', shell: '/bin/sh', reused: false, seq: 0 }));
  });
  return inputs;
}
