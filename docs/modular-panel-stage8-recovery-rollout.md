# Подэтап 8.8: recovery matrix и rollout

**Статус:** recovery engine и большая часть автоматических проверок готовы;
сводная эксплуатационная приёмка и rollout не закрыты. Read-only preflight
19 октября 2026 года зафиксирован в
[`stage8-8/recovery-rollout-matrix-2026-10-19.md`](stage8-8/recovery-rollout-matrix-2026-10-19.md).

## Уже покрыто

Код и targeted tests покрывают:

- trust/key/signature, API/architecture compatibility, checksum и archive
  limits;
- path traversal, symlink/script-hook и ownership validation;
- corrupt archive/cache, недоступный catalog и verified stale fallback;
- free-space, missing-dependency, conflict и active-engine blockers;
- stale plan, lifecycle lock, detached runner, journal и cancel до/после apply;
- health-check, interrupted recovery и `rollback_failed`;
- module-only install/repair/remove с ограниченным file diff;
- panel update, profile transition и scoped full rollback;
- previous-version copy и явный panel rollback без сети;
- manager UI progress/error/recovery/restart и blocked-action states.

Основные источники: `tests/test_module_catalog_client.py`,
`tests/test_module_catalog_trust.py`, `tests/test_module_package_contract.py`,
`tests/test_module_transactions_executor.py`,
`tests/test_module_lifecycle.py`, `tests/test_panel_profile_transactions.py`,
`tests/test_panel_rollback_to_previous_version.py` и
`e2e/modules_manager_*.spec.mjs`.

Отдельный безопасный collector для стендового preflight:
`scripts/stage8_8_router_smoke.py`. Он выполняет только GET к panel API и
фиксированную read-only SSH-команду; lifecycle apply/profile/restart/fault
injection в нём отсутствуют намеренно.

## Актуализация после аудита 8.7

В `pre-release` уже вошли follow-up исправления аудита 8.7:
`07faef56`, `be2ebcf2`, `a8d095d6`, `a17c2135`, `8e2a6819`, `6d79eb49`.
Они закрывают ошибки post-update reconciliation, baseline failure,
глобального размещения bell, мобильной ширины/фокуса, outage episodes,
channel retention, перехода к обновлению, ручного/background check и
тестовых guardrails.

Поэтому 8.8 не должен повторно разбирать эти исправления как отдельную
реализацию. В acceptance matrix добавляется signed-release delivery:
проверить те же свойства после установки prerelease на отдельный стенд,
включая panel/modules/DevTools/generator, 390/1440 px, update navigation,
post-update cleanup, baseline failure без ложных module-new записей,
stale/offline episode и отсутствие archive downloads до явного plan.

## Что ещё не закрыто

Статическая acceptance matrix уже существует в
[`modular-panel-stage8-contract.md`](modular-panel-stage8-contract.md), а
runbooks — в [`modular-panel-stage8-lifecycle-api.md`](modular-panel-stage8-lifecycle-api.md)
и [`modular-panel-stage8-panel-profile.md`](modular-panel-stage8-panel-profile.md).
Нужно расширить доказательства, а не писать recovery engine заново.

Локальные trees/archives, fake transport, runner hooks и browser fixtures не
доказывают весь сценарий на Entware, реальный disk full, power loss, запуск
внешнего proxy core или signed release на конкретном устройстве.

Нужно:

1. Дополнить matrix колонками `failure`, UI/error code, journal/state,
   rollback/restart policy, user action и тестовым доказательством.
2. На отдельном стенде пройти signed prerelease: install/repair/remove, panel
   update, profile transition, interrupted recovery, rollback и offline
   с/без cache; после установки повторить Notification center smoke на
   panel/modules/DevTools/generator и мобильной ширине.
3. Проверить legacy/full, оба minimal и custom профиля, editor variants,
   отключённые модули, отсутствующие optional tools и `min_updater`.
4. После 8.7 оформить stable rollout, legacy-layout migration,
   backup/restore инструкцию и stop/go критерии.
5. Для каждой обязательной строки сохранить device smoke результат,
   checksum конфигураций, версию/архитектуру/профиль и диагностический журнал.

Успешный CI или единичный прогон `install.sh` через PTY не заменяет
эксплуатационный rollout-отчёт.

Эта сверка не запускала fault injection на роутере и не подтверждает выпуск
какого-либо release. Публикация stable выполняется отдельным явным действием.
