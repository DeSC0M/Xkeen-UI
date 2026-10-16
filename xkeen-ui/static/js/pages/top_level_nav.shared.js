import { getXkeenPageName } from '../features/xkeen_runtime.js';
import { getTopLevelRouterApi } from './top_level_router.js';
import { syncModulesUpdateBadges } from '../features/module_manager/badge.js';

function getDocumentRef(root) {
  if (root && typeof root.querySelectorAll === 'function') return root;
  try {
    return document || null;
  } catch (e) {
    return null;
  }
}

function getLocationRef() {
  try {
    return window.location || null;
  } catch (e) {
    return null;
  }
}

function shouldBypassNavigationInterception(event, el) {
  if (!event) return false;
  if (event.defaultPrevented) return true;
  if (typeof event.button === 'number' && event.button !== 0) return true;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return true;

  try {
    const target = String((el && el.getAttribute && el.getAttribute('target')) || '').trim().toLowerCase();
    if (target && target !== '_self') return true;
  } catch (e) {}

  try {
    if (el && typeof el.hasAttribute === 'function' && el.hasAttribute('download')) return true;
  } catch (e) {}

  return false;
}

function readNavigationHref(el) {
  if (!el) return '';

  try {
    const dataHref = String((el.dataset && el.dataset.navHref) || '').trim();
    if (dataHref) return dataHref;
  } catch (e) {}

  try {
    return String(el.getAttribute('href') || '').trim();
  } catch (e) {
    return '';
  }
}

function resolveInternalUrl(rawHref) {
  const href = String(rawHref || '').trim();
  const locationRef = getLocationRef();
  if (!href || !locationRef) return null;

  try {
    const url = new URL(href, locationRef.href);
    if (String(url.origin || '') !== String(locationRef.origin || '')) return null;
    return url;
  } catch (e) {
    return null;
  }
}

function emitTopLevelNavigationIntent(url, trigger) {
  let href = '';
  let targetUrl = '';
  try {
    if (url && typeof url === 'object' && typeof url.pathname === 'string') {
      href = String(url.pathname || '') + String(url.search || '') + String(url.hash || '');
      targetUrl = String(url.toString());
    } else {
      targetUrl = String(url || '');
      href = targetUrl;
    }
  } catch (e) {
    targetUrl = String(url || '');
    href = targetUrl;
  }

  try {
    window.dispatchEvent(new CustomEvent('xkeen:top-level-nav-intent', {
      detail: {
        from: getXkeenPageName(),
        href,
        url: targetUrl,
        trigger: String(trigger || 'user'),
      },
    }));
  } catch (e) {}
}

// Where the last move between the pages came from and where it went: a back
// button marked data-xk-back-return returns there instead of to the panel.
// Only the page the move arrived at may use it — after the browser's own
// back and forward the record is someone else's and the link keeps its href.
const RETURN_KEY = 'xkeen.nav.return.v1';

function rememberReturn(target) {
  const locationRef = getLocationRef();
  if (!locationRef || !target) return;
  try {
    sessionStorage.setItem(RETURN_KEY, JSON.stringify({
      from: String(locationRef.pathname || '') + String(locationRef.search || ''),
      to: String(target.pathname || ''),
    }));
  } catch (e) {}
}

export function readReturnHref(fallback) {
  const locationRef = getLocationRef();
  if (!locationRef) return fallback;
  let record = null;
  try {
    record = JSON.parse(sessionStorage.getItem(RETURN_KEY) || 'null');
  } catch (e) {
    record = null;
  }
  let from = record && record.to === locationRef.pathname && typeof record.from === 'string' ? record.from : '';
  // Opened by an ordinary link: the browser knows where from.
  if (!from) {
    try {
      const referrer = new URL(document.referrer);
      if (referrer.origin === locationRef.origin) from = referrer.pathname + referrer.search;
    } catch (e) {
      from = '';
    }
  }
  if (!from.startsWith('/') || from.startsWith('//')) return fallback;
  const resolved = resolveInternalUrl(from);
  if (!resolved || resolved.pathname === locationRef.pathname) return fallback;
  return from;
}

export function navigateTopLevelHref(rawHref, opts) {
  const href = String(rawHref || '').trim();
  const locationRef = getLocationRef();
  if (!href || !locationRef) return false;

  const resolved = resolveInternalUrl(href);
  const nextUrl = resolved ? resolved.toString() : href;
  if (resolved) rememberReturn(resolved);

  try {
    emitTopLevelNavigationIntent(resolved || nextUrl, opts && opts.trigger);
  } catch (e) {}

  try {
    if (resolved) {
      const router = getTopLevelRouterApi();
      if (router && typeof router.navigate === 'function' && router.navigate(resolved, opts || {})) {
        return true;
      }
    }
  } catch (e) {}

  try {
    if (opts && opts.replace && typeof locationRef.replace === 'function') {
      locationRef.replace(nextUrl);
    } else if (typeof locationRef.assign === 'function') {
      locationRef.assign(nextUrl);
    } else {
      locationRef.href = nextUrl;
    }
    return true;
  } catch (e) {
    return false;
  }
}

export function wireTopLevelNavigation(root) {
  const scope = getDocumentRef(root);
  if (!scope) return 0;
  syncModulesUpdateBadges(scope);

  let wiredCount = 0;
  const nodes = scope.querySelectorAll('[data-xk-top-nav]');
  nodes.forEach((node) => {
    if (!node) return;
    try {
      if (node.dataset && node.dataset.xkTopNavWired === '1') return;
    } catch (e) {}

    node.addEventListener('click', (event) => {
      if (shouldBypassNavigationInterception(event, node)) return;

      let href = readNavigationHref(node);
      if (node.hasAttribute('data-xk-back-return')) href = readReturnHref(href);
      if (!href) return;

      event.preventDefault();
      navigateTopLevelHref(href, { trigger: 'click' });
    });

    try {
      if (node.dataset) node.dataset.xkTopNavWired = '1';
    } catch (e) {}
    wiredCount += 1;
  });

  return wiredCount;
}
