# Этап 8: менеджер официальных модулей

**Статус:** подэтапы 8.0–8.6 закрыты; 8.7 имеет готовую основу,
но Notification center и rollout 8.8 не закрыты<br>
**Дата:** 13 октября 2026 года

Этот документ фиксирует implementation contract для Этапа 8. Полный roadmap
остаётся в [`README-modular-panel-plan.md`](../README-modular-panel-plan.md).
Проверяемый baseline ownership, топологии, schema и acceptance matrix находится
в [`modular-panel-stage8-contract.md`](modular-panel-stage8-contract.md).

## Решение

Используем GitHub Releases официального репозитория Xkeen UI как immutable
дистрибутив. Один tagged release содержит подписанный `catalog.json`, единый
архив панели и отдельные self-contained архивы модулей. В core вшит публичный
Ed25519-ключ; catalog и archive проверяются до установки.

Это оставляет текущий единый архив пригодным для bootstrap, обновления core,
смены профиля и полного rollback, но позволяет делать module-only
install/repair/remove без перезаписи остальных. Независимого module update на
новую версию сейчас нет: module package соответствует installed panel release.
JSON в репозитории, GitHub Pages, OCI registry и произвольные repos не входят
в MVP.

## Границы ответственности

| Область | Владелец |
| --- | --- |
| Catalog fetch/cache, trust, version comparison | `core` |
| Package transaction, registry, backup, rollback | `core` + внешний supervisor |
| Installed/available modules, plan/apply/status API | `core` |
| Maintenance UI, notifications, operation log | `core` UI |
| Profile transitions | installer + `POST /api/modules/profile` |
| Advanced diagnostics | только опциональные сведения |

Core не должен выполнять установку внутри Flask request thread. Операцию ведёт
отдельный процесс `scripts/module_transaction.py`: он проверяет HTTP health
после рестарта и возвращает прежние файлы, если новый payload не запускается.
Операцию, прерванную обрывом питания, отменяет init-скрипт перед стартом
панели.

## Артефакты release

```text
catalog.json
catalog.json.sha256
release-metadata.json
xkeen-ui-panel-<version>.tar.gz
xkeen-ui-panel-<version>.tar.gz.sha256
xkeen-module-<module-id>-<version>.tar.gz
xkeen-module-<module-id>-<version>.tar.gz.sha256
```

Сборщик `scripts/build_modular_panel_release.py` создаёт этот набор из
фиксированных `version`, `SOURCE_DATE_EPOCH` и source commit. USTAR/gzip
метаданные нормализуются: POSIX-сортировка путей, uid/gid `0`, пустые owner
names и фиксированный mtime. `release-2026` в 8.1 — согласованный trust id;
Ed25519-подпись и `catalog.json.sig` остаются границей 8.2.

Module archive имеет ровно два логических уровня: `module-manifest.json` и
`payload/<ownership-path>`. State/user paths, bootstrap hooks и локальные
бинарники не входят в module assets. Panel asset сохраняет `install.sh`,
`uninstall.sh` и legacy runtime для bootstrap.

Минимальная запись каталога:

```json
{
  "id": "tool.files",
  "version": "1.0.0",
  "channel": "stable",
  "panel_api": "1",
  "module_api": "1",
  "min_core": "1.0.0",
  "architectures": ["armv7", "aarch64"],
  "requires": ["core"],
  "conflicts": [],
  "requires_restart": true,
  "archive": "xkeen-module-tool.files-1.0.0.tar.gz",
  "size": 123456,
  "sha256": "...",
  "signing_key_id": "release-2026"
}
```

Внутри архива обязательны `schema_version`, module manifest и path ownership
allow-list. Абсолютные пути, `..`, symlink escape и файлы, принадлежащие core
или другому модулю, являются ошибкой до распаковки.

## Три операции обновления

### Module-only

`GET catalog -> plan -> stage -> verify -> apply -> state -> restart ->
health -> commit/rollback`.

Операция меняет только файлы модуля из его manifest и state-файлы. Файлы
лежат в общем корне панели и заменяются под журналом с копией прежних; она не
перезаписывает конфигурацию пользователя, другие модули или ядра. Модуль
ставится из релиза той же версии, что и панель (решения Этапа 8.3 — в
`docs/superpowers/specs/2026-10-05-modular-panel-stage8-3-transaction-engine-design.md`).

### Panel update

Единый signed panel archive обновляет весь managed payload текущего профиля.
Lifecycle plan требует строго более новую версию выбранного официального
канала (`stable`/`prerelease`); apply повторно
проверяет catalog, descriptor, archive и plan digest. До замены journal
сохраняет каждый затрагиваемый файл и state. После health-check фиксируются
новая версия и target ownership либо выполняется полный rollback scope
`panel`. Профиль, Custom module set, editor variant, конфигурации и
enabled/disabled state сохраняются.

### Profile transition

`POST /api/modules/profile` сохраняет желаемый registry state и сообщает
`transition_required`/`transition_target`. Переход может добавить и удалить
несколько модулей, поэтому выполняется отдельной full-scope транзакцией
`profile-transition` на текущей версии release с diff, проверкой места,
journal, restart и health. Пока physical payload не совпадает с желаемым,
restart блокируется `profile_transition_required`. Нельзя маскировать переход
как module-only update.

## Уведомления

**Текущее состояние:** verified catalog cache с TTL 24 часа, ручной
panel update-check, update note и per-tab panel badge уже есть. TTL не
запускает scheduler.

**Осталось в 8.7:** core-owned daily poll, общий список уведомлений,
`seen/dismissed/snoozed`, deduplication по типу/module/version/channel,
multi-tab/channel reconciliation и module-asset notifications. `/available`
читает exact-release catalog и поддерживает install/repair/remove, а не
независимый module update. Ни poll, ни notification не должны скачивать
archive; явный plan может проверить archive, Apply запускает изменение.

## Подэтапы и контрольные точки

1. **8.0 Contracts:** ownership, topology, schema, compatibility и acceptance matrix.
2. **8.1 Artifacts:** закрыт; deterministic module/panel archives, catalog generation и CI release assets.
3. **8.2 Trust:** закрыт; allow-list, signatures, key rotation, cache/offline policy.
4. **8.3 Updater:** закрыт; preflight, safe unpack, backup, journal, detached runner и rollback.
5. **8.4 API:** закрыт; list/plan/apply/status/cancel/recovery/restart и operation log. Контракт: [`modular-panel-stage8-lifecycle-api.md`](modular-panel-stage8-lifecycle-api.md).
6. **8.5 Panel/profile:** закрыт; signed panel update, physical profile transition и scoped rollback. Контракт: [`modular-panel-stage8-panel-profile.md`](modular-panel-stage8-panel-profile.md).
7. **8.6 UI:** закрыт 13 октября 2026 года; core-owned `/modules` реализует installed/available, update badge, dependency diff, progress, recovery и restart. Контракт: [`modular-panel-stage8-manager-ui.md`](modular-panel-stage8-manager-ui.md).
8. **8.7 Notifications:** не закрыт; catalog/check/badge готовы, daily poll и notification state/UI отсутствуют.
9. **8.8 Recovery:** не закрыт; failure matrix/runbooks и автоматическое покрытие развиты, но сводный signed prerelease/device acceptance и stable rollout не подтверждены отчётом.

Каждая контрольная точка должна иметь тесты и ручной recovery сценарий до
перехода к следующей. Marketplace, arbitrary repos, delta updates и scripts
намеренно не входят в критерий MVP.

## Acceptance checklist — automatic vs rollout evidence

Наличие автоматического теста не означает подписанную device/rollout-приёмку.
Источники покрытия и оставшаяся matrix:
[`modular-panel-remaining-stages-audit.md`](modular-panel-remaining-stages-audit.md).

- [x] каталог с неизвестным ключом, изменённым checksum или неподдерживаемым API отклонён;
- [x] module-only install/repair/remove изменяют только выбранный модуль и state;
- [x] panel update сохраняет profile/config/state;
- [x] profile transition использует отдельный transaction path;
- [x] crash после restart автоматически возвращает предыдущую версию;
- [x] transport-only offline fallback использует проверенный кэш и не блокирует installed state;
- [ ] новая версия модуля даёт одно dismissible уведомление;
- [x] архив с traversal/symlink/script hook не устанавливается;
- [ ] core-owned Notification center сохраняет local notification state без archive download;
- [ ] signed prerelease/device matrix и stable rollout подтверждены отчётом.

Для локального воспроизводимого прогона:

```powershell
python .\scripts\build_modular_panel_release.py --root . --output-dir dist\modular-panel --version 1.0.0 --source-date-epoch 1700000000 --source-commit test-commit
```
