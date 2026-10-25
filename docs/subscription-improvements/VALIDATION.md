# Результаты проверок

25 октября 2026. База: v3.0.2 / afefd60. Рабочая ветка: feat/xray-subscription-scheduling-performance.

- 274 Python-теста прошли, 2 POSIX DST-теста пропущены на Windows.
- 31 браузерный тест Chromium прошёл (subscription_improvements, subscriptions_modal_form, subscriptions_modal_layout).
- Сценарии изображений «до» прошли на отдельном checkout исходной версии.
- frontend:build, verify_frontend_build.mjs, node --check и проверка ошибок Python прошли.
- git diff --check прошёл.

Python: 3.12, Chromium for Testing: 147. Локальный браузерный стенд использовал изолированное тестовое состояние и threaded Werkzeug: стандартный запуск gevent в этой Windows-песочнице завершался после начального входа. Это не проверка производственного gevent на роутере.

## Воспроизводимые команды

```text
python -m pytest tests/test_subscription_improvements.py tests/test_xray_subscriptions.py tests/test_xray_subscriptions_routes.py tests/test_subscription_schedule_alignment.py tests/test_subscription_align_routes.py tests/test_subscription_align_frontend_contract.py tests/test_xray_subscription_filters_contract.py tests/test_xray_subscriptions_pause.py tests/test_xray_subscription_request_profiles.py tests/test_xray_subscription_dns_route_follow.py tests/test_xray_subscription_displacement.py tests/test_xray_subscriptions_displaced_flow.py tests/test_xray_subscription_panel_owned_balancers.py tests/test_xray_subscriptions_rollback.py tests/test_xray_subscriptions_pause_routes.py tests/test_xray_subscriptions_first_download.py tests/test_modular_panel_stage0_inventory.py -q
npm run frontend:build
node scripts/verify_frontend_build.mjs
npx playwright test e2e/subscription_improvements.spec.mjs e2e/subscriptions_modal_form.spec.mjs e2e/subscriptions_modal_layout.spec.mjs --workers=1
python scripts/benchmark_xray_subscription_payload.py
```

Для повторения изображений исходной версии направить E2E_BASE_URL на изолированный стенд v3.0.2, задать XKEEN_SCREENSHOT_LABEL=before и выполнить subscription_improvements.spec.mjs. Для изменённой версии — XKEEN_SCREENSHOT_LABEL=after. Тест сохраняет семь изображений в docs/subscription-improvements/images.

Данные benchmark.json синтетические: 100/1000/5000 узлов суммарно на 1/10/50 подписок. Проверяется компактный ответ API, без сети и загрузок провайдеров. Изображения сняты на обезличенных данных; подписки домашнего роутера не публикуются.

## Ещё не выполнено

- Установка и аппаратное испытание изменённой версии на Keenetic Ultra.
- Полный upstream CI.
- Создание PR: ожидает согласования пользователем готового описания и семи изображений.


## Проверка обновлённой компоновки расписания

Повторно прошли три сценария subscription_improvements.spec.mjs. Проверены взаимное скрытие полей, доступность ввода часов, расположение активного поля рядом с режимом на desktop и cron на ширине 390 px, сохранение и ошибки. Сборка и проверка frontend повторно проходят. Скриншоты «После» обновлены.
