# Подэтап 8.8: recovery matrix и rollout

**Статус:** recovery engine и большая часть автоматических проверок готовы;
сводная эксплуатационная приёмка и rollout не закрыты.

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
   с/без cache.
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
