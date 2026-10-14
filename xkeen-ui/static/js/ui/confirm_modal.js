(() => {
  'use strict';

  window.XKeen = window.XKeen || {};
  const XKeen = window.XKeen;
  XKeen.ui = XKeen.ui || {};

  // Promise-based confirm modal.
  // Usage:
  //   const ok = await XKeen.ui.confirm({ title, message, okText, cancelText, danger });

  let _resolver = null;
  let _activeOptions = null;
  let _activeModal = null;

  // Expando keys on the dialog element. They are read by every copy of this
  // module: screens may bring their own copy, and the element is shared.
  const HOME_KEY = '__xkConfirmHome';
  const BOUND_KEY = '__xkConfirmBound';

  function getModalApi() {
    try {
      if (window.XKeen && XKeen.ui && XKeen.ui.modal) return XKeen.ui.modal;
    } catch (e) {}
    return null;
  }

  function normalizeText(value, fallback) {
    const text = String(value == null ? '' : value).trim();
    if (text) return text;
    return fallback ? String(fallback) : '';
  }

  function normalizeToastKind(value, fallback) {
    const kind = String(value || fallback || 'info').trim().toLowerCase();
    if (kind === 'error' || kind === 'warning' || kind === 'success' || kind === 'info') return kind;
    return 'info';
  }

  function ensureBodyPortal(modal) {
    if (!modal) return;
    try {
      if (document.body && modal.parentElement !== document.body) {
        if (!modal[HOME_KEY]) modal[HOME_KEY] = modal.parentElement;
        document.body.appendChild(modal);
      }
    } catch (e) {}
  }

  // The panel switches screens without a reload (top_level_screen_host). A
  // dialog moved to <body> outlived its screen, the next screen brought its
  // own dialog with the same ids, and the buttons stayed bound to the first
  // one: only the cross worked, and the old dialog showed through
  // (45.1, 14.10.2026). Every leftover goes back to its own screen, so the
  // document holds one dialog — the one of the screen on display.
  function isOnDisplay(node) {
    try {
      return !!(node && node.isConnected && !node.closest('[hidden]'));
    } catch (e) {
      return false;
    }
  }

  function currentConfirmModal() {
    const all = Array.from(document.querySelectorAll('[id="confirm-modal"]'));
    const live = [];
    all.forEach((modal) => {
      const home = modal[HOME_KEY];
      if (home && modal.parentElement === document.body && !isOnDisplay(home)) {
        try { modal.classList.add('hidden'); } catch (e) {}
        try { home.appendChild(modal); } catch (e2) {}
        return;
      }
      live.push(modal);
    });
    // Normally one is left; with more, the latest screen's dialog wins.
    return live.length ? live[live.length - 1] : null;
  }

  // Buttons call whichever copy of the module opened the dialog last: it
  // holds the pending promise.
  function closeActive(value, meta) {
    let fn = null;
    try { fn = window.XKeen && XKeen.ui && XKeen.ui.confirm && XKeen.ui.confirm._closeWith; } catch (e) {}
    if (typeof fn === 'function') fn(value, meta);
    else closeWith(value, meta);
  }

  function closeWith(value, meta) {
    const details = (meta && typeof meta === 'object') ? meta : {};
    const modal = _activeModal;
    _activeModal = null;
    if (modal) hideModal(modal);

    const active = _activeOptions || null;
    _activeOptions = null;
    const r = _resolver;
    _resolver = null;
    if (!value && active && !details.silent) {
      emitConfirmFeedback(active.cancelMessage, active.cancelKind);
    }
    if (typeof r === 'function') {
      try { r(!!value); } catch (e) {}
    }
  }

  function buildConfirmMessageText(opts) {
    const options = (opts && typeof opts === 'object') ? opts : {};
    const primary = normalizeText(options.message || options.text || options.body, 'Вы уверены?');
    const details = Array.isArray(options.details)
      ? options.details.map((item) => normalizeText(item)).filter(Boolean).join('\n')
      : normalizeText(options.details);
    return details ? (primary + '\n\n' + details) : primary;
  }

  function emitConfirmFeedback(message, kind) {
    const text = normalizeText(message);
    if (!text) return;

    const tone = normalizeToastKind(kind, 'info');

    try {
      if (typeof window.toast === 'function') return window.toast(text, tone);
    } catch (e) {}
    try {
      if (typeof window.showToast === 'function') return window.showToast(text, tone);
    } catch (e2) {}
    try {
      if (window.XKeen && XKeen.ui && typeof XKeen.ui.toast === 'function') return XKeen.ui.toast(text, tone);
    } catch (e3) {}
    try { console.log('[xkeen]', text); } catch (e4) {}
  }

  function showModal(modal) {
    if (!modal) return;
    ensureBodyPortal(modal);
    const api = getModalApi();
    try {
      if (api && typeof api.open === 'function') {
        const opened = api.open(modal, { source: 'confirm_modal' });
        try { if (typeof api.bringToFront === 'function') api.bringToFront(modal); } catch (e1) {}
        return opened;
      }
    } catch (e) {}
    try { modal.classList.remove('hidden'); } catch (e2) {}
    try { if (api && typeof api.bringToFront === 'function') api.bringToFront(modal); } catch (e2a) {}
    try {
      if (api && typeof api.syncBodyScrollLock === 'function') api.syncBodyScrollLock();
      else document.body.classList.add('modal-open');
    } catch (e3) {}
  }

  function hideModal(modal) {
    if (!modal) return;
    const api = getModalApi();
    try {
      if (api && typeof api.close === 'function') return api.close(modal, { source: 'confirm_modal' });
    } catch (e) {}
    try { modal.classList.add('hidden'); } catch (e2) {}
    try {
      if (api && typeof api.syncBodyScrollLock === 'function') api.syncBodyScrollLock();
      else document.body.classList.remove('modal-open');
    } catch (e3) {}
  }

  function ensureModal() {
    const modal = currentConfirmModal();
    if (!modal) return null;
    // Parts are looked up inside this dialog, not by id in the whole document.
    const part = (id) => modal.querySelector('[id="' + id + '"]');
    const title = part('confirm-modal-title');
    const message = part('confirm-modal-message');
    const okBtn = part('confirm-modal-ok-btn');
    const cancelBtn = part('confirm-modal-cancel-btn');
    const closeBtn = part('confirm-modal-close-btn');

    if (!title || !message || !okBtn || !cancelBtn || !closeBtn) {
      return null;
    }

    if (!modal[BOUND_KEY]) {
      modal[BOUND_KEY] = true;

      okBtn.addEventListener('click', (e) => {
        e.preventDefault();
        closeActive(true);
      });
      cancelBtn.addEventListener('click', (e) => {
        e.preventDefault();
        closeActive(false);
      });
      closeBtn.addEventListener('click', (e) => {
        e.preventDefault();
        closeActive(false);
      });

      modal.addEventListener('xkeen:modal-request-close', (e) => {
        let pending = false;
        try { pending = !!(XKeen.ui.confirm && XKeen.ui.confirm._isPending && XKeen.ui.confirm._isPending()); } catch (err) {}
        if (!pending) return;
        try { if (e && typeof e.preventDefault === 'function') e.preventDefault(); } catch (err) {}
        closeActive(false);
      });
    }

    return { modal, title, message, okBtn, cancelBtn };
  }

  XKeen.ui.confirm = function confirmModal(opts = {}) {
    const options = (opts && typeof opts === 'object') ? opts : {};
    const messageText = buildConfirmMessageText(options);
    const ui = ensureModal();
    if (!ui) {
      // Fallback to native confirm if modal isn't present.
      const ok = window.confirm(messageText);
      if (!ok) emitConfirmFeedback(options.cancelMessage, options.cancelKind);
      return Promise.resolve(ok);
    }

    // If a confirm is already open, resolve it as cancelled.
    if (typeof _resolver === 'function') {
      try { closeWith(false, { silent: true }); } catch (e) {}
    }

    const titleText = normalizeText(options.title, 'Подтверждение');
    const okText = normalizeText(options.okText, 'OK');
    const cancelText = normalizeText(options.cancelText, 'Отменить');
    const danger = options.danger !== false; // default true for destructive actions
    const focusTarget = normalizeText(options.focus, 'cancel').toLowerCase() === 'ok' ? 'ok' : 'cancel';

    ui.title.textContent = titleText;
    ui.message.textContent = messageText;
    try { ui.message.style.whiteSpace = 'pre-line'; } catch (e) {}
    ui.okBtn.textContent = okText;
    ui.cancelBtn.textContent = cancelText;
    _activeOptions = {
      cancelMessage: normalizeText(options.cancelMessage),
      cancelKind: normalizeToastKind(options.cancelKind, 'info'),
    };

    try {
      ui.okBtn.classList.toggle('btn-danger', !!danger);
    } catch (e) {}

    _activeModal = ui.modal;
    showModal(ui.modal);

    // Focus the cancel button by default (safer for destructive operations).
    setTimeout(() => {
      const target = focusTarget === 'ok' ? ui.okBtn : ui.cancelBtn;
      try { target.focus(); } catch (e) {}
    }, 0);

    return new Promise((resolve) => {
      _resolver = resolve;
    });
  };
  XKeen.ui.confirm._closeWith = closeWith;
  XKeen.ui.confirm._isPending = () => typeof _resolver === 'function';

  // After a screen switch the old screen's dialog goes home at once, so no
  // other code meets two elements with the same id in the meantime.
  try {
    window.addEventListener('xkeen:top-level-route-change', () => {
      try { currentConfirmModal(); } catch (e) {}
    });
  } catch (e) {}
})();
