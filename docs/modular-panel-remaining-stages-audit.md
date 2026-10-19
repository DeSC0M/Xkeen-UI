# Сверка незакрытых подэтапов 8.8–10 с текущим кодом

**Дата сверки:** 19 октября 2026 года
**Область:** Notification center, recovery/rollout, testing/migrations,
runtime performance

Этот документ отличает существующий код и тесты от требований, которые ещё
нельзя объявить закрытыми. Наличие catalog cache, update note или unit-теста
не считается автоматически готовым Notification center, router rollout или
performance baseline.

## 8.7 Notification center

### Реализовано и закрыто 19 октября 2026 года

- `services.module_catalog_client.ModuleCatalogClient`: verified catalog,
  отдельные stable/prerelease cache files, TTL 24 часа, forced-refresh
  interval 5 минут и stale fallback только при transport failure.
- `services.module_update_channel` и `/api/modules/update-channel` сохраняют
  выбранный `stable`/`prerelease` канал.
- `ModuleLifecycleService.panel_update_check()` и
  `POST /api/modules/panel/update-check` возвращают version/update,
  `requires_installer`, freshness, stale reason и fetched timestamp без
  скачивания panel archive.
- `/modules` показывает panel update note и имеет manual check. DevTools
  использует тот же lifecycle API и сохранённый catalog answer.
- `features/module_manager/badge.js` даёт per-tab panel-update hint в
  `sessionStorage`; E2E проверяет выставление/очистку badge после applicable
  plan и current-version response.
- `/available` читает каталог установленного release. Сейчас lifecycle
  поддерживает `install`, `repair`, `remove`, а не независимый module update;
  каталог entries помечает `update_available: false`.
- Проверка обновлений читает catalog без panel archive; явный запрос plan
  может скачать и проверить archive. `Apply` запускает mutation transaction.
  `NotificationCenter` сохраняет это разделение check/plan/apply.
- Core-owned notification API/UI: `/api/notifications` и
  `/api/modules/notifications/*`, общая шапка, без импорта DevTools.
- Daemon daily poller в `run_server.py`: non-blocking startup, per-channel
  daily gate и bounded exponential backoff; manual check продолжает уважать
  catalog min-refresh.
- Persisted `seen/dismissed/snoozed`, schema migration, bounded retention,
  identity type/module-or-panel/version/channel и tab synchronization.
- Notifications for panel version, new official modules and changed installed
  modules; size/restart/dependency diff metadata; stale/error records with
  retry/dismiss controls.
- Poll and badge read only signed catalogs. No archive is downloaded before a
  separate explicit plan request.

**Вывод:** 8.7 закрыт. Per-tab legacy badge сохранён как лёгкий hint, но
источник правды и local notification state находятся в Notification center.

## 8.8 Recovery matrix и rollout

### Уже реализовано и покрыто

Основные доказательства находятся в:
`tests/test_module_catalog_client.py`,
`tests/test_module_catalog_trust.py`, `tests/test_module_package_contract.py`,
`tests/test_module_transactions_executor.py`,
`tests/test_module_lifecycle.py`,
`tests/test_panel_profile_transactions.py`,
`tests/test_panel_rollback_to_previous_version.py`,
`e2e/modules_manager_*.spec.mjs`.

Покрыты trust/signature, SHA-256/size/API/architecture checks, traversal,
symlink/hooks/ownership, corrupt archive/cache, transport stale fallback,
free-space/dependency/conflict/active-engine blockers, stale plans, detached
runner, journal/cancel, health failure, interrupted recovery,
`rollback_failed`, module-only file diff, panel/profile scoped rollback и
previous-version rollback без сети.

### Не является доказанным

- реальный disk-full/power-loss/Entware process failure на роутере;
- signed prerelease install/update/recovery на отдельном стенде;
- единый отчёт `failure → UI/error → journal/state → rollback/restart →
  user action`;
- stable rollout с legacy migration и stop/go criteria;
- device smoke для каждого recovery case.

**Вывод:** recovery implementation зрелая, но 8.8 не закрыт до стендового
отчёта. Автоматические tests и CI не заменяют rollout evidence.

## Этап 9. Тестирование и миграции

### Состояние

Большая часть запланированных проверок уже существует:

- registry/schema corruption/migration/frozen activation —
  `tests/test_module_registry.py`;
- module gates/optional factory failure/DNS lifecycle —
  `tests/test_module_backend_gates.py`, `tests/test_dns_guard.py`;
- profiles/import closure —
  `tests/test_installer_profiles.py`,
  `tests/test_installer_profile_frontend_closure.py`,
  `tests/test_module_packages_over_installer_profiles.py`;
- lifecycle/transactions/recovery —
  `tests/test_module_lifecycle*.py`,
  `tests/test_module_transactions_*.py`,
  `tests/test_installer_module_transaction_recovery.py`;
- panel/profile/rollback —
  `tests/test_panel_profile_transactions.py`,
  `tests/test_panel_rollback_to_previous_version.py`;
- lazy loading/profile boundaries —
  `e2e/modular_panel_dynamic_loading.spec.mjs`;
- manager/recovery/navigation —
  `e2e/modules_manager_*.spec.mjs`,
  `e2e/panel_module_load_recovery.spec.mjs`,
  `e2e/top_level_back_before_bundle_screens.spec.mjs`.

### Пробелы

- Нет обязательной CI matrix, которая запускает dynamic-loading E2E для всех
  `XKEEN_E2E_MODULE_PROFILE`; fixture умеет профили, но текущий CI запускает
  только Mihomo Clash acceptance slice.
- Нужна browser-приёмка Notification center для настоящего
  `BroadcastChannel`/нескольких вкладок; unit/route tests уже покрывают
  daily/manual poll, local state, channel isolation, offline и no-download.
- Нет единого cross-profile release/device report с сохранением конфигов и
  recovery evidence.
- Unit/tmp-tree tests не заменяют acceptance signed lifecycle и ручного
  bootstrap на целевом Entware/роутере.
- Ручной `xkeen-ui-routing.tar.gz`/`install.sh` bootstrap не должен
  описываться как Ed25519 catalog delivery: подпись проверяется в Lifecycle
  API release path.

**Вывод:** Этап 9 функционально продвинут, но открыт как интеграционный
regression/profile/release acceptance.

## Этап 10. Оптимизация размера и запуска

### Что уже есть

- `docs/modular-panel-stage3r1-initial-html-baseline.{json,md}` и
  `scripts/generate_modular_panel_stage3r1_baseline.py` — воспроизводимый
  structural initial-HTML baseline, закрытый 30 сентября 2026 года.
- Stage 0 inventory и `xkeen-ui/module-sizes.json` считают canonical UTF-8
  source/test/template bytes и ownership counts.
- Vite raw/bridge manifests, thin wrappers, lazy bundle boundaries и
  deferred xterm CSS проверяются static/E2E tests.
- Profile installer строит import/file closure; archive builder
  precompresses static assets; stale generated assets удаляются.
- `services.memory_guard` и memory-budget settings ограничивают cache pressure.

### Что отсутствует

Нет единого tracked router harness/report для:

- logical/flash size selected profile и archive/quarantine/previous copy;
- cold/warm HTTP/frontend startup;
- panel/runner RSS и imported Python modules;
- active Blueprint/scheduler/WS counts;
- initial HTML, transferred/decoded JS/CSS, requests/WS;
- lifecycle peak RSS/free-space/time during plan/apply/rollback.

Structural HTML size, module source bytes и memory guard не являются этими
runtime measurements. Базовый отчёт должен фиксировать router architecture,
firmware/Entware/Python, commit/build, profile, editor variant, cache state и
active core. Thresholds нельзя выдумывать до замеров.

**Вывод:** Этап 10 открыт. Следующий шаг — один воспроизводимый router
benchmark, затем оптимизация только измеренных bottleneck'ов без регрессии
import closure, trust, recovery и gates.
