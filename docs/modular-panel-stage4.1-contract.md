# Этап 4.1. Контракт границ shell, экранов и модальных окон

Статус: **закрыт 29 сентября 2026 года**.

Документ был создан до физического переноса разметки и теперь остаётся актуальным contract source для composed document. Исторический монолит сохранён в baseline Этапа 3R.1, а `panel.html` работает как thin composition root.

## Артефакты и baseline

- исходный шаблон: `xkeen-ui/templates/panel.html`;
- роль entrypoint: thin composition root; screen и modal markup принадлежат partials;
- Stage 0 inventory: `docs/modular-panel-stage0-inventory.json`;
- machine-readable contract: `docs/modular-panel-stage4.1-contract.json`;
- пересборка: `python .\scripts\generate_modular_panel_stage4_1_contract.py --root .`;
- UTF-8 размер: `428665` байт;
- строк: `5650`;
- статических `id`: `1352`, дубликатов: `0`;
- SHA-256 текущего baseline: `8f99dd4c99d772d7fb76bced81ae1fa7770fed2af5ab227a9fa34eb1fb2bd4b2`.

## Правила composition

- `panel.html` остаётся совместимой точкой входа и composition root.
- DOM id, data-view, data-xk-section, data-xk-shell и modal data-* считаются замороженным контрактом.
- screen и modal partials получают только используемые значения page_context.
- разметка отключённого модуля отсутствует в серверном initial HTML.
- загрузка frontend-бандлов и import() остаются задачей Этапа 5.

Порядок рендера:

```text
head → startup → header → navigation → global_controls → screens → modals
```

## Shell boundaries

| Область | Владелец | Целевой partial | Якорь, строка | DOM-контракт |
| --- | --- | --- | --- | --- |
| head | core | xkeen-ui/templates/panel/head.html | 3 | `xk-panel-operator-paint-guard` |
| page_config | core | xkeen-ui/templates/panel/page_config.html | 12 | `window.XKeen.pageConfig`, `var pageConfig` |
| startup | core | xkeen-ui/templates/panel/shell.html | 74 | `global-xkeen-spinner`, `xk-panel-operator-paint-guard`, `xk-panel-operator-pending` |
| header | core | xkeen-ui/templates/panel/header.html | 95 | `xk-brand-logo`, `xkeen-service-lamp`, `xkeen-service-text`, `xkeen-core-text`, `xray-logs-badge` |
| navigation | core | xkeen-ui/templates/panel/navigation.html | 247 | `data-view=routing`, `data-view=mihomo`, `data-view=xkeen`, `data-view=xray-logs`, `data-view=commands` |
| global_controls | core | xkeen-ui/templates/panel/shell.html | 275 | `xkeen-start-btn`, `xkeen-stop-btn`, `xkeen-restart-btn`, `global-autorestart-xkeen`, `routing-focus-switch` |

## Screen boundaries

| Screen | Владелец | Целевой partial | Корень | Frontend roots | API groups |
| --- | --- | --- | --- | --- | --- |
| routing | engine.xray | xkeen-ui/templates/panel/screens/routing.html | `#view-routing` / 465 | panel-routing | /api/routing/*, /api/xray/*, /api/dns/* |
| mihomo | engine.mihomo | xkeen-ui/templates/panel/screens/mihomo.html | `#view-mihomo` / 1176 | panel-mihomo | /api/mihomo/*, /api/mihomo/clash/* |
| xkeen | core | xkeen-ui/templates/panel/screens/xkeen.html | `#view-xkeen` / 1909 | panel-core | /api/service/*, /api/cores/*, /api/settings/* |
| xray-logs | engine.xray | xkeen-ui/templates/panel/screens/xray_logs.html | `#view-xray-logs` / 2363 | panel-core, panel-routing | /api/xray/logs, /api/xray/* |
| commands | tool.terminal | xkeen-ui/templates/panel/screens/commands.html | `#view-commands` / 2024 | panel-core, terminal-lazy | /api/run-command, /api/command-jobs/*, /ws/* |
| files | tool.files | xkeen-ui/templates/panel/screens/files.html | `#view-files` / 2271 | panel-core, file-manager-lazy | /api/fs/*, /api/fileops/*, /api/remotefs/* |

Все дочерние `id`, `data-*`, `aria-*` и trigger selectors screen должны сохраниться при переносе. `mihomo_generator.html` не входит в эту таблицу: это отдельная canonical page с собственным entrypoint.

## Modal boundaries

В таблице отдельно показаны текущая классификация inventory и целевой владелец. Это позволяет безопасно исправить историческую классификацию file-manager/SSH modal, не теряя baseline Stage 0.

| Modal id | Inventory | Целевой владелец | Boundary | Целевой partial | Строка |
| --- | --- | --- | --- | --- | --- |
| xk-resource-dashboard-modal | tool.advanced-diagnostics | tool.advanced-diagnostics | owned | xkeen-ui/templates/panel/modals/diagnostics.html | 305 |
| xray-context-modal | engine.xray | engine.xray | owned | xkeen-ui/templates/panel/modals/routing.html | 2481 |
| xray-devices-modal | engine.xray | engine.xray | owned | xkeen-ui/templates/panel/modals/routing.html | 2498 |
| routing-dns-over-vless-modal | engine.xray | engine.xray | owned | xkeen-ui/templates/panel/modals/routing.html | 2522 |
| inbounds-apply-modal | engine.xray | engine.xray | owned | xkeen-ui/templates/panel/modals/routing.html | 2806 |
| routing-balancer-help-modal | engine.xray | engine.xray | owned | xkeen-ui/templates/panel/modals/routing.html | 2854 |
| xray-snapshot-modal | engine.xray | engine.xray | owned | xkeen-ui/templates/panel/modals/routing.html | 3019 |
| routing-template-modal | engine.xray | engine.xray | owned | xkeen-ui/templates/panel/modals/routing.html | 3050 |
| routing-template-save-modal | engine.xray | engine.xray | owned | xkeen-ui/templates/panel/modals/routing.html | 3103 |
| routing-template-edit-modal | engine.xray | engine.xray | owned | xkeen-ui/templates/panel/modals/routing.html | 3139 |
| outbounds-generator-modal | engine.xray | engine.xray | owned | xkeen-ui/templates/panel/modals/routing.html | 3193 |
| outbounds-pool-modal | engine.xray | engine.xray | owned | xkeen-ui/templates/panel/modals/routing.html | 3461 |
| routing-dat-contents-modal | engine.xray | engine.xray | owned | xkeen-ui/templates/panel/modals/routing.html | 3560 |
| terminal-history-modal | tool.terminal | tool.terminal | owned | xkeen-ui/templates/panel/modals/commands.html | 3803 |
| ssh-modal | core | tool.terminal | mixed-current-classification | xkeen-ui/templates/panel/modals/commands.html | 3824 |
| ssh-edit-modal | core | tool.terminal | mixed-current-classification | xkeen-ui/templates/panel/modals/commands.html | 3856 |
| ssh-confirm-modal | core | tool.terminal | mixed-current-classification | xkeen-ui/templates/panel/modals/commands.html | 3897 |
| ssh-transfer-modal | core | tool.terminal | mixed-current-classification | xkeen-ui/templates/panel/modals/commands.html | 3913 |
| core-modal | core | core | shared | xkeen-ui/templates/panel/modals/shared.html | 3935 |
| confirm-modal | core | core | shared | xkeen-ui/templates/panel/modals/shared.html | 4000 |
| github-export-modal | core | core | shared | xkeen-ui/templates/panel/modals/shared.html | 4016 |
| github-catalog-modal | core | core | shared | xkeen-ui/templates/panel/modals/shared.html | 4035 |
| donate-modal | core | core | shared | xkeen-ui/templates/panel/modals/shared.html | 4062 |
| ui-settings-modal | core | core | shared | xkeen-ui/templates/panel/modals/shared.html | 4118 |
| mihomo-dns-modal | engine.mihomo | engine.mihomo | owned | xkeen-ui/templates/panel/modals/mihomo.html | 4145 |
| mihomo-import-modal | engine.mihomo | engine.mihomo | owned | xkeen-ui/templates/panel/modals/mihomo.html | 4310 |
| mihomo-proxy-tools-modal | engine.mihomo | engine.mihomo | owned | xkeen-ui/templates/panel/modals/mihomo.html | 4432 |
| mihomo-validation-modal | engine.mihomo | engine.mihomo | owned | xkeen-ui/templates/panel/modals/mihomo.html | 4574 |
| mihomo-hwid-modal | integration.happ | integration.happ | owned | xkeen-ui/templates/panel/modals/happ.html | 4641 |
| fm-upload-conflict-modal | core | tool.files | mixed-current-classification | xkeen-ui/templates/panel/modals/files.html | 4767 |
| fm-connect-modal | core | tool.files | mixed-current-classification | xkeen-ui/templates/panel/modals/files.html | 4788 |
| fm-knownhosts-modal | core | tool.files | mixed-current-classification | xkeen-ui/templates/panel/modals/files.html | 4886 |
| fm-create-modal | core | tool.files | mixed-current-classification | xkeen-ui/templates/panel/modals/files.html | 4917 |
| fm-rename-modal | core | tool.files | mixed-current-classification | xkeen-ui/templates/panel/modals/files.html | 4954 |
| fm-archive-modal | core | tool.files | mixed-current-classification | xkeen-ui/templates/panel/modals/files.html | 4979 |
| fm-extract-modal | core | tool.files | mixed-current-classification | xkeen-ui/templates/panel/modals/files.html | 5018 |
| fm-folder-picker-modal | core | tool.files | mixed-current-classification | xkeen-ui/templates/panel/modals/files.html | 5075 |
| fm-archive-list-modal | core | tool.files | mixed-current-classification | xkeen-ui/templates/panel/modals/files.html | 5099 |
| fm-mask-modal | core | tool.files | mixed-current-classification | xkeen-ui/templates/panel/modals/files.html | 5135 |
| fm-props-modal | core | tool.files | mixed-current-classification | xkeen-ui/templates/panel/modals/files.html | 5159 |
| fm-hash-modal | core | tool.files | mixed-current-classification | xkeen-ui/templates/panel/modals/files.html | 5178 |
| fm-chmod-modal | core | tool.files | mixed-current-classification | xkeen-ui/templates/panel/modals/files.html | 5210 |
| fm-chown-modal | core | tool.files | mixed-current-classification | xkeen-ui/templates/panel/modals/files.html | 5263 |
| fm-dropop-modal | core | tool.files | mixed-current-classification | xkeen-ui/templates/panel/modals/files.html | 5296 |
| fm-conflicts-modal | core | tool.files | mixed-current-classification | xkeen-ui/templates/panel/modals/files.html | 5316 |
| fm-bookmarks-modal | core | tool.files | mixed-current-classification | xkeen-ui/templates/panel/modals/files.html | 5343 |
| fm-download-multi-modal | core | tool.files | mixed-current-classification | xkeen-ui/templates/panel/modals/files.html | 5371 |
| fm-progress-modal | core | tool.files | mixed-current-classification | xkeen-ui/templates/panel/modals/files.html | 5411 |
| fm-ops-modal | core | tool.files | mixed-current-classification | xkeen-ui/templates/panel/modals/files.html | 5432 |
| fm-volumes-modal | core | tool.files | mixed-current-classification | xkeen-ui/templates/panel/modals/files.html | 5463 |
| fm-help-modal | core | tool.files | mixed-current-classification | xkeen-ui/templates/panel/modals/files.html | 5485 |
| fm-editor-modal | tool.editor | tool.editor | owned | xkeen-ui/templates/panel/modals/files_editor.html | 5551 |
| json-editor-modal | tool.editor | tool.editor | owned | xkeen-ui/templates/panel/modals/editor.html | 5588 |

## Mixed boundaries и решения

### `navigation`

- текущая область: `xkeen-ui/templates/panel.html`;
- владельцы: `core`, `engine.xray`, `engine.mihomo`, `tool.terminal`, `tool.files`;
- решение: Core owns the navigation shell; individual buttons and sections are gated by their module owner.

### `global-controls`

- текущая область: `xkeen-ui/templates/panel.html`;
- владельцы: `core`, `engine.xray`;
- решение: Keep service controls in core shell; keep routing-focus markup as an engine.xray-owned slot.

### `routing-editor`

- текущая область: `#view-routing`;
- владельцы: `engine.xray`, `tool.editor`;
- решение: The screen belongs to engine.xray; editor widgets and schemas are delegated to tool.editor.

### `mihomo-editor`

- текущая область: `#view-mihomo and Mihomo modals`;
- владельцы: `engine.mihomo`, `tool.editor`;
- решение: The screen belongs to engine.mihomo; editor widgets and schemas are delegated to tool.editor.

### `mihomo-hwid`

- текущая область: `#mihomo-hwid-modal`;
- владельцы: `engine.mihomo`, `integration.happ`;
- решение: Happ-specific markup is integration.happ-owned and requires engine.mihomo at runtime.

### `file-editor`

- текущая область: `#fm-editor-modal`;
- владельцы: `tool.files`, `tool.editor`;
- решение: File manager owns the workflow; editor markup is a separate tool.editor modal partial.

### `ssh-file-manager`

- текущая область: `SSH and file-manager modals`;
- владельцы: `tool.terminal`, `tool.files`;
- решение: SSH belongs to tool.terminal; file operations belong to tool.files, despite the current inventory fallback to core.

## Profile baseline

| Профиль | Active modules | Ожидаемые screens | Запрещённые screens | Разрешено modal | Запрещено modal |
| --- | --- | --- | --- | --- | --- |
| legacy-full | core, engine.xray, engine.mihomo, tool.editor, tool.terminal, tool.files, tool.backups, integration.happ, tool.advanced-diagnostics | routing, mihomo, xkeen, xray-logs, commands, files | — | 53 | 0 |
| full | core, engine.xray, engine.mihomo, tool.editor, tool.terminal, tool.files, tool.backups, integration.happ, tool.advanced-diagnostics | routing, mihomo, xkeen, xray-logs, commands, files | — | 53 | 0 |
| xray-minimal | core, tool.editor, engine.xray | routing, xkeen, xray-logs | mihomo, commands, files | 19 | 34 |
| mihomo-minimal | core, tool.editor, engine.mihomo | mihomo, xkeen | routing, xray-logs, commands, files | 11 | 42 |

## Критерий завершения Этапа 4.1

Критерий готовности **выполнен**:

- для каждого screen определены `module_id`, partial, root id, frontend roots и API groups;
- для каждого modal определены текущая классификация, целевой владелец, partial и DOM-контракт;
- shell, navigation и mixed-boundaries имеют явные решения;
- зафиксированы профили `legacy-full`, `full`, `xray-minimal` и `mihomo-minimal`;
- baseline защищён генератором и тестом синхронности.

Физическое создание partials и перенос markup относятся к подэтапу 4.2 и последующим.
