const API_BASE = '/api/notifications';
const CHANNEL_NAME = 'xkeen-notification-center.v1';

function text(value) {
  return String(value == null ? '' : value);
}

function formatTime(value) {
  const timestamp = Number(value);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return '';
  try {
    return new Intl.DateTimeFormat('ru-RU', {
      day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
    }).format(new Date(timestamp * 1000));
  } catch (error) {
    return '';
  }
}

function formatSize(value) {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes <= 0) return '';
  const units = ['Б', 'КБ', 'МБ', 'ГБ'];
  let amount = bytes;
  let index = 0;
  while (amount >= 1024 && index < units.length - 1) {
    amount /= 1024;
    index += 1;
  }
  return `${amount >= 10 || index === 0 ? Math.round(amount) : amount.toFixed(1)} ${units[index]}`;
}

function apiError(payload, status) {
  const error = new Error(text(payload?.message || payload?.error || 'Не удалось получить уведомления.'));
  error.code = text(payload?.code || 'notification_request_failed');
  error.status = status;
  return error;
}

async function request(path = '', method = 'GET', body) {
  const headers = { 'Cache-Control': 'no-store' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const csrf = document.querySelector('meta[name="csrf-token"]')?.getAttribute('content');
  if (method !== 'GET' && csrf) headers['X-CSRF-Token'] = csrf;
  let response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method, headers, credentials: 'same-origin', cache: 'no-store',
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch (error) {
    const network = new Error('Не удалось связаться с панелью.');
    network.code = 'network_error';
    throw network;
  }
  let payload;
  try {
    payload = await response.json();
  } catch (error) {
    throw apiError(null, response.status);
  }
  if (!response.ok || payload?.ok === false) throw apiError(payload, response.status);
  return payload;
}

function button(label, className, handler) {
  const node = document.createElement('button');
  node.type = 'button';
  node.className = className;
  node.textContent = label;
  node.addEventListener('click', handler);
  return node;
}

function createCenter() {
  const host = document.querySelector('.header-actions') || document.body;
  const root = document.createElement('div');
  root.className = 'xk-notification-center';
  root.innerHTML = `
    <button type="button" class="xk-notification-trigger xk-header-btn" aria-haspopup="dialog" aria-expanded="false" aria-label="Уведомления">
      <span class="xk-notification-trigger__icon" aria-hidden="true">♢</span>
      <span class="xk-notification-trigger__label">Уведомления</span>
      <span class="xk-notification-trigger__count" hidden></span>
    </button>
    <section class="xk-notification-popover" role="dialog" aria-label="Центр уведомлений" hidden>
      <div class="xk-notification-popover__head">
        <div>
          <strong>Центр уведомлений</strong>
          <span class="xk-notification-status" aria-live="polite"></span>
        </div>
        <button type="button" class="xk-notification-close" aria-label="Закрыть">×</button>
      </div>
      <div class="xk-notification-list" aria-live="polite"></div>
      <div class="xk-notification-popover__foot">
        <button type="button" class="xk-notification-check">Проверить обновления</button>
      </div>
    </section>`;
  host.append(root);
  return root;
}

function recordDetails(record) {
  const details = [];
  if (record.version) details.push(`Версия ${text(record.version)}`);
  if (record.size) details.push(formatSize(record.size));
  if (record.requires_restart) details.push('потребуется перезапуск');
  if (record.requires_installer) details.push('нужен установщик');
  const changes = record.dependency_changes || {};
  if (Array.isArray(changes.requires_added) && changes.requires_added.length) {
    details.push(`новые зависимости: ${changes.requires_added.join(', ')}`);
  }
  if (Array.isArray(changes.conflicts_added) && changes.conflicts_added.length) {
    details.push(`конфликты: ${changes.conflicts_added.join(', ')}`);
  }
  return details.join(' · ');
}

export function initNotificationCenter() {
  if (window.XKeen?.notificationCenter) return window.XKeen.notificationCenter;
  const root = createCenter();
  const trigger = root.querySelector('.xk-notification-trigger');
  const count = root.querySelector('.xk-notification-trigger__count');
  const popover = root.querySelector('.xk-notification-popover');
  const list = root.querySelector('.xk-notification-list');
  const status = root.querySelector('.xk-notification-status');
  const checkButton = root.querySelector('.xk-notification-check');
  const closeButton = root.querySelector('.xk-notification-close');
  let snapshot = { records: [], unread_count: 0, status: {} };
  let loading = false;
  let open = false;
  let broadcast = null;

  function publish() {
    const at = Date.now();
    try { localStorage.setItem('xkeen.notification-center.changed', String(at)); } catch (error) {}
    try { broadcast?.postMessage({ type: 'changed', at }); } catch (error) {}
  }

  function setOpen(value) {
    open = Boolean(value);
    popover.hidden = !open;
    trigger.setAttribute('aria-expanded', open ? 'true' : 'false');
    root.classList.toggle('is-open', open);
    if (open) {
      void markSeen();
      closeButton.focus();
    } else {
      trigger.focus();
    }
  }

  function render() {
    const unread = Number(snapshot.unread_count || 0);
    count.hidden = unread <= 0;
    count.textContent = unread > 99 ? '99+' : text(unread);
    trigger.classList.toggle('has-unread', unread > 0);
    const info = snapshot.status || {};
    if (info.error_code) {
      status.textContent = 'Проверка не выполнена';
      status.className = 'xk-notification-status is-error';
    } else if (info.freshness === 'stale') {
      status.textContent = `Старая копия${formatTime(info.fetched_at) ? ` · ${formatTime(info.fetched_at)}` : ''}`;
      status.className = 'xk-notification-status is-stale';
    } else if (info.last_success_at) {
      status.textContent = `Проверено ${formatTime(info.last_success_at)}`;
      status.className = 'xk-notification-status';
    } else {
      status.textContent = 'Проверка ещё не выполнялась';
      status.className = 'xk-notification-status';
    }
    list.replaceChildren();
    if (loading && !snapshot.records.length) {
      list.append(Object.assign(document.createElement('p'), { className: 'xk-notification-empty', textContent: 'Проверяем каталог…' }));
      return;
    }
    if (!snapshot.records.length) {
      list.append(Object.assign(document.createElement('p'), {
        className: 'xk-notification-empty',
        textContent: 'Новых уведомлений нет.',
      }));
      return;
    }
    snapshot.records.forEach((record) => {
      const card = document.createElement('article');
      card.className = `xk-notification-record${record.seen ? ' is-seen' : ''}`;
      const title = document.createElement('strong');
      title.textContent = text(record.title || 'Обновление');
      const message = document.createElement('p');
      message.textContent = text(record.message || '');
      const meta = document.createElement('small');
      meta.textContent = recordDetails(record);
      const actions = document.createElement('div');
      actions.className = 'xk-notification-record__actions';
      actions.append(
        button('Скрыть', 'xk-notification-action', () => void changeRecord(record.id, 'dismiss')),
        button('На день', 'xk-notification-action', () => void changeRecord(record.id, 'snooze', 24 * 60 * 60)),
      );
      card.append(title, message);
      if (meta.textContent) card.append(meta);
      card.append(actions);
      list.append(card);
    });
  }

  async function load() {
    try {
      snapshot = await request();
      render();
    } catch (error) {
      snapshot = {
        records: [{ id: 'local-error', title: 'Центр уведомлений недоступен', message: error.message, kind: 'catalog-error' }],
        unread_count: 0,
        status: { error_code: error.code },
      };
      render();
    }
  }

  async function markSeen() {
    const ids = snapshot.records.filter((record) => !record.seen && record.id).map((record) => record.id);
    if (!ids.length) return;
    try {
      snapshot = await request('/mark-seen', 'POST', { record_ids: ids });
      render();
      publish();
    } catch (error) {}
  }

  async function changeRecord(id, action, snoozeSeconds) {
    try {
      snapshot = await request(`/${encodeURIComponent(id)}`, 'PATCH', {
        action, ...(snoozeSeconds ? { snooze_seconds: snoozeSeconds } : {}),
      });
      render();
      publish();
    } catch (error) {
      status.textContent = error.message;
      status.className = 'xk-notification-status is-error';
    }
  }

  async function check() {
    if (loading) return;
    loading = true;
    checkButton.disabled = true;
    render();
    try {
      snapshot = await request('/check', 'POST', { force_refresh: true });
      publish();
    } catch (error) {
      status.textContent = error.message;
      status.className = 'xk-notification-status is-error';
    } finally {
      loading = false;
      checkButton.disabled = false;
      render();
    }
  }

  trigger.addEventListener('click', () => setOpen(!open));
  closeButton.addEventListener('click', () => setOpen(false));
  checkButton.addEventListener('click', () => void check());
  document.addEventListener('click', (event) => {
    if (open && !root.contains(event.target)) setOpen(false);
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && open) setOpen(false);
  });
  window.addEventListener('storage', (event) => {
    if (event.key === 'xkeen.notification-center.changed') void load();
  });
  window.addEventListener('xkeen:notification-channel-changed', () => {
    void load();
    publish();
  });
  try {
    broadcast = new BroadcastChannel(CHANNEL_NAME);
    broadcast.addEventListener('message', (event) => {
      if (event.data?.type === 'changed') void load();
    });
  } catch (error) {}
  window.addEventListener('beforeunload', () => broadcast?.close());

  const api = {
    refresh: load,
    check,
    open: () => setOpen(true),
    close: () => setOpen(false),
    getSnapshot: () => snapshot,
  };
  window.XKeen = window.XKeen || {};
  window.XKeen.notificationCenter = api;
  void load();
  return api;
}

if (typeof window !== 'undefined') initNotificationCenter();
