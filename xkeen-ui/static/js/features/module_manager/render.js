import { iconHtml } from '../../ui/operator_icons.js';
import { renderUpdateChannel, wireUpdateChannel } from '../update_channel.js';

function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = String(text ?? '');
  return element;
}

function moduleTitle(item) {
  return [item.name || item.id || 'Модуль', item.version].filter(Boolean).join(' ');
}

// A module is called by its name wherever the window knows it.
function moduleLabel(id, names) {
  const key = String(id ?? '');
  return (names && typeof names.get === 'function' && names.get(key)) || key;
}

function moduleList(ids, names) {
  return ids.map((id) => moduleLabel(id, names)).join(', ');
}

function dependencies(card, label, items, names) {
  if (!Array.isArray(items) || !items.length) return;
  card.append(node('p', 'modules-meta', `${label}: ${moduleList(items, names)}`));
}

const ACTION_LABELS = {
  install: 'Установить', repair: 'Восстановить', remove: 'Удалить',
  'panel-update': 'Обновить панель', 'panel-rollback': 'Откатить панель',
  'profile-transition': 'Применить профиль',
};

const MODULE_ICONS = {
  core: 'settings',
  'engine.xray': 'engine-xray',
  'engine.mihomo': 'engine-mihomo',
  'tool.editor': 'edit',
  'tool.terminal': 'terminal',
  'tool.files': 'folder-add',
  'tool.backups': 'archive',
  'integration.happ': 'subscriptions',
  'tool.advanced-diagnostics': 'statistics',
};

function moduleIcon(moduleId) {
  const icon = node('span', 'modules-module-icon');
  icon.setAttribute('aria-hidden', 'true');
  icon.innerHTML = iconHtml(MODULE_ICONS[moduleId] || 'catalog', 'modules-module-icon-svg');
  return icon;
}

// Each next variant holds everything of the one before it.
const EDITOR_VARIANTS = [
  { id: 'light', label: 'Лёгкий', hint: 'CodeMirror и базовая проверка по схеме.' },
  { id: 'full', label: 'Стандартный', hint: 'CodeMirror, Monaco и сравнение версий.' },
  { id: 'advanced', label: 'Расширенный', hint: 'всё из стандартного, форматирование Prettier, быстрые исправления и расширенная схема.' },
];

const MODULE_SET_LABELS = {
  full: 'полный набор', 'xray-minimal': 'только Xray', 'mihomo-minimal': 'только Mihomo',
};

const OPERATION_TITLES = {
  install: 'Установка модуля', repair: 'Восстановление модуля', remove: 'Удаление модуля',
  'panel-update': 'Обновление панели', 'panel-rollback': 'Откат панели', 'profile-transition': 'Переход профиля',
};

const PLAN_ACTIONS = {
  install: 'Установить модуль', repair: 'Восстановить модуль', remove: 'Удалить модуль',
};

const RESULT_LABELS = {
  running: 'Выполняется', committed: 'Готово', rolled_back: 'Отменено, файлы возвращены',
  interrupted: 'Прервана', rollback_failed: 'Файлы не возвращены',
};

const RESULT_TONES = { running: 'run', committed: 'ok', rolled_back: 'bad', interrupted: 'bad', rollback_failed: 'bad' };

// The steps of the runner, in the order it takes them.
const STEP_LABELS = {
  prepared: 'Подготовка', downloading: 'Загрузка архива', verifying: 'Проверка подписи и состава',
  applying: 'Замена файлов', state: 'Запись состояния', restarting: 'Перезапуск панели',
  health: 'Проверка панели после перезапуска', committed: 'Готово', rolling_back: 'Возврат прежних файлов',
};

const DEPENDENCY_LABELS = {
  requires: 'Нужны модули', missing: 'Не хватает модулей', conflicts: 'Конфликтуют', required_by: 'От него зависят',
};

// Lists of modules a refusal may carry, whatever the server calls them.
const BLOCKER_MODULE_KEYS = [
  'module_ids', 'missing_module_ids', 'dependent_module_ids', 'conflict_module_ids', 'active_module_ids',
];

const FAILURE_MESSAGES = {
  catalog_unavailable: 'Каталог модулей временно недоступен.',
  catalog_stale: 'Каталог устарел. Загрузите его снова.',
  module_plan_stale: 'План устарел. Проверьте новый план.',
  operation_plan_stale: 'План устарел. Проверьте новый план.',
  operation_in_progress: 'Другая операция уже выполняется.',
  profile_transition_required: 'Сначала примените переход профиля.',
  operation_rollback_failed: 'Восстановление файлов не завершилось. Требуется ручная проверка установки и состояния панели.',
  operation_cancelled: 'Операция отменена.',
  operation_interrupted: 'Операция прервана.',
  operation_superseded: 'Операция не завершена: файлы панели заменены установщиком.',
  module_free_space: 'Недостаточно свободного места.',
  operation_free_space: 'Недостаточно свободного места.',
  module_engine_active: 'Модуль используется активным движком.',
  module_dependency_missing: 'Не хватает зависимости.',
  panel_version_current: 'Обновлений нет.',
  module_conflict: 'Обнаружен конфликт модулей.',
  module_required_by: 'Модуль требуется другим модулям.',
  panel_archive_invalid: 'Архив панели не прошёл проверку.',
  panel_version_unsupported: 'Для локальной сборки подписанные операции доступны только после установки release-пакета. Выбор канала обновлений этого не меняет.',
  profile_payload_unavailable: 'Архив для перехода профиля недоступен.',
  editor_variant_invalid: 'Такого варианта редакторов нет.',
  operation_environment_failed: 'Роутер не удалось подготовить к новому выпуску.',
  operation_health_failed: 'Панель не ответила после операции.',
  operation_restart_failed: 'Панель не удалось перезапустить.',
  operation_start_failed: 'Операцию не удалось запустить.',
  operation_recovery_required: 'Сначала завершите восстановление прошлой операции.',
  panel_restart_unavailable: 'Перезапуск панели сейчас недоступен.',
  dns_protection_active: 'Сначала безопасно снимите активную DNS-защиту.',
  active_core_module: 'Модуль обслуживает работающее ядро. Сначала остановите или смените ядро.',
  core_required: 'Базовый модуль панели отключить нельзя.',
  editor_variant_save_failed: 'Не удалось сохранить вариант редакторов.',
};

// The registry and the DNS guard write their refusals for the owner, in
// Russian; the lifecycle writes for a log. Only the former are shown as sent,
// and only when they carry no path or markup.
function ownerMessage(message) {
  const text = typeof message === 'string' ? message.trim() : '';
  if (!text || text.length > 200 || !/[А-Яа-яЁё]/.test(text) || /[\\/<>]/.test(text)) return '';
  return text;
}

function failureGuidance({ code, message } = {}) {
  const safeCode = typeof code === 'string' && /^[a-z][a-z0-9_]{0,79}$/.test(code) ? code : 'module_request_failed';
  let guidance = FAILURE_MESSAGES[safeCode] || ownerMessage(message);
  if (!guidance && safeCode.startsWith('catalog_')) guidance = safeCode.includes('stale') || safeCode.includes('expired') ? 'Каталог устарел. Загрузите его снова.' : 'Не удалось проверить каталог модулей.';
  if (!guidance && safeCode.includes('trust')) guidance = 'Не удалось подтвердить доверие к каталогу.';
  if (!guidance && safeCode.includes('archive')) guidance = 'Не удалось проверить архив модуля.';
  if (!guidance && safeCode.includes('rollback')) guidance = 'Восстановление файлов не завершилось. Требуется ручная проверка установки и состояния панели.';
  return { safeCode, guidance: guidance || 'Не удалось выполнить операцию с модулями.' };
}

export function describeLifecycleFailure(failure = {}) {
  const { safeCode, guidance } = failureGuidance(failure);
  return `${guidance} (${safeCode})`;
}

function alertLine(className, lead, rest) {
  const line = node('p', className);
  line.append(node('strong', '', lead));
  if (rest) line.append(document.createTextNode(` ${rest}`));
  return line;
}

function validSeconds(seconds) {
  const value = Number(seconds);
  return Number.isFinite(value) && value > 0 ? value : null;
}

// The router's clock is wrong until it is synchronised: the moment is shown
// as written, the order of the lines says more than the date.
function formatMoment(seconds) {
  const value = validSeconds(seconds);
  return value === null ? '' : new Date(value * 1000).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'medium' });
}

function formatClock(seconds) {
  const value = validSeconds(seconds);
  return value === null ? '' : new Date(value * 1000).toLocaleTimeString('ru-RU');
}

function formatDuration(from, to) {
  const start = validSeconds(from);
  const end = validSeconds(to);
  if (start === null || end === null || end < start) return '';
  const total = Math.round(end - start);
  return total < 60 ? `${total} с` : `${Math.floor(total / 60)} мин ${total % 60} с`;
}

function copyCommand(command, button) {
  const done = () => { button.textContent = 'Скопировано'; };
  try {
    navigator.clipboard.writeText(command).then(done, () => {});
  } catch (error) {
    // No clipboard here: the command stays on the screen to be selected.
  }
}

function actionButton(operation, moduleId, label, onPlan, disabled) {
  const shortLabel = moduleId && ['repair', 'remove'].includes(operation)
    ? (operation === 'repair' ? 'Восстановить' : 'Удалить')
    : label;
  const button = node('button', `btn-secondary modules-action modules-action-${operation}`, shortLabel);
  const icon = operation === 'repair' ? 'restore' : operation === 'remove' ? 'trash' : null;
  if (icon) {
    button.replaceChildren();
    button.insertAdjacentHTML('afterbegin', iconHtml(icon, 'modules-action-icon'));
    button.append(document.createTextNode(shortLabel));
  }
  button.type = 'button';
  button.setAttribute('aria-label', label);
  button.title = label;
  button.dataset.operation = operation;
  if (moduleId) button.dataset.moduleId = moduleId;
  button.disabled = disabled;
  button.addEventListener('click', () => onPlan(operation, moduleId, button));
  return button;
}

function formatBytes(bytes) {
  const amount = Number(bytes) || 0;
  if (amount >= 1024 * 1024) return `${Math.ceil(amount / (1024 * 1024))} МБ`;
  if (amount >= 1024) return `${Math.ceil(amount / 1024)} КБ`;
  return `${amount} Б`;
}

function textList(parent, label, values) {
  if (!Array.isArray(values) || !values.length) return;
  parent.append(node('p', 'modules-meta', `${label}: ${values.map(String).join(', ')}`));
}

function appendPanelIdentity(summary, snapshot) {
  const build = snapshot.build && typeof snapshot.build === 'object' ? snapshot.build : {};
  const updateChannel = snapshot.update_channel === 'prerelease' ? 'Предрелиз' : 'Стабильный';
  const releaseVersion = String(snapshot.panel_version || '').trim();
  const buildVersion = String(build.version || '').trim();
  summary.append(node(
    'p',
    'modules-build-version',
    releaseVersion ? `Xkeen UI ${releaseVersion}` : (buildVersion ? `Локальная сборка ${buildVersion}` : 'Сборка панели не определена'),
  ));
  if (build.repo || build.channel) {
    summary.append(node('p', 'modules-build-meta', `Источник: ${build.repo || 'не указан'} · канал сборки: ${build.channel || 'не указан'}`));
  }
  summary.append(node('p', 'modules-build-meta', `Канал обновлений: ${updateChannel}`));
  if (build.commit) summary.append(node('p', 'modules-build-meta', `Коммит: ${build.commit}`));
  if (build.built_utc) {
    const built = new Date(build.built_utc);
    const displayed = Number.isFinite(built.getTime()) ? built.toLocaleString('ru-RU') : String(build.built_utc);
    summary.append(node('p', 'modules-build-meta', `Собрано: ${displayed}`));
  }
}

function appendUpdateChannelControl(summary, snapshot, { onUpdateChannel, channelBusy }) {
  const check = node('section', 'modules-update-channel');
  const title = node('h3', '', 'Канал обновлений');
  const switchRoot = node('span', 'modules-channel-switch');
  switchRoot.setAttribute('role', 'group');
  switchRoot.setAttribute('aria-label', 'Канал обновлений');
  const lifecycleAvailable = snapshot.lifecycle?.available === true;

  for (const [channel, label] of [['stable', 'Стабильный'], ['prerelease', 'Предрелизный']]) {
    const button = node('button', '', label);
    button.type = 'button';
    button.dataset.channel = channel;
    button.disabled = !!channelBusy || !lifecycleAvailable;
    switchRoot.append(button);
  }

  const hint = node('p', 'modules-channel-hint');
  check.append(title, switchRoot, hint);
  summary.append(check);
  renderUpdateChannel(switchRoot, hint, snapshot.update_channel);
  if (!lifecycleAvailable) {
    hint.textContent = 'Для локальной сборки переключение канала не меняет доступность подписанных обновлений.';
  }
  wireUpdateChannel({
    root: switchRoot,
    hint,
    onSelect: onUpdateChannel,
    onError: (error) => {
      const message = error && error.message ? String(error.message) : 'нет ответа сервера';
      check.dataset.error = '1';
      hint.textContent = 'Не удалось выбрать канал: ' + message;
    },
  });
}

// Only the light variant lacks files of the others, and a local build
// has no signed archive to fetch them from.
function editorVariantsLocked(snapshot) {
  return snapshot.lifecycle?.available !== true && snapshot.editor?.installed_variant === 'light';
}

function editorVariantControl(snapshot, current, onEditorVariant, busy) {
  const side = node('div', 'modules-variant-side');
  side.append(node('span', 'modules-variant-label', 'Вариант'));
  const group = node('div', 'modules-variant');
  group.setAttribute('role', 'group');
  group.setAttribute('aria-label', 'Вариант редакторов');
  const locked = editorVariantsLocked(snapshot);
  for (const variant of EDITOR_VARIANTS) {
    const selected = variant.id === current.id;
    const button = node('button', 'modules-variant-option', variant.label);
    button.type = 'button';
    button.dataset.variant = variant.id;
    button.setAttribute('aria-pressed', String(selected));
    button.disabled = busy || (locked && !selected && variant.id !== 'light');
    button.addEventListener('click', () => { if (!selected) onEditorVariant(variant.id, button); });
    group.append(button);
  }
  side.append(group);
  return side;
}

function moduleSetLabel(name) { return MODULE_SET_LABELS[name] || 'свой набор'; }

function appendSetLine(summary, label, value) {
  const line = node('p', 'modules-set');
  line.append(node('span', 'modules-set-label', label), document.createTextNode(` ${value}`));
  summary.append(line);
}

// What lies on the storage and what of it runs are two facts: a module
// switched off keeps its files.
export function describeModuleSets(snapshot) {
  const modules = Array.isArray(snapshot?.modules) ? snapshot.modules : [];
  const enabled = modules.filter((item) => item.enabled === true).length;
  return {
    installed: moduleSetLabel(snapshot?.installed_set),
    enabled: `${enabled === modules.length ? 'все модули' : moduleSetLabel(snapshot?.enabled_set)} (${enabled} из ${modules.length})`,
  };
}

function appendModuleSets(summary, snapshot) {
  const sets = describeModuleSets(snapshot);
  appendSetLine(summary, 'Установлено:', sets.installed);
  appendSetLine(summary, 'Включено:', sets.enabled);
}

function formatCatalogTime(seconds) {
  const date = new Date(Number(seconds) * 1000);
  return Number.isFinite(date.getTime()) && Number(seconds) > 0
    ? date.toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' })
    : 'неизвестного времени';
}

function appendUpdateCheck(summary, update, { onCheckUpdate, busy, lifecycleAvailable }) {
  const check = node('section', 'modules-update-check');
  const appendMessage = (className, text) => {
    const message = node('p', className, text);
    message.setAttribute('role', 'status');
    message.setAttribute('aria-live', 'polite');
    check.append(message);
  };
  check.append(node('h3', '', 'Обновление панели'));
  const button = node('button', 'btn-secondary modules-update-check-button', 'Проверить обновления');
  button.type = 'button';
  button.disabled = busy || lifecycleAvailable !== true;
  if (typeof onCheckUpdate === 'function') button.addEventListener('click', onCheckUpdate);
  check.append(button);
  if (lifecycleAvailable !== true) {
    appendMessage('modules-build-note', 'Для локальной сборки проверка и установка подписанного обновления станут доступны после установки release-пакета.');
  } else if (update?.loading) {
    appendMessage('modules-build-meta', 'Проверяем подписанный каталог…');
  } else if (update?.error) {
    appendMessage('modules-alert', describeLifecycleFailure(update.error));
  } else if (update?.checked) {
    // The server answered from the catalog it kept: not today's word.
    const stale = update.freshness === 'stale';
    if (stale) appendMessage('modules-alert', `Не удалось связаться с GitHub. Показаны данные каталога от ${formatCatalogTime(update.fetched_at)}.`);
    if (update.requires_installer) appendMessage('modules-alert', `Версия ${update.target_version || 'из каталога'} требует обновления через установщик.`);
    else if (update.update_available) appendMessage('modules-update-available', `Доступна версия ${update.target_version}.`);
    else appendMessage('modules-build-meta', stale ? 'По сохранённым данным новой версии нет.' : 'Установлена актуальная версия.');
  } else {
    appendMessage('modules-build-meta', 'Проверка не скачивает архив и не изменяет панель.');
  }
  summary.append(check);
}

function planAction(plan, names) {
  const version = plan.target_version || plan.version;
  if (plan.operation === 'panel-update' || plan.operation === 'panel-rollback') {
    const verb = plan.operation === 'panel-update' ? 'Обновить панель' : 'Откатить панель';
    if (plan.source_version && version) return `${verb}: ${plan.source_version} → ${version}`;
    return version ? `${verb} до ${version}` : verb;
  }
  if (plan.operation === 'profile-transition') {
    const target = plan.target_profile && typeof plan.target_profile === 'object' ? plan.target_profile : {};
    const ids = Array.isArray(target.module_ids) ? target.module_ids : [];
    return ids.length
      ? `Привести установленное к набору: ${moduleSetLabel(target.profile)} (${ids.length})`
      : 'Привести установленное к выбранному набору';
  }
  const verb = PLAN_ACTIONS[plan.operation] || ACTION_LABELS[plan.operation] || 'Операция';
  return [plan.module_id ? `${verb} «${moduleLabel(plan.module_id, names)}»` : verb, version].filter(Boolean).join(' ');
}

function describeBlocker(blocker, names) {
  const { safeCode, guidance } = failureGuidance(blocker);
  const details = [];
  const required = Number(blocker?.required);
  const free = Number(blocker?.free);
  if (Number.isFinite(required) && Number.isFinite(free) && required > 0) {
    details.push(`Нужно ${formatBytes(required)}, свободно ${formatBytes(free)}.`);
  }
  for (const key of BLOCKER_MODULE_KEYS) {
    const ids = Array.isArray(blocker?.[key]) ? blocker[key].filter((id) => typeof id === 'string') : [];
    if (ids.length) details.push(`Модули: ${moduleList(ids, names)}.`);
  }
  return alertLine('modules-alert', guidance, `${details.join(' ')} (${safeCode})`.trim());
}

export function renderPlan(dialog, plan, names = null) {
  const title = dialog.querySelector('#modules-plan-title');
  const summary = dialog.querySelector('#modules-plan-summary');
  const apply = dialog.querySelector('#modules-plan-apply');
  const titles = {
    install: 'установки', repair: 'восстановления', remove: 'удаления',
    'panel-update': 'обновления панели', 'panel-rollback': 'отката панели',
    'profile-transition': 'перехода профиля',
  };
  title.textContent = `План ${titles[plan.operation] || 'операции'}`;
  summary.replaceChildren();
  const blockers = Array.isArray(plan.blockers) ? plan.blockers : [];
  const facts = node('dl', 'modules-plan-facts');
  const fact = (label, value) => { facts.append(node('dt', '', label), node('dd', '', value)); };
  fact('Действие', planAction(plan, names));
  const affected = Array.isArray(plan.affected_module_ids) ? plan.affected_module_ids : [];
  if (affected.length && !(affected.length === 1 && affected[0] === plan.module_id)) fact('Модули', moduleList(affected, names));
  fact('Файлы', `добавить ${plan.files_add?.length || 0}, удалить ${plan.files_remove?.length || 0}`);
  // How much is free arrives only with the refusal that there is too little.
  const space = blockers.find((blocker) => Number.isFinite(Number(blocker?.free)) && blocker?.free !== null && blocker?.free !== undefined);
  fact('Место', space ? `нужно ${formatBytes(plan.required_free_bytes)}, свободно ${formatBytes(space.free)}` : `нужно ${formatBytes(plan.required_free_bytes)}`);
  const diff = plan.dependency_diff && typeof plan.dependency_diff === 'object' ? plan.dependency_diff : {};
  for (const [key, value] of Object.entries(diff)) {
    if (Array.isArray(value) && value.length) fact(DEPENDENCY_LABELS[key] || `Зависимости ${key}`, moduleList(value.map(String), names));
  }
  summary.append(facts);
  if (plan.restart_required) summary.append(node('p', 'modules-warning', 'После операции потребуется перезапуск панели.'));
  for (const blocker of blockers) summary.append(describeBlocker(blocker, names));
  apply.hidden = plan.applicable !== true || !plan.plan_id;
  apply.disabled = false;
  dialog.querySelector('#modules-plan-cancel').disabled = false;
}

// A refusal to apply is said where the owner is looking: inside the plan.
export function renderPlanError(dialog, error) {
  const summary = dialog.querySelector('#modules-plan-summary');
  summary.querySelector('.modules-plan-error')?.remove();
  if (!error) return;
  const line = alertLine('modules-alert modules-plan-error', 'План не применён.', describeLifecycleFailure(error));
  line.setAttribute('role', 'alert');
  summary.append(line);
}

// The server never answers "idle": without operations the result is null.
export function hasOperationStatus(status) {
  return Boolean(status) && status.result != null && status.result !== 'idle';
}

function operationTitle(status, names) {
  const title = OPERATION_TITLES[status.operation];
  if (!title) return 'Операция с модулями';
  if (status.operation === 'panel-update') return status.version ? `${title} до ${status.version}` : title;
  if (!status.module_id) return [title, status.version].filter(Boolean).join(' ');
  return [`${title} «${moduleLabel(status.module_id, names)}»`, status.version].filter(Boolean).join(' ');
}

function appendOperationProblems(area, status) {
  const failure = status.result === 'rollback_failed' ? { code: 'operation_rollback_failed' }
    : (status.error_code ? { code: status.error_code } : null);
  if (failure) {
    const line = node('p', 'modules-alert');
    line.append(node('strong', '', describeLifecycleFailure(failure)));
    // The words of the installer itself and the file it stopped at.
    if (status.error_detail) line.append(node('span', 'modules-alert-detail', status.error_detail));
    if (status.failed_path) line.append(node('span', 'modules-alert-detail', `Сорвалось на файле ${status.failed_path}`));
    area.append(line);
  }
  if (status.environment_restored === false) {
    area.append(alertLine(
      'modules-alert',
      'Окружение роутера не восстановлено.',
      'Панель работает на прежних файлах, но пакеты могли остаться от нового выпуска. Запустите установщик поверх, чтобы привести их в порядок.',
    ));
  }
  for (const warning of Array.isArray(status.warnings) ? status.warnings : []) {
    if (warning?.code === 'package_missing' && warning.package) {
      const line = alertLine('modules-warning', `Не установлен пакет ${warning.package}.`);
      if (warning.command) {
        const command = node('span', 'modules-command');
        const copy = node('button', 'btn-secondary modules-command-copy', 'Копировать');
        copy.type = 'button';
        copy.addEventListener('click', () => copyCommand(warning.command, copy));
        command.append(node('code', '', warning.command), copy);
        line.append(command);
      }
      area.append(line);
    } else if (warning?.code === 'packages_step_failed') {
      area.append(alertLine('modules-warning', 'Установка пакетов завершилась с ошибкой.', 'Часть пакетов могла не установиться.'));
    }
  }
}

export function renderOperationStatus(host, status, { onCancel, onRecovery, busy = false, names = null } = {}) {
  host.replaceChildren();
  if (!hasOperationStatus(status)) return;
  const tone = RESULT_TONES[status.result] || 'run';
  const area = node('section', `modules-operation card is-${tone}`);
  const heading = node('h2', '', operationTitle(status, names));
  heading.append(node('span', `modules-chip is-${tone}`, RESULT_LABELS[status.result] || String(status.result)));
  area.append(heading);
  const started = formatMoment(status.started_at);
  if (started) {
    const duration = formatDuration(status.started_at, status.finished_at);
    area.append(node('p', 'modules-meta', duration ? `Начато ${started} · длилось ${duration}` : `Начато ${started}`));
  }
  if (status.result === 'running' && status.step) {
    area.append(node('p', '', `Сейчас: ${STEP_LABELS[status.step] || status.step}`));
  }
  appendOperationProblems(area, status);
  // Interrupted means over: nothing was laid, or what was laid is undone.
  if (status.result === 'interrupted' && status.error_code !== 'operation_superseded') area.append(node('p', '', 'Файлы панели не изменены.'));
  if (Array.isArray(status.log) && status.log.length) {
    const log = node('ol', 'modules-operation-log-region');
    for (const record of status.log) {
      if (!record || typeof record !== 'object') continue;
      const row = node('li', 'modules-operation-log');
      row.append(node('time', '', formatClock(record.at)), node('span', '', STEP_LABELS[record.step] || String(record.step ?? '')));
      log.append(row);
    }
    area.append(log);
  }
  if (status.result === 'running' && status.operation_id) {
    const cancel = node('button', 'btn-secondary', 'Отменить операцию');
    cancel.type = 'button';
    cancel.disabled = busy;
    cancel.addEventListener('click', onCancel);
    area.append(cancel);
  }
  if (status.result === 'rollback_failed') {
    const recover = node('button', 'btn-secondary', 'Повторить восстановление');
    recover.type = 'button';
    recover.disabled = busy;
    recover.addEventListener('click', onRecovery);
    area.append(recover);
  }
  host.append(area);
}

export function renderInstalled(host, snapshot, onToggle, onPlan = () => {}, busy = false, {
  onRestart = null,
  canRestart = false,
  onCheckUpdate = null,
  update = null,
  onEditorVariant = null,
  showUpdateChannelControl = false,
  onUpdateChannel = null,
  channelBusy = false,
  expandedModules = new Set(),
} = {}) {
  host.replaceChildren();
  const summary = node('section', 'modules-summary card');
  const summaryIntro = node('div', 'modules-summary-intro');
  summaryIntro.append(node('span', 'modules-section-kicker', 'Состояние панели'));
  summaryIntro.append(node('h2', '', 'Панель и профиль'));
  summary.append(summaryIntro);
  const summaryIdentity = node('div', 'modules-summary-identity');
  appendPanelIdentity(summaryIdentity, snapshot);
  if (showUpdateChannelControl && typeof onUpdateChannel === 'function') {
    appendUpdateChannelControl(summaryIdentity, snapshot, { onUpdateChannel, channelBusy });
  }
  appendModuleSets(summaryIdentity, snapshot);
  summary.append(summaryIdentity);
  const summaryControls = node('div', 'modules-summary-controls');
  if (snapshot.restart_required || canRestart) summaryControls.append(node('p', 'modules-warning', 'Требуется перезапуск'));
  const panelActions = node('div', 'modules-card-actions');
  if (snapshot.lifecycle?.available === false) {
    summaryControls.append(node('p', 'modules-alert', describeLifecycleFailure(snapshot.lifecycle)));
  } else {
    panelActions.append(actionButton('panel-update', null, ACTION_LABELS['panel-update'], onPlan, busy));
    if (snapshot.previous_version?.available) panelActions.append(actionButton('panel-rollback', null, ACTION_LABELS['panel-rollback'], onPlan, busy));
    if (snapshot.transition_required) panelActions.append(actionButton('profile-transition', null, ACTION_LABELS['profile-transition'], onPlan, busy));
  }
  if (canRestart && typeof onRestart === 'function') {
    const restart = node('button', 'btn-primary modules-restart-panel', 'Перезапустить панель');
    restart.type = 'button';
    restart.disabled = busy;
    restart.addEventListener('click', onRestart);
    panelActions.append(restart);
  }
  if (panelActions.childElementCount) summaryControls.append(panelActions);
  appendUpdateCheck(summaryControls, update, {
    onCheckUpdate,
    busy,
    lifecycleAvailable: snapshot.lifecycle?.available,
  });
  summary.append(summaryControls);
  host.append(summary);
  const list = node('section', 'modules-list card');
  const listHeader = node('div', 'modules-list-header');
  listHeader.append(
    node('div', 'modules-list-heading'),
    node('span', 'modules-list-count', `${Array.isArray(snapshot.modules) ? snapshot.modules.length : 0} модулей`),
  );
  listHeader.querySelector('.modules-list-heading').append(node('h2', '', 'Установленные модули'));
  list.append(listHeader);
  const modules = Array.isArray(snapshot.modules) ? snapshot.modules : [];
  if (!modules.length) list.append(node('p', 'modules-empty', 'Установленных модулей нет.'));
  modules.forEach((item) => {
    const row = node('article', 'modules-row modules-module');
    const header = node('div', 'modules-module-header');
    const isCore = item.id === 'core';
    const expanded = !isCore && expandedModules.has(item.id);
    const title = node(isCore ? 'div' : 'button', isCore ? 'modules-module-static' : 'modules-module-toggle');
    if (!isCore) title.type = 'button';
    const details = node('div', 'modules-module-details');
    details.id = `modules-details-${String(item.id).replace(/[^a-z0-9-]/gi, '-')}`;
    details.hidden = !expanded;
    if (!isCore) {
      title.setAttribute('aria-expanded', String(expanded));
      title.setAttribute('aria-label', `${expanded ? 'Свернуть' : 'Развернуть'} ${item.name || item.id}`);
      title.setAttribute('aria-controls', details.id);
      title.addEventListener('click', () => {
        const nextExpanded = !expandedModules.has(item.id);
        if (nextExpanded) expandedModules.add(item.id);
        else expandedModules.delete(item.id);
        title.setAttribute('aria-expanded', String(nextExpanded));
        title.setAttribute('aria-label', `${nextExpanded ? 'Свернуть' : 'Развернуть'} ${item.name || item.id}`);
        details.hidden = !nextExpanded;
      });
    } else {
      details.remove();
    }
    const titleText = node('span', 'modules-module-title');
    titleText.append(node('strong', '', moduleTitle(item)));
    title.append(moduleIcon(item.id), titleText);
    if (!isCore) {
      const chevron = node('span', 'modules-module-chevron');
      chevron.setAttribute('aria-hidden', 'true');
      chevron.innerHTML = iconHtml('chevron-down', 'modules-module-chevron-svg');
      title.append(chevron);
    }
    header.append(title);
    const body = node('div', 'modules-row-body');
    const editorVariant = item.id === 'tool.editor' && item.enabled === true && typeof onEditorVariant === 'function'
      ? EDITOR_VARIANTS.find((variant) => variant.id === snapshot.editor?.variant)
      : null;
    if (!isCore && item.description) body.append(node('p', '', item.description));
    if (editorVariant) {
      // The row has no switch while an engine is on: say why.
      body.append(node('p', '', item.can_disable ? 'Редакторы конфигов.' : 'Редакторы конфигов. Нужны, пока включено хотя бы одно ядро.'));
      body.append(node('p', 'modules-variant-hint', `${editorVariant.label}: ${editorVariant.hint}`));
      if (editorVariantsLocked(snapshot)) {
        body.append(node('p', 'modules-variant-hint', 'Стандартный и расширенный варианты докачивают файлы. На локальной сборке докачка недоступна.'));
      }
    }
    const facts = node('dl', 'modules-module-facts');
    facts.append(node('dt', '', 'Идентификатор'), node('dd', '', item.id));
    if (Array.isArray(item.dependencies) && item.dependencies.length) {
      facts.append(node('dt', '', 'Зависимости'), node('dd', '', moduleList(item.dependencies, new Map(
        (snapshot.modules || []).map((module) => [module.id, module.name || module.id]),
      ))));
    }
    if (!isCore) {
      body.append(facts);
      details.append(body);
    }
    const controls = node('div', 'modules-row-actions');
    if (item.can_disable) {
      const label = node('label', 'dt-switch xk-switch-bare modules-switch');
      const stateLabel = node(
        'span',
        `dt-switch-label modules-switch-state ${item.enabled === true ? 'is-enabled' : 'is-disabled'}`,
        item.enabled === true ? 'Включён' : 'Выключен',
      );
      const switchControl = node('span', 'modules-switch-control');
      const input = node('input');
      input.type = 'checkbox';
      input.setAttribute('role', 'switch');
      input.setAttribute('aria-label', `Включить ${item.name || item.id}`);
      input.dataset.moduleId = item.id;
      input.checked = item.enabled === true;
      input.disabled = busy;
      input.addEventListener('change', () => onToggle(item.id, input.checked, input));
      switchControl.append(input, node('span', 'dt-switch-slider'));
      label.append(stateLabel, switchControl);
      controls.append(label);
    }
    if (!isCore && controls.childElementCount) header.append(controls);
    row.append(header);
    if (!isCore) {
      const detailControls = node('div', 'modules-module-detail-actions');
      if (editorVariant) detailControls.append(editorVariantControl(snapshot, editorVariant, onEditorVariant, busy));
      const actions = Array.isArray(item.lifecycle_actions) ? item.lifecycle_actions : [];
      for (const action of actions) {
        if (ACTION_LABELS[action]) detailControls.append(actionButton(action, item.id, `${ACTION_LABELS[action]} ${item.name || item.id}`, onPlan, busy));
      }
      if (detailControls.childElementCount) details.append(detailControls);
      row.append(details);
    }
    list.append(row);
  });
  host.append(list);
}

export function renderAvailable(host, catalog, onPlan = () => {}, busy = false, { names = null, onRefresh = null } = {}) {
  host.replaceChildren();
  if (catalog.freshness === 'stale') {
    // The server answered from the catalog it kept: not today's word.
    const note = alertLine(
      'modules-warning',
      'Каталог мог устареть.',
      `Не удалось связаться с GitHub, показан каталог${catalog.release_version ? ` выпуска ${catalog.release_version}` : ''} от ${formatCatalogTime(catalog.fetched_at)}.`,
    );
    if (typeof onRefresh === 'function') {
      const refresh = node('button', 'btn-secondary modules-inline-action', 'Обновить каталог');
      refresh.type = 'button';
      refresh.disabled = busy;
      refresh.addEventListener('click', onRefresh);
      note.append(refresh);
    }
    host.append(note);
  }
  const modules = Array.isArray(catalog.modules) ? catalog.modules : [];
  if (!modules.length) host.append(node('p', 'modules-empty', 'Доступных модулей нет.'));
  modules.forEach((item) => {
    const card = node('article', 'modules-card');
    const heading = node('h2', '', moduleTitle(item));
    if (item.installed === true) heading.append(node('span', 'modules-chip is-ok', 'Установлен'));
    card.append(heading);
    if (item.description) card.append(node('p', '', item.description));
    dependencies(card, 'Нужны модули', item.requires || item.dependencies, names);
    dependencies(card, 'Конфликтуют', item.conflicts, names);
    // What is installed is repaired and removed on its own tab.
    const actions = item.installed === true ? [] : (Array.isArray(item.lifecycle_actions) ? item.lifecycle_actions : []);
    if (actions.length) {
      const actionRow = node('div', 'modules-card-actions');
      actions.forEach((action) => {
        if (ACTION_LABELS[action]) actionRow.append(actionButton(action, item.id, `${ACTION_LABELS[action]} ${item.name || item.id}`, onPlan, busy));
      });
      card.append(actionRow);
    }
    host.append(card);
  });
}

export function renderCatalogError(host, error, onRetry) {
  host.replaceChildren();
  const line = node('p', 'modules-alert');
  line.setAttribute('role', 'alert');
  line.append(node('strong', '', describeLifecycleFailure(error)));
  if (typeof onRetry === 'function') {
    const retry = node('button', 'btn-secondary modules-inline-action', 'Повторить');
    retry.type = 'button';
    retry.addEventListener('click', onRetry);
    line.append(retry);
  }
  host.append(line);
}
