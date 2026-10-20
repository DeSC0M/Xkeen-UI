"""Служебные данные панели файловый менеджер показывает, но не меняет.

По журналам подписок, DNS-over-VLESS, DNS Mihomo и операций с модулями панель
возвращает владельцу настройки. Испорченный правкой журнал молча не сработает
ровно тогда, когда нужен, поэтому закрыты не только удаление и переименование,
но и правка в редакторе, создание файлов, права и распаковка поверх.
"""

from __future__ import annotations

import importlib
import io
import os
import tarfile
from pathlib import Path

import pytest
from flask import Flask

from services import dns_over_vless, mihomo_dns, panel_service_data, xray_subscriptions
from services.fs_common import local
from services.module_profile_plan import STATE_FILENAMES
from services.module_transactions.previous_version import previous_version_root
from services.module_transactions.state import transactions_root


def _norm(path) -> str:
    return os.path.normcase(os.path.normpath(str(path)))


@pytest.fixture
def panel(tmp_path: Path, monkeypatch):
    state = tmp_path / "opt" / "etc" / "xkeen-ui"
    tx = state / "dns-over-vless" / "transactions" / "20261020-1"
    tx.mkdir(parents=True)
    (tx / "manifest.json").write_text('{"ok": 1}', encoding="utf-8")
    (state / "dns_over_vless.json").write_text('{"enabled": true}', encoding="utf-8")
    (state / "xray_subscriptions.json").write_text("{}", encoding="utf-8")
    (state / "modules.json").write_text("{}", encoding="utf-8")
    (state / "notes.txt").write_text("mine", encoding="utf-8")
    (tmp_path / "opt" / "etc" / "xkeen-ui.module-transactions" / "op-1").mkdir(parents=True)

    saved = dict(local._PANEL_PROTECTED)
    local._PANEL_PROTECTED.clear()
    panel_service_data.register_panel_data_protection(str(state))

    monkeypatch.setenv("XKEEN_LOCALFM_ROOTS", str(tmp_path))
    blueprint = importlib.reload(importlib.import_module("routes.fs.blueprint"))
    tmp_dir = tmp_path / "fm-tmp"
    tmp_dir.mkdir()
    app = Flask("panel-data-protection-test")
    app.register_blueprint(blueprint.create_fs_blueprint(tmp_dir=str(tmp_dir), max_upload_mb=1))
    yield state, app.test_client()
    local._PANEL_PROTECTED.clear()
    local._PANEL_PROTECTED.update(saved)


# --- что считается служебным -----------------------------------------------------------


def test_the_list_names_what_each_owner_keeps(tmp_path: Path):
    root = tmp_path / "xkeen-ui"
    listed = {(_norm(path), subtree) for path, subtree in panel_service_data.protected_panel_paths(str(root))}

    owners = list(xray_subscriptions.protected_state_paths(str(root)))
    owners += [
        (dns_over_vless._state_path(str(root)), False),
        (os.path.dirname(dns_over_vless._transactions_dir(str(root))), True),
        (mihomo_dns._state_dir(str(root), "/opt/etc/mihomo/config.yaml"), True),
        (transactions_root(root), True),
        (previous_version_root(root), True),
    ]
    owners += [(root / name, False) for name in STATE_FILENAMES]
    for path, subtree in owners:
        assert (_norm(path), subtree) in listed, path


def test_the_panel_root_takes_own_files_but_never_loses_panel_data(panel, tmp_path: Path):
    state, _client = panel

    # В корень панели класть своё можно; удалить его нельзя.
    assert not local.local_is_panel_data_entry(str(state))
    assert local._local_is_panel_data_abs(str(state))
    assert local.local_is_panel_data_entry(str(state / "dns_over_vless.json"))
    assert local.local_is_panel_data_entry(str(state / "dns-over-vless"))
    assert local.local_is_panel_data_entry(str(state / "dns-over-vless" / "new" / "x.json"))
    assert not local.local_is_panel_data_entry(str(state / "dns-over-vless-notes.txt"))
    assert not local.local_is_panel_data_entry(str(tmp_path / "opt" / "etc"))


def _second_path_to(folder: Path, alias: Path) -> None:
    """Ещё один путь к тем же файлам, как /tmp/mnt/<uuid> рядом с /opt на Keenetic."""
    if os.name == "nt":
        import _winapi

        _winapi.CreateJunction(str(folder), str(alias))
    else:
        alias.symlink_to(folder, target_is_directory=True)


def test_panel_data_reached_by_another_mount_path_is_protected_the_same(panel, tmp_path: Path):
    state, client = panel
    alias = tmp_path / "mnt-label"
    _second_path_to(tmp_path / "opt", alias)
    other = alias / "etc" / "xkeen-ui"

    assert local.local_is_panel_data_entry(str(other / "dns_over_vless.json"))
    assert local.local_is_panel_data_entry(str(other / "dns-over-vless" / "transactions" / "20261020-1"))
    assert local.local_is_panel_data_entry(str(other / "dns-over-vless" / "new.json"))
    assert local._local_is_panel_data_abs(str(other))
    assert local._local_is_panel_data_abs(str(alias / "etc"))
    assert not local.local_is_panel_data_entry(str(other / "notes.txt"))
    assert not local._local_is_panel_data_abs(str(other / "notes.txt"))

    with pytest.raises(PermissionError):
        local._local_soft_delete(str(other / "dns-over-vless"), [str(tmp_path)], hard=True)
    assert (state / "dns-over-vless").is_dir()
    response = client.post("/api/fs/write", json={
        "target": "local", "path": str(other / "dns_over_vless.json"), "text": "broken", "dry_run": True,
    })
    assert response.status_code == 403
    assert (state / "dns_over_vless.json").read_text(encoding="utf-8") == '{"enabled": true}'


# --- правка, создание, права ----------------------------------------------------------


def test_the_editor_shows_panel_data_but_cannot_save_it(panel):
    state, client = panel
    journal = state / "dns-over-vless" / "transactions" / "20261020-1" / "manifest.json"

    read = client.get(f"/api/fs/read?target=local&path={journal}").get_json()
    assert read["ok"] is True and read["protected"] is True and read["text"] == '{"ok": 1}'

    for path in (journal, state / "dns_over_vless.json", state / "xray_subscriptions.json", state / "modules.json"):
        before = path.read_text(encoding="utf-8")
        response = client.post("/api/fs/write", json={"target": "local", "path": str(path), "text": "broken"})
        assert response.status_code == 403, path
        assert response.get_json()["error"] == local.PROTECTED_PANEL_DATA_MESSAGE
        assert path.read_text(encoding="utf-8") == before


def test_own_files_next_to_panel_data_are_edited_as_before(panel):
    state, client = panel

    read = client.get(f"/api/fs/read?target=local&path={state / 'notes.txt'}").get_json()
    assert read["protected"] is False
    response = client.post("/api/fs/write", json={"target": "local", "path": str(state / "notes.txt"), "text": "new"})
    assert response.status_code == 200
    assert (state / "notes.txt").read_text(encoding="utf-8") == "new"
    assert client.post("/api/fs/touch", json={"target": "local", "path": str(state / "more.txt")}).status_code == 200
    assert client.post("/api/fs/mkdir", json={"target": "local", "path": str(state / "mine")}).status_code == 200


def test_nothing_new_appears_inside_panel_data(panel, tmp_path: Path):
    state, client = panel
    inside = state / "dns-over-vless" / "transactions"
    beside = tmp_path / "opt" / "etc" / "xkeen-ui.module-transactions" / "op-1"

    for folder in (inside, beside, state / "mihomo-dns"):
        assert client.post("/api/fs/touch", json={"target": "local", "path": str(folder / "x.json")}).status_code == 403
        assert client.post("/api/fs/mkdir", json={"target": "local", "path": str(folder / "x"), "parents": True}).status_code == 403
        assert not (folder / "x.json").exists() and not (folder / "x").exists()


def test_permissions_of_panel_data_stay_as_the_panel_set_them(panel):
    state, client = panel
    for route, body in (("/api/fs/chmod", {"mode": "600"}), ("/api/fs/chown", {"uid": 0, "gid": 0})):
        response = client.post(route, json={"target": "local", "path": str(state / "dns_over_vless.json"), **body})
        assert response.status_code == 403, route
        assert response.get_json()["error"] == local.PROTECTED_PANEL_DATA_MESSAGE


# --- архивы ---------------------------------------------------------------------------

# Архивные операции склеивают пути как POSIX (/opt/...): на Windows их не построить,
# проверяет CI на Linux -- как на роутере.
posix_paths = pytest.mark.skipif(os.name == "nt", reason="archive endpoints take POSIX paths")


def _tar(path: Path, members: dict[str, bytes]) -> None:
    with tarfile.open(path, "w:gz") as tf:
        for name, body in members.items():
            info = tarfile.TarInfo(name)
            info.size = len(body)
            tf.addfile(info, io.BytesIO(body))


@posix_paths
def test_extracting_over_the_panel_skips_its_data_and_keeps_the_rest(panel, tmp_path: Path):
    state, client = panel
    archive = tmp_path / "pack.tar.gz"
    _tar(archive, {
        "dns_over_vless.json": b"broken",
        "dns-over-vless/transactions/20261020-1/manifest.json": b"broken",
        "mine.txt": b"mine",
    })

    response = client.post("/api/fs/archive/extract", json={
        "target": "local", "archive": str(archive), "cwd": str(state), "overwrite": True,
    })

    assert response.status_code == 200, response.get_json()
    payload = response.get_json()
    assert payload["extracted"] == 1 and payload["skipped"] == 2
    assert (state / "mine.txt").read_bytes() == b"mine"
    assert (state / "dns_over_vless.json").read_text(encoding="utf-8") == '{"enabled": true}'
    journal = state / "dns-over-vless" / "transactions" / "20261020-1"
    assert sorted(p.name for p in journal.iterdir()) == ["manifest.json"]
    assert (journal / "manifest.json").read_text(encoding="utf-8") == '{"ok": 1}'


@posix_paths
def test_an_archive_cannot_be_unpacked_into_or_written_inside_panel_data(panel, tmp_path: Path):
    state, client = panel
    archive = tmp_path / "pack.tar.gz"
    _tar(archive, {"x.txt": b"x"})
    inside = state / "dns-over-vless" / "transactions"

    unpack = client.post("/api/fs/archive/extract", json={"target": "local", "archive": str(archive), "cwd": str(inside)})
    assert unpack.status_code == 403
    assert unpack.get_json()["error"] == local.PROTECTED_PANEL_DATA_MESSAGE
    create = client.post("/api/fs/archive/create", json={
        "target": "local", "cwd": str(inside), "items": [str(state / "notes.txt")], "name": "a", "format": "tar.gz",
    })
    assert create.status_code == 403
    assert create.get_json()["error"] == local.PROTECTED_PANEL_DATA_MESSAGE
    assert sorted(p.name for p in inside.iterdir()) == ["20261020-1"]


# --- удаление, как и прежде ------------------------------------------------------------


def test_new_panel_data_cannot_be_deleted_either(panel, tmp_path: Path):
    state, _client = panel
    for path in (
        state / "dns-over-vless" / "transactions" / "20261020-1",
        state / "dns-over-vless",
        state / "modules.json",
        tmp_path / "opt" / "etc" / "xkeen-ui.module-transactions",
    ):
        with pytest.raises(PermissionError):
            local._local_soft_delete(str(path), [str(tmp_path)], hard=True)
        assert path.exists(), path
