# Стендовые прогоны панели на реальном роутере

Этот набор отделяет безопасный UI-smoke от переустановки ядра:

- `smoke` выполняет read-only preflight по panel API и SSH, а в изолированном
  Playwright Chromium открывает управление Mihomo и выбор источника. Он не
  нажимает «Установить», не меняет профиль и не перезапускает сервис.
- `core-install` действительно переустанавливает активную сборку Mihomo и
  проверяет terminal-состояние модала. Он намеренно заблокирован по умолчанию.

## Однократная настройка рабочего места

1. Скопировать
   [`router-e2e.env.example`](../.secrets/router-e2e.env.example) в
   `.secrets/router-e2e.env`.
2. Вписать учётные данные панели и SSH. Файл с реальными секретами игнорируется
   Git и не должен отправляться в чат, коммиты или CI-логи.
3. Оставить `XKEEN_ROUTER_E2E_ALLOW_DESTRUCTIVE=0`.
4. Установить Chromium для Playwright, если он ещё не установлен:

   ```powershell
   npx playwright install chromium
   ```

Раннер запускает новый изолированный браузер Playwright, а не управляет
открытым пользователем окном Edge. Поэтому ему известен точный URL панели,
нет чужих вкладок, расширений и неоднозначности активной вкладки.

## Обычный прогон

Из корня репозитория:

```powershell
.\scripts\run_router_panel_e2e.ps1
```

или:

```powershell
.\scripts\run_router_panel_e2e.ps1 -Mode smoke
```

В `.tmp/router-e2e/<дата-время>/router-preflight.json` остаётся redacted
отчёт о версии панели, профиле, модулях, диске, процессах и результатах
доступа. Playwright при ошибке сохраняет trace и screenshot в стандартных
`test-results/` и `playwright-report/`.

## Переустановка ядра

Допускается **только** на отдельном disposable-роутере, не обслуживающем
пользовательский трафик. Перед запуском оператор вручную:

1. создаёт резервную копию;
2. подтверждает, что роутер — именно тестовый стенд;
3. задаёт непустое имя в `XKEEN_ROUTER_E2E_STAND_NAME`;
4. временно меняет `XKEEN_ROUTER_E2E_ALLOW_DESTRUCTIVE=1`.

После этого:

```powershell
.\scripts\run_router_panel_e2e.ps1 -Mode core-install
```

Сценарий проверяет `100%`, «Установка завершена», отсутствие `is-working` и
`aria-busy`, корректную подсказку «Закрыть окно установки» и закрытие модала.
Сразу после прогона вернуть `XKEEN_ROUTER_E2E_ALLOW_DESTRUCTIVE=0`.

## CI

Не хранить router credentials в репозитории. Добавить их в защищённые secrets
конкретного self-hosted runner, подключённого к тестовой сети. Для CI оставить
только `smoke` по расписанию; `core-install` — manual job с environment
protection и отдельным явным approval.
