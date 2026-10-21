import {
  mihomoClashLogsWsUrl,
  requestMihomoClashWsToken,
  fetchMihomoClashGroups,
} from './client.js';
import { mihomoCountryFlag, mihomoNodeCountryCode, mihomoNodeDisplayName } from './visuals.js';

const MAX_LOG_ROWS = 500;
const LOG_SETTINGS_KEY = 'xkeen:mihomo-clash-log-settings:v1';
const GROUP_ICON_RULES = [
  [/заблок|blocked/i, '×'],
  [/direct|напрям/i, '↗'],
  [/telegram/i, '➤'],
  [/discord/i, '♢'],
  [/steam/i, 'S'],
  [/cdn/i, '◉'],
  [/ai/i, '✦'],
  [/fallback/i, '⇄'],
];

let root = null;
let active = false;
let generation = 0;
let capabilities = {};
let runtime = {};
let paused = false;
let level = 'all';
let query = '';
let rows = [];
let socket = null;
let controller = null;
let renderFrame = 0;
let reconnectTimer = 0;
let reconnectAttempt = 0;
let order = 'newest';
let autoFollow = true;
let routeVisuals = new Map();
let routeVisualsRequest = null;

function upstreamLogLevel() {
  // Mihomo's level is a minimum threshold. The economical default is info;
  // selecting "all" keeps the local filter broad without enabling debug.
  return ['debug', 'info', 'warning', 'error'].includes(level) && level !== 'all'
    ? level : 'info';
}

function byId(id) { return document.getElementById(id); }

function escapeHtml(value) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function searchText(row) {
  const route = parseRouteMeta(row?.message);
  return [row?.level, row?.message, route.group, route.node, route.country,
    ...Object.entries(row?.fields || {}).flat(),
    ...(row?.devices || []).flatMap((device) => [device?.ip, device?.name])]
    .join(' ').toLocaleLowerCase('ru');
}

function countryFlag(code) {
  const normalized = String(code || '').trim().toUpperCase();
  if (!/^[A-Z]{2}$/u.test(normalized)) return '';
  return [...normalized].map((letter) => String.fromCodePoint(127397 + letter.charCodeAt(0))).join('');
}

function parseRouteMeta(message) {
  const text = String(message || '');
  const using = text.match(/\busing\s+(.+)$/u);
  const rest = String(using?.[1] || '').trim();
  const match = rest.match(/^(.+?)\[[A-Z]{2}\s+\[([A-Z]{2})\]\s*(.+)$/u)
    || rest.match(/^(.+?)(?:\[[\u{1F1E6}-\u{1F1FF}]{2}\s*)?\[([A-Z]{2})\]\s*(.+)$/u);
  if (!match) return { group: '', country: '', node: '' };
  const group = String(match[1] || '').trim();
  const country = String(match[2] || '').toUpperCase();
  const node = String(match[3] || '').replace(/\]$/u, '').trim();
  return { group, country, node };
}

function groupIcon(group) {
  const match = GROUP_ICON_RULES.find(([pattern]) => pattern.test(String(group || '')));
  return match ? match[1] : '•';
}

function rebuildRouteVisuals(payload) {
  routeVisuals = new Map();
  const groups = [
    ...(Array.isArray(payload?.groups) ? payload.groups : []),
    ...(payload?.global_group && typeof payload.global_group === 'object' ? [payload.global_group] : []),
  ];
  for (const group of groups) {
    const groupName = String(group?.name || '');
    if (groupName) routeVisuals.set(groupName, { icon: String(group?.icon || ''), kind: 'group' });
    for (const node of Array.isArray(group?.nodes) ? group.nodes : []) {
      const nodeName = String(node?.name || '');
      if (nodeName && !routeVisuals.has(nodeName)) {
        routeVisuals.set(nodeName, { icon: String(node?.icon || ''), kind: 'node' });
      }
    }
  }
}

function ensureRouteVisuals() {
  if (routeVisualsRequest) return;
  routeVisualsRequest = fetchMihomoClashGroups()
    .then((payload) => {
      rebuildRouteVisuals(payload);
      render();
    })
    .catch(() => {})
    .finally(() => { routeVisualsRequest = null; });
}

function routeBadgeMarkup(route) {
  const groupVisual = routeVisuals.get(route.group) || {};
  const nodeVisual = routeVisuals.get(route.node) || {};
  const countryCode = route.country || mihomoNodeCountryCode(route.node);
  const flag = mihomoCountryFlag(countryCode);
  const nodeName = route.node ? mihomoNodeDisplayName(route.node, countryCode) : '';
  const groupMarker = groupVisual.icon
    ? `<img src="${escapeHtml(groupVisual.icon)}" alt="" loading="lazy" referrerpolicy="no-referrer">`
    : `<span class="xk-mihomo-log-group-icon" aria-hidden="true">${escapeHtml(groupIcon(route.group))}</span>`;
  const nodeMarker = nodeVisual.icon
    ? `<img src="${escapeHtml(nodeVisual.icon)}" alt="" loading="lazy" referrerpolicy="no-referrer">`
    : '';
  return [
    route.group
      ? `<span class="xk-mihomo-log-route"><span class="xk-mihomo-log-route-icon">${groupMarker}</span><span>${escapeHtml(route.group)}</span></span>`
      : '',
    flag?.svg
      ? `<span class="xk-mihomo-log-country" data-country="${escapeHtml(flag.code)}" role="img" aria-label="${escapeHtml(flag.label)}" title="${escapeHtml(flag.label)}">${flag.svg}</span>`
      : '',
    route.node
      ? `<span class="xk-mihomo-log-node">${nodeMarker}${escapeHtml(nodeName || route.node)}</span>`
      : '',
  ].join('');
}

function loadSettings() {
  try {
    const saved = JSON.parse(window.localStorage.getItem(LOG_SETTINGS_KEY) || '{}');
    if (saved.order === 'newest' || saved.order === 'oldest') order = saved.order;
    if (typeof saved.autoFollow === 'boolean') autoFollow = saved.autoFollow;
  } catch (error) {}
}

function saveSettings() {
  try { window.localStorage.setItem(LOG_SETTINGS_KEY, JSON.stringify({ order, autoFollow })); } catch (error) {}
}

function scrollToEdge(edge) {
  const list = byId('mihomo-clash-logs-list');
  if (!list) return;
  list.scrollTop = edge === 'start' ? 0 : list.scrollHeight;
}

function rowPlainText(row) {
  const route = parseRouteMeta(row?.message);
  const meta = [route.group, route.country && countryFlag(route.country), route.node]
    .filter(Boolean).join(' ');
  return [
    row?.time || '—',
    row?.sequence ? `#${row.sequence}` : '',
    String(row?.level || 'info').toUpperCase(),
    meta,
    row?.message || '—',
    ...Object.entries(row?.fields || {}).map(([key, value]) => `${key}=${value}`),
  ].filter(Boolean).join(' ');
}

function visibleRows() {
  const filtered = filteredRows();
  return order === 'newest' ? [...filtered].reverse() : filtered;
}

function annotatedLogText(value, devices) {
  const text = String(value ?? '');
  const aliases = (Array.isArray(devices) ? devices : [])
    .map((device) => ({ ip: String(device?.ip || ''), name: String(device?.name || '') }))
    .filter((device) => device.ip && device.name)
    .sort((a, b) => b.ip.length - a.ip.length);
  if (!aliases.length) return escapeHtml(text);
  let cursor = 0;
  let html = '';
  while (cursor < text.length) {
    let next = null;
    for (const alias of aliases) {
      let index = text.indexOf(alias.ip, cursor);
      while (index >= 0) {
        const left = index > 0 ? text[index - 1] : '';
        const right = text[index + alias.ip.length] || '';
        if (!/[\w.]/u.test(left) && !/[\w.]/u.test(right)) break;
        index = text.indexOf(alias.ip, index + alias.ip.length);
      }
      if (index >= 0 && (!next || index < next.index || (index === next.index && alias.ip.length > next.alias.ip.length))) {
        next = { index, alias };
      }
    }
    if (!next) { html += escapeHtml(text.slice(cursor)); break; }
    html += escapeHtml(text.slice(cursor, next.index + next.alias.ip.length));
    html += `<span class="xk-mihomo-device-name" title="Имя устройства для ${escapeHtml(next.alias.ip)}">${escapeHtml(next.alias.name)}</span>`;
    cursor = next.index + next.alias.ip.length;
  }
  return html;
}

function filteredRows() {
  const needle = query.trim().toLocaleLowerCase('ru');
  return rows.filter((row) => (level === 'all' || row.level === level)
    && (!needle || searchText(row).includes(needle)));
}

function setState(copy, tone = 'neutral') {
  const state = byId('mihomo-clash-logs-state');
  if (!state) return;
  state.textContent = String(copy || '');
  state.dataset.tone = tone;
}

function render() {
  const list = byId('mihomo-clash-logs-list');
  const empty = byId('mihomo-clash-logs-empty');
  if (!list || !empty) return;
  const previousScrollTop = list.scrollTop;
  const followTail = list.hidden
    || list.scrollHeight <= list.clientHeight
    || list.scrollHeight - list.clientHeight - list.scrollTop <= 24;
  const visible = visibleRows();
  list.innerHTML = visible.map((row) => {
    const fields = Object.entries(row.fields || {})
      .map(([key, value]) => `${key}=${value}`).join(' · ');
    const sequence = Number.isFinite(Number(row.sequence)) ? `#${Number(row.sequence)}` : '';
    const levelText = String(row.level || 'info').toUpperCase();
    const route = parseRouteMeta(row.message);
    return `<li data-log-level="${escapeHtml(row.level)}">
      <article class="xk-mihomo-log-card">
        <header class="xk-mihomo-log-card-head">
          <time class="xk-mihomo-log-time">${escapeHtml(row.time || '—')}</time>
          <span class="xk-mihomo-log-sequence">${escapeHtml(sequence)}</span>
          <strong>${escapeHtml(levelText)}</strong>
          ${routeBadgeMarkup(route)}
        </header>
        <div class="xk-mihomo-log-message">${annotatedLogText(row.message || '—', row.devices)}</div>
        ${fields ? `<small>${annotatedLogText(fields, row.devices)}</small>` : ''}
      </article>
    </li>`;
  }).join('');
  list.hidden = visible.length === 0;
  empty.hidden = visible.length > 0;
  if (visible.length) {
    const followEdge = order === 'newest' ? list.scrollTop <= 24 : list.scrollHeight - list.clientHeight - list.scrollTop <= 24;
    if (autoFollow && (followEdge || followTail)) scrollToEdge(order === 'newest' ? 'start' : 'end');
    else list.scrollTop = previousScrollTop;
  }
  const silent = String(runtime?.log_level || '').toLowerCase() === 'silent';
  empty.textContent = rows.length && !visible.length
    ? 'Записи по текущему фильтру не найдены.'
    : (silent
      ? 'В config.yaml задан log-level: silent. Логи работают, но Mihomo почти не создаёт новых записей.'
      : 'Новые записи появятся здесь в реальном времени. История до открытия вкладки не загружается.');
  if (paused) setState(`Пауза · ${rows.length}/${MAX_LOG_ROWS}`, 'warning');
  else if (socket) setState(`Live · ${rows.length}/${MAX_LOG_ROWS}${silent ? ' · silent' : ''}`, 'positive');
  const pause = byId('mihomo-clash-logs-pause');
  if (pause) {
    pause.setAttribute('aria-pressed', paused ? 'true' : 'false');
    pause.classList.toggle('is-paused', paused);
    pause.setAttribute('aria-label', paused ? 'Продолжить вывод логов' : 'Пауза логов');
  }
  const orderSelect = byId('mihomo-clash-logs-order');
  if (orderSelect) orderSelect.value = order;
  const follow = byId('mihomo-clash-logs-follow');
  if (follow) {
    follow.setAttribute('aria-pressed', autoFollow ? 'true' : 'false');
    follow.textContent = autoFollow ? 'Автопрокрутка' : 'Автопрокрутка выкл.';
  }
}

function setPaused(nextPaused) {
  paused = !!nextPaused;
  render();
}

function scheduleRender() {
  if (renderFrame) return;
  renderFrame = window.requestAnimationFrame(() => {
    renderFrame = 0;
    if (active && !paused) render();
  });
}

function closeStream() {
  const currentSocket = socket;
  socket = null;
  if (controller) { try { controller.abort(); } catch (error) {} }
  controller = null;
  if (reconnectTimer) window.clearTimeout(reconnectTimer);
  reconnectTimer = 0;
  if (currentSocket) {
    currentSocket.onopen = null;
    currentSocket.onmessage = null;
    currentSocket.onerror = null;
    currentSocket.onclose = null;
    try { currentSocket.close(); } catch (error) {}
  }
}

function scheduleReconnect(runGeneration, delay) {
  if (!active || generation !== runGeneration || reconnectTimer) return;
  reconnectTimer = window.setTimeout(() => {
    reconnectTimer = 0;
    if (active && generation === runGeneration) void openStream(runGeneration);
  }, Math.max(250, Number(delay) || 750));
}

async function openStream(runGeneration) {
  if (!active || capabilities.logs_stream !== true) {
    setState('Поток логов недоступен без WebSocket runtime.', 'warning');
    render();
    return;
  }
  const requestController = new AbortController();
  controller = requestController;
  setState('Подключение…');
  try {
    const token = await requestMihomoClashWsToken({
      signal: requestController.signal,
      scope: 'mihomo-clash-logs',
    });
    if (!active || generation !== runGeneration || !token) return;
    const nextSocket = new WebSocket(mihomoClashLogsWsUrl(token, upstreamLogLevel()));
    socket = nextSocket;
    nextSocket.onopen = () => { reconnectAttempt = 0; render(); };
    nextSocket.onmessage = (event) => {
      if (!active || generation !== runGeneration || socket !== nextSocket) return;
      let message = null;
      try { message = JSON.parse(event.data); } catch (error) { return; }
      if (message?.type !== 'mihomo-clash-logs' || Number(message.schema_version) !== 1) return;
      if (message.state === 'ended' && message?.payload?.reason === 'debug_window_expired') {
        // The server deliberately caps debug. Return the next reconnect to
        // the economical info stream instead of reopening debug forever.
        level = 'all';
        const select = byId('mihomo-clash-logs-level');
        if (select) select.value = 'all';
        setState('Debug завершён через 5 минут · возвращаем upstream info.', 'warning');
        return;
      }
      if (message.state === 'error') {
        const code = String(message?.error?.code || 'stream_failed');
        setState(code === 'stream_busy'
          ? 'Предыдущий поток завершается · повторяем подключение…'
          : 'Поток прерван · повторяем подключение…', 'warning');
        return;
      }
      if (message.state !== 'live' || !message.payload) return;
      rows.push(message.payload);
      if (rows.length > MAX_LOG_ROWS) rows.splice(0, rows.length - MAX_LOG_ROWS);
      // A busy Mihomo instance can deliver hundreds of records in one event
      // loop turn. Rebuilding the whole 500-row list for every record makes
      // the controls temporarily unresponsive, so coalesce paints per frame.
      if (!paused) scheduleRender();
      else setState(`Пауза · ${rows.length}/${MAX_LOG_ROWS}`, 'warning');
    };
    nextSocket.onerror = () => setState('Соединение с логами прервано.', 'warning');
    nextSocket.onclose = () => {
      if (socket === nextSocket) socket = null;
      if (active && generation === runGeneration) {
        reconnectAttempt += 1;
        const delay = Math.min(5000, 500 * (2 ** Math.min(3, reconnectAttempt - 1)));
        setState('Переподключение потока логов…', 'neutral');
        scheduleReconnect(runGeneration, delay);
      }
    };
  } catch (error) {
    if (!requestController.signal.aborted && active && generation === runGeneration) {
      reconnectAttempt += 1;
      setState('Не удалось открыть поток · повторяем…', 'warning');
      scheduleReconnect(runGeneration, Math.min(5000, 500 * (2 ** Math.min(3, reconnectAttempt - 1))));
    }
  } finally {
    if (controller === requestController) controller = null;
  }
}

function bind() {
  if (!root || root.dataset.bound === '1') return;
  root.dataset.bound = '1';
  byId('mihomo-clash-logs-pause')?.addEventListener('click', () => setPaused(!paused));
  byId('mihomo-clash-logs-clear')?.addEventListener('click', () => { rows = []; render(); });
  byId('mihomo-clash-logs-level')?.addEventListener('change', (event) => {
    level = event.target.value || 'all';
    render();
    // Changing the level is an upstream operation: close the old socket first
    // so Mihomo does not keep a second stream alive while the new one starts.
    closeStream();
    reconnectAttempt = 0;
    if (active) void openStream(generation);
  });
  byId('mihomo-clash-logs-filter')?.addEventListener('input', (event) => {
    query = event.target.value || ''; render();
  });
  byId('mihomo-clash-logs-order')?.addEventListener('change', (event) => {
    order = event.target.value === 'oldest' ? 'oldest' : 'newest';
    autoFollow = true;
    saveSettings();
    render();
    scrollToEdge(order === 'newest' ? 'start' : 'end');
  });
  byId('mihomo-clash-logs-start')?.addEventListener('click', () => { autoFollow = false; saveSettings(); scrollToEdge('start'); render(); });
  byId('mihomo-clash-logs-end')?.addEventListener('click', () => { autoFollow = false; saveSettings(); scrollToEdge('end'); render(); });
  byId('mihomo-clash-logs-follow')?.addEventListener('click', () => {
    autoFollow = !autoFollow;
    saveSettings();
    render();
    if (autoFollow) scrollToEdge(order === 'newest' ? 'start' : 'end');
  });
  byId('mihomo-clash-logs-copy')?.addEventListener('click', async () => {
    const text = visibleRows().map(rowPlainText).join('\n');
    try {
      await navigator.clipboard.writeText(text);
      setState(`Скопировано · ${visibleRows().length} записей`, 'positive');
    } catch (error) {
      setState('Не удалось скопировать записи.', 'warning');
    }
  });
}

export function initMihomoClashLogs() {
  root = byId('mihomo-clash-logs');
  if (!root) return false;
  loadSettings();
  bind();
  render();
  return true;
}

export function activateMihomoClashLogs(nextCapabilities = {}, nextRuntime = {}) {
  if (!root && !initMihomoClashLogs()) return false;
  deactivateMihomoClashLogs();
  active = true;
  paused = false;
  capabilities = nextCapabilities || {};
  runtime = nextRuntime || {};
  reconnectAttempt = 0;
  generation += 1;
  ensureRouteVisuals();
  void openStream(generation);
  return true;
}

export function deactivateMihomoClashLogs() {
  active = false;
  generation += 1;
  if (renderFrame) window.cancelAnimationFrame(renderFrame);
  renderFrame = 0;
  closeStream();
  root?.setAttribute('aria-busy', 'false');
  return true;
}

export const mihomoClashLogsApi = Object.freeze({
  init: initMihomoClashLogs,
  activate: activateMihomoClashLogs,
  deactivate: deactivateMihomoClashLogs,
});
