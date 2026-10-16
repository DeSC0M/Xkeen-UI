// Engine-neutral editor toolbar layer.
//
// Keeps legacy XKeen globals for feature modules while exposing a neutral
// XKeen.ui.editorToolbar API backed by XKeen.ui.editorActions.

(() => {
  'use strict';

  window.XKeen = window.XKeen || {};
  const XKeen = window.XKeen;
  XKeen.ui = XKeen.ui || {};

  function iconHtml(name) {
    try { return (XKeen.ui && XKeen.ui.operatorIcons) ? XKeen.ui.operatorIcons.html(name) : ''; } catch (e) {}
    return '';
  }

  function actions() {
    try { return (window.XKeen && XKeen.ui && XKeen.ui.editorActions) ? XKeen.ui.editorActions : null; } catch (e) {}
    return null;
  }

  function buildCmExtraKeysCommon(opts) {
    const api = actions();
    if (api && typeof api.buildCommonKeys === 'function') return api.buildCommonKeys(opts || {});
    return {};
  }

  // The editor toolbar exposes HTML for legacy consumers, but every glyph
  // still originates from the shared local Operator sprite.
  const XKEEN_CM_ICONS = {
    search: iconHtml('search'),
    down: iconHtml('move-down'),
    up: iconHtml('move-up'),
    replace: iconHtml('replace'),
    comment: iconHtml('comment'),
    fullscreen: iconHtml('fullscreen'),
    compare: iconHtml('compare'),
  };

  function openDiffForEditor(editor) {
    const api = actions();
    if (api && typeof api.openDiff === 'function') {
      try { api.openDiff(editor); return; } catch (e) {}
    }
    try {
      const scope = (editor && (editor._xkeenDiffScope
        || (editor.getWrapperElement && editor.getWrapperElement().dataset && editor.getWrapperElement().dataset.xkeenDiffScope)
        || (editor.getDomNode && editor.getDomNode().dataset && editor.getDomNode().dataset.xkeenDiffScope))) || '';
      if (scope && window.XKeen && XKeen.ui && XKeen.ui.diff && typeof XKeen.ui.diff.openForScope === 'function') {
        XKeen.ui.diff.openForScope(scope).catch(() => {});
      }
    } catch (e) {}
  }

  const XKEEN_CM_TOOLBAR_DEFAULT = [
    { id: 'find', svg: XKEEN_CM_ICONS.search, label: 'Поиск', command: 'findPersistent', fallbackHint: 'Ctrl+F' },
    { id: 'next', svg: XKEEN_CM_ICONS.down, label: 'Следующее', command: 'findNext', fallbackHint: 'Ctrl+G' },
    { id: 'prev', svg: XKEEN_CM_ICONS.up, label: 'Предыдущее', command: 'findPrev', fallbackHint: 'Shift+Ctrl+G' },
    { id: 'replace', svg: XKEEN_CM_ICONS.replace, label: 'Замена', command: 'replace', fallbackHint: 'Ctrl+H' },
    { id: 'comment', svg: XKEEN_CM_ICONS.comment, label: 'Коммент', command: 'toggleComment', fallbackHint: 'Ctrl+/' },
    { id: 'compare', svg: XKEEN_CM_ICONS.compare, label: 'Сравнить', fallbackHint: 'Diff', requiresDiffScope: true, onClick: (editor) => openDiffForEditor(editor) },
    { id: 'fs', svg: XKEEN_CM_ICONS.fullscreen, label: 'Фулскрин', fallbackHint: 'F11 / Esc', onClick: (editor) => {
      const api = actions();
      if (api && typeof api.toggleFullscreen === 'function') api.toggleFullscreen(editor);
    } },
  ];

  const XKEEN_CM_TOOLBAR_MINI = [
    { id: 'find', svg: XKEEN_CM_ICONS.search, label: 'Поиск', command: 'findPersistent', fallbackHint: 'Ctrl+F' },
    { id: 'compare', svg: XKEEN_CM_ICONS.compare, label: 'Сравнить', fallbackHint: 'Diff', requiresDiffScope: true, onClick: (editor) => openDiffForEditor(editor) },
    { id: 'fs', svg: XKEEN_CM_ICONS.fullscreen, label: 'Фулскрин', fallbackHint: 'F11 / Esc', onClick: (editor) => {
      const api = actions();
      if (api && typeof api.toggleFullscreen === 'function') api.toggleFullscreen(editor);
    } },
  ];

  function xkeenAttachCmToolbar(editor, items, opts) {
    const api = actions();
    if (!api || typeof api.attachToolbar !== 'function') return null;
    return api.attachToolbar(editor, items || XKEEN_CM_TOOLBAR_DEFAULT, opts || {});
  }

  XKeen.ui.editorToolbar = Object.assign({}, XKeen.ui.editorToolbar || {}, {
    buildCommonKeys: buildCmExtraKeysCommon,
    attach: xkeenAttachCmToolbar,
    icons: XKEEN_CM_ICONS,
    defaultItems: XKEEN_CM_TOOLBAR_DEFAULT,
    miniItems: XKEEN_CM_TOOLBAR_MINI,
  });

  window.buildCmExtraKeysCommon = buildCmExtraKeysCommon;
  window.xkeenAttachCmToolbar = xkeenAttachCmToolbar;
  window.XKEEN_CM_ICONS = window.XKEEN_CM_ICONS || XKEEN_CM_ICONS;
  window.XKEEN_CM_TOOLBAR_DEFAULT = window.XKEEN_CM_TOOLBAR_DEFAULT || XKEEN_CM_TOOLBAR_DEFAULT;
  window.XKEEN_CM_TOOLBAR_MINI = window.XKEEN_CM_TOOLBAR_MINI || XKEEN_CM_TOOLBAR_MINI;
})();
