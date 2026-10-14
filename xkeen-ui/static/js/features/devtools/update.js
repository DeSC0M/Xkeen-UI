import { setDevtoolsNamespaceApi } from '../devtools_namespace.js';
import { createModuleLifecycleClient } from '../module_manager/api.js';
import { reconcileModulesUpdateCheck } from '../module_manager/badge.js';
import { describeModuleSets } from '../module_manager/render.js';

// Справочная карточка «Сборка панели» на вкладке Tools: версия, источник и
// состав установленных модулей. Сама она ничего не обновляет — команды живут
// в разделе «Модули и обновления».
(() => {
  'use strict';

  const api = createModuleLifecycleClient();
  let _inited = false;
  let _loadSeq = 0;
  let _channelBusy = false;

  const MODULE_STATES = {
    enabled: { tone: 'ok', label: 'включён' },
    disabled: { tone: 'off', label: 'выключен' },
    failed: { tone: 'bad', label: 'ошибка' },
    unavailable: { tone: 'warn', label: 'недоступен' },
  };

  function byId(id) {
    return document.getElementById(id);
  }

  function node(tag, className, text) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text !== undefined) el.textContent = String(text);
    return el;
  }

  function setText(id, text) {
    const el = byId(id);
    if (el) el.textContent = String(text || '');
  }

  // Полный хэш (40 символов) не влезает в строку «Версия» и рвёт её надвое.
  // Короткого префикса хватает, чтобы сверить сборку.
  function shortCommit(commit) {
    const raw = String(commit || '').trim();
    return /^[0-9a-f]{13,}$/i.test(raw) ? raw.slice(0, 12) : raw;
  }

  function formatDate(value, options) {
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date.toLocaleString('ru-RU', options) : '';
  }

  const CORE_REQUIREMENTS = { xray: 'Xray', mihomo: 'Mihomo' };

  function moduleState(module) {
    const known = MODULE_STATES[String(module && module.status ? module.status : '')];
    if (known) return known;
    return module && module.enabled === false ? MODULE_STATES.disabled : MODULE_STATES.enabled;
  }

  // «Недоступен» читалось как «модуля нет», хотя чаще он установлен, а на
  // роутере нет его ядра. Причина — словом в строке или в подсказке.
  function moduleStateWithReason(module, names) {
    const state = moduleState(module);
    if (state !== MODULE_STATES.unavailable) return { ...state, hint: '' };
    const missing = Array.isArray(module.missing_requirement_ids) ? module.missing_requirement_ids : [];
    const core = missing.map((id) => CORE_REQUIREMENTS[id]).find(Boolean);
    if (core) {
      return { tone: 'off', label: 'нет ядра', hint: 'Модуль установлен, но ядро ' + core + ' на роутере не найдено.' };
    }
    if (missing.length) {
      return { ...state, hint: 'На роутере не хватает: ' + missing.join(', ') + '.' };
    }
    const deps = Array.isArray(module.unavailable_dependency_ids) ? module.unavailable_dependency_ids : [];
    if (deps.length) {
      return { ...state, hint: 'Не работает модуль, от которого он зависит: ' + deps.map((id) => names[id] || id).join(', ') + '.' };
    }
    return { ...state, hint: '' };
  }

  function setError(message) {
    const el = byId('dt-panel-status');
    if (!el) return;
    el.textContent = String(message || '');
    el.hidden = !message;
  }

  function renderBuild(data) {
    const build = data && data.build && typeof data.build === 'object' ? data.build : {};
    const version = String(build.version || (data && data.panel_version) || '').trim();
    const commit = shortCommit(build.commit);
    setText('dt-panel-version', version || '—');
    setText('dt-panel-commit', commit ? '(' + commit + ')' : '');
    setText('dt-panel-built', (build.built_utc && (formatDate(build.built_utc) || String(build.built_utc))) || '—');
    setText('dt-panel-repo', build.repo || '—');
    renderChannel((data && data.update_channel) || 'stable');
    // Те же слова, что в разделе «Модули и обновления»: набор называется
    // по составу модулей, а не по сохранённой метке профиля.
    const sets = data ? describeModuleSets(data) : null;
    setText('dt-panel-installed-set', sets ? sets.installed : '—');
    setText('dt-panel-enabled-set', sets ? sets.enabled : '—');
  }

  function renderChannel(value) {
    const channel = value === 'prerelease' ? 'prerelease' : 'stable';
    setText('dt-panel-channel', channel === 'stable' ? 'Стабильный' : 'Предрелиз');
    const options = byId('dt-panel-channel-options');
    if (!options) return;
    options.querySelectorAll('[data-channel]').forEach((button) => {
      button.setAttribute('aria-pressed', String(button.dataset.channel === channel));
    });
  }

  function wireChannel() {
    const trigger = byId('dt-panel-channel');
    const options = byId('dt-panel-channel-options');
    if (!trigger || !options) return;
    trigger.addEventListener('click', () => {
      const open = options.hidden;
      options.hidden = !open;
      trigger.setAttribute('aria-expanded', String(open));
    });
    options.querySelectorAll('[data-channel]').forEach((button) => {
      button.addEventListener('click', async () => {
        if (_channelBusy || button.getAttribute('aria-pressed') === 'true') return;
        _channelBusy = true;
        options.querySelectorAll('button').forEach((item) => { item.disabled = true; });
        try {
          const result = await api.setUpdateChannel(button.dataset.channel);
          options.hidden = true;
          trigger.setAttribute('aria-expanded', 'false');
          renderChannel(result.channel);
          // A change of channel has its own verified cache and update check.
          await load();
        } catch (error) {
          setError('Не удалось выбрать канал: ' + ((error && error.message) || 'нет ответа сервера'));
        } finally {
          _channelBusy = false;
          options.querySelectorAll('button').forEach((item) => { item.disabled = false; });
        }
      });
    });
  }

  function renderModules(data) {
    const host = byId('dt-panel-modules');
    if (!host) return;
    const modules = Array.isArray(data && data.modules) ? data.modules : [];
    host.replaceChildren();
    if (!modules.length) {
      host.append(node('li', 'dt-panel-modules-empty', 'Нет данных об установленных модулях.'));
      return;
    }
    const names = {};
    modules.forEach((module) => {
      if (module && module.id) names[module.id] = module.name || module.id;
    });
    modules.forEach((module) => {
      const state = moduleStateWithReason(module || {}, names);
      const row = node('li', 'dt-panel-module');
      row.dataset.moduleId = String((module && module.id) || '');
      row.dataset.state = state.tone;
      if (state.hint) {
        row.title = state.hint;
        row.setAttribute('data-tooltip', state.hint);
      }
      const dot = node('span', 'dt-panel-module-dot');
      dot.setAttribute('aria-hidden', 'true');
      row.append(
        dot,
        node('span', 'dt-panel-module-name', (module && (module.name || module.id)) || '—'),
        node('span', 'dt-panel-module-version', (module && module.version) || '—'),
        node('span', 'dt-panel-module-state', state.label),
      );
      host.append(row);
    });
  }

  function renderUpdateNote(tone, text) {
    const el = byId('dt-panel-update-note');
    if (!el) return;
    el.replaceChildren();
    el.hidden = !text;
    if (!text) return;
    el.dataset.tone = tone;
    const dot = node('span', 'dt-panel-module-dot');
    dot.setAttribute('aria-hidden', 'true');
    el.append(dot, node('span', '', text));
  }

  function describeUpdate(check) {
    const stale = check.freshness === 'stale';
    const when = formatDate(Number(check.fetched_at) * 1000, { dateStyle: 'short', timeStyle: 'short' });
    if (check.requires_installer) {
      return ['warn', 'Версия ' + (check.target_version || 'из каталога') + ' ставится через установщик.'];
    }
    if (check.update_available) {
      return ['warn', 'Доступна версия ' + check.target_version + '. Обновить можно в разделе «Модули и обновления».'];
    }
    if (stale) {
      return ['off', 'Не удалось связаться с GitHub. По сохранённым данным' + (when ? ' от ' + when : '') + ' новой версии нет.'];
    }
    return ['ok', 'Обновлений нет.' + (when ? ' Проверено ' + when + '.' : '')];
  }

  // Ответ берётся из каталога, который сервер хранит сутки: открытие вкладки
  // не ходит на GitHub каждый раз.
  async function loadUpdateNote(installed, seq) {
    if (!(installed && installed.lifecycle && installed.lifecycle.available === true)) {
      renderUpdateNote('', '');
      return;
    }
    try {
      const check = await api.checkPanelUpdate(false);
      if (seq !== _loadSeq) return;
      reconcileModulesUpdateCheck(check);
      renderUpdateNote(...describeUpdate(check));
    } catch (error) {
      if (seq === _loadSeq) renderUpdateNote('off', 'Не удалось проверить обновления.');
    }
  }

  async function load() {
    const seq = ++_loadSeq;
    let installed;
    try {
      installed = await api.loadInstalled();
    } catch (error) {
      if (seq !== _loadSeq) return null;
      const host = byId('dt-panel-modules');
      if (host) host.replaceChildren(node('li', 'dt-panel-modules-empty', '—'));
      renderUpdateNote('', '');
      setError('Не удалось загрузить сведения о панели: ' + ((error && error.message) || 'нет ответа сервера'));
      return null;
    }
    if (seq !== _loadSeq) return installed;
    setError('');
    renderBuild(installed);
    renderModules(installed);
    await loadUpdateNote(installed, seq);
    return installed;
  }

  function init() {
    if (_inited) return;
    _inited = true;
    wireChannel();
    load().catch(() => {});
  }

  function activate() {
    if (!_inited) return false;
    load().catch(() => {});
    return true;
  }

  function deactivate() {
    return true;
  }

  setDevtoolsNamespaceApi('devtoolsUpdate', { init, activate, deactivate });
})();
