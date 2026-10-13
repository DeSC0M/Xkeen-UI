# Подэтап 8.7: Notification center

**Статус:** частично реализована основа; подэтап не закрыт.

## Что уже есть в коде

- `ModuleCatalogClient` сохраняет только проверенный signed catalog.
- Stable и prerelease используют отдельные persisted channel state и cache-файлы.
- Обычный cache TTL — 24 часа; forced refresh ограничен минимальным интервалом
  5 минут.
- При transport failure используется проверенный stale snapshot с
  `freshness`, `stale_reason` и `fetched_at`.
- `POST /api/modules/panel/update-check` возвращает
  `update_available`, `requires_installer`, `freshness` и timestamp без
  загрузки panel archive.
- `/modules` показывает ответ ручной проверки, DevTools — update note при
  открытии карточки через cached catalog. Обе поверхности не заменяют poll.
- `features/module_manager/badge.js` хранит per-tab panel-update hint в
  `sessionStorage` и очищает его после актуального состояния/успешной операции.
- Архив не скачивается до явного server plan/apply. Сам plan может выполнить
  необходимые verified archive checks; запрет «до Apply» не соответствует
  текущему lifecycle contract.

Ручная проверка в `/modules` относится к panel update. `/available` читает
каталог установленного release и возвращает `update_available=false`;
поддерживаемые module-only операции — install/repair/remove. Это не daily
module discovery и не независимый module update.

## Что это не покрывает

TTL каталога — это срок годности ответа при запросе, а не ежедневный
background scheduler. Per-tab badge — это hint об обновлении панели, а не
история уведомлений.

В коде пока нет:

- core-owned notification center или общего списка уведомлений;
- daily poll, независимого от открытия DevTools или `/modules`;
- единой ручной проверки панели и модулей;
- уведомлений о новых module assets с размером, dependency diff и
  restart requirement;
- локальных `seen/dismissed/snoozed` записей;
- deduplication по типу, `module_id`/panel, версии и каналу;
- общей UI-модели stale/error с retry/dismiss действиями;
- гарантии, что смена канала не оставляет hint от другого канала.

## Условие закрытия

Нужны core-owned poll/state/UI, тесты reload/restart, нескольких вкладок,
смены канала, deduplication, local state и offline/stale/error. Poll и
показ уведомления не должны скачивать архив без явного действия пользователя.

Не добавлять второй updater или произвольный URL. Для module asset из нового
release сначала показывать совместимость/необходимость panel update, а не
обещать установку неизвестного registry id.

Источники и уровни покрытия:
[`modular-panel-remaining-stages-audit.md`](modular-panel-remaining-stages-audit.md).
