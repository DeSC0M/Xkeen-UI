"""Локальная сборка обновляется до выпуска сама, но модули ставит только выпуск.

Сборщик штампует локальный архив версией выпуска, от которого он вырос, и
пометкой сборки: ``2.10.0+local.f46f1f10``. Метаданные после «+» в сравнении
версий не участвуют, поэтому панель считает себя этим выпуском и находит
следующий. Пакеты модулей в релизе собраны под точную версию, а код
локальной сборки может от неё отличаться: ставить, чинить и удалять модули
и переходить на другой набор она не берётся.
"""

from __future__ import annotations

import pytest

from services.module_lifecycle import ModuleLifecycleError
from services.module_transactions.plan import is_local_build
from tests.support.module_lifecycle import make_service
from tests.support.module_tx import make_panel, make_release

LOCAL = "2.10.0+local.f46f1f10"


@pytest.mark.parametrize(
    ("version", "local"),
    [(LOCAL, True), ("2.10.0-beta.2+local.f46f1f10.dirty", True), ("2.10.0", False), ("2.10.0-beta.2", False)],
)
def test_build_metadata_marks_a_local_build(version, local):
    assert is_local_build(version) is local


def test_installed_reports_a_local_build_that_can_update_but_not_change_modules(tmp_path):
    service, _ = make_service(make_panel(tmp_path, version=LOCAL), make_release())

    payload = service.installed()

    assert payload["panel_version"] == LOCAL
    assert payload["lifecycle"] == {"available": True, "code": None, "local": True}
    assert all(item["lifecycle_actions"] == [] for item in payload["modules"])


def test_a_local_build_finds_the_next_release(tmp_path):
    service, _ = make_service(make_panel(tmp_path, version=LOCAL), make_release(version="2.11.0"))

    result = service.panel_update_check()

    assert (result["source_version"], result["target_version"], result["update_available"]) == (
        LOCAL, "2.11.0", True,
    )


def test_a_local_build_counts_as_the_release_it_grew_from(tmp_path):
    service, _ = make_service(make_panel(tmp_path, version=LOCAL), make_release(version="2.10.0"))

    assert service.panel_update_check()["update_available"] is False


def test_a_local_build_plans_the_panel_update(tmp_path):
    service, _ = make_service(make_panel(tmp_path, version=LOCAL), make_release(version="2.11.0"))

    payload = service.plan("panel-update", None)

    assert payload["applicable"] is True
    assert payload["target_version"] == "2.11.0"


@pytest.mark.parametrize(
    "call",
    [
        lambda service: service.available(),
        lambda service: service.plan("install", "tool.files"),
        lambda service: service.plan("profile-transition", None),
    ],
)
def test_a_local_build_does_not_change_modules(tmp_path, call):
    service, catalog = make_service(make_panel(tmp_path, version=LOCAL), make_release())

    with pytest.raises(ModuleLifecycleError) as raised:
        call(service)

    assert raised.value.code == "panel_version_local"
    assert raised.value.status == 409
    assert catalog.requested_versions == []
