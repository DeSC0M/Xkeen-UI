from __future__ import annotations

import importlib
import os
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
APP_DIR = ROOT / "xkeen-ui"

if str(APP_DIR) not in sys.path:
    sys.path.insert(0, str(APP_DIR))


# Файлы, на которые уходит около 70 % времени всего набора: они собирают
# настоящий релиз, разворачивают настоящее дерево панели или гоняют сценарии
# установщика через оболочку. Быстрый набор — `-m "not slow"` — идёт без них;
# полный прогон нужен перед пушем. Список снят с `--junitxml` полного прогона:
# сюда попадают файлы, занимающие в сумме больше десятка секунд.
SLOW_TEST_FILES = frozenset(
    {
        "test_addons_refresh_on_update",
        "test_backup_monitor_script",
        "test_build_user_archive_ownership_map",
        "test_entware_backup_script",
        "test_install_progress_no_tearing",
        "test_install_progress_ui",
        "test_installer_profile_frontend_closure",
        "test_installer_profiles",
        "test_mihomo_clash_client",
        "test_modular_panel_ownership_map",
        "test_modular_panel_release_builder",
        "test_modular_panel_stage0_inventory",
        "test_modular_panel_stage4_5_composition",
        "test_module_packages_over_installer_profiles",
        "test_module_transactions_cli",
        "test_module_transactions_install_state",
        "test_module_transactions_real_tree",
        "test_operator_icons",
        "test_panel_operator_stage0_contract",
        "test_panel_update_real_tree",
        "test_provision_build_json",
        "test_provision_opkg",
        "test_provision_packages",
        "test_provision_python_libs",
        "test_uninstall_is_clean",
        "test_version_check_script",
    }
)


# Файлы, которые меряют настоящее время: ждут таймаутов оболочки, считают
# кадры таймера за секунды, укладывают проверку ядра в окно в десятую секунды,
# сравнивают скорость двух разборов. Рядом с полутора десятками занятых потоков такие
# проверки падают без всякой поломки, поэтому параллельный прогон идёт без них
# (`-m "not timing"`), а они — отдельным проходом, по потоку на файл (`-n 4 -m timing`).
TIMING_TEST_FILES = frozenset(
    {
        "test_core_installer",
        "test_install_progress_no_tearing",
        "test_install_progress_ui",
        "test_jsonc_stripping",
        "test_provision_opkg",
    }
)


# Параллельный прогон раздаёт потокам файлы целиком (`--dist loadfile`), так что
# быстрее самого долгого файла он не закончится. Тесты этих файлов друг от друга
# не зависят и общих фикстур на файл не держат, поэтому раздаются поштучно.
# Файл с фикстурой уровня модуля сюда вносить нельзя: её соберёт каждый поток.
# Два файла `real_tree` здесь потому, что их общий релиз собирается один раз на
# все потоки (фикстура `built`).
SPLIT_TEST_FILES = frozenset(
    {
        "test_installer_profiles",
        "test_modular_panel_ownership_map",
        "test_modular_panel_release_builder",
        "test_module_transactions_cli",
        "test_module_transactions_install_state",
        "test_module_transactions_real_tree",
        "test_panel_update_real_tree",
        "test_uninstall_is_clean",
    }
)


def _platform_supports_full_app() -> bool:
    return not sys.platform.startswith("win")


def pytest_configure(config):
    config.addinivalue_line(
        "markers",
        "linux_only: test requires Unix-only modules such as pty/termios and is skipped on Windows",
    )
    config.addinivalue_line(
        "markers",
        "slow: test belongs to a heavy file listed in SLOW_TEST_FILES; deselect with -m 'not slow'",
    )
    config.addinivalue_line(
        "markers",
        "timing: test measures real time (TIMING_TEST_FILES) and must not share the CPU with a parallel run",
    )


@pytest.hookimpl(optionalhook=True)
def pytest_xdist_make_scheduler(config, log):
    if config.getvalue("dist") != "loadfile":
        return None
    from xdist.scheduler import LoadFileScheduling

    class SplitHeavyFiles(LoadFileScheduling):
        def _split_scope(self, nodeid: str) -> str:
            path = nodeid.split("::", 1)[0]
            return nodeid if Path(path).stem in SPLIT_TEST_FILES else path

    return SplitHeavyFiles(config, log)


def pytest_collection_modifyitems(config, items):
    for item in items:
        if item.path.stem in SLOW_TEST_FILES:
            item.add_marker(pytest.mark.slow)
        if item.path.stem in TIMING_TEST_FILES:
            item.add_marker(pytest.mark.timing)

    if _platform_supports_full_app():
        return

    skip_linux_only = pytest.mark.skip(reason="Requires Unix-only modules (pty/termios); skipped on Windows.")
    for item in items:
        if "linux_only" in item.keywords:
            item.add_marker(skip_linux_only)


@pytest.fixture(autouse=True)
def _private_update_dir(tmp_path_factory, monkeypatch):
    # Каталог обновления по умолчанию общий на всю машину (`/opt/var/...`), а в
    # нём лежит блокировка операций. Тесты, идущие одновременно, отбирали бы её
    # друг у друга и получали «операция уже выполняется».
    monkeypatch.setenv("XKEEN_UI_UPDATE_DIR", str(tmp_path_factory.mktemp("update")))


@pytest.fixture
def isolated_runtime_env(tmp_path, monkeypatch):
    home_dir = tmp_path / "home"
    xdg_dir = tmp_path / "xdg"
    state_dir = tmp_path / "state"
    log_dir = tmp_path / "logs"

    for path in (home_dir, xdg_dir, state_dir, log_dir):
        path.mkdir(parents=True, exist_ok=True)

    monkeypatch.setenv("HOME", str(home_dir))
    monkeypatch.setenv("USERPROFILE", str(home_dir))
    monkeypatch.setenv("XDG_CONFIG_HOME", str(xdg_dir))
    monkeypatch.setenv("XKEEN_UI_STATE_DIR", str(state_dir))
    monkeypatch.setenv("XKEEN_LOG_DIR", str(log_dir))
    monkeypatch.setenv("XKEEN_UI_SECRET_KEY", "test-secret-key")
    monkeypatch.setenv("PYTHONPATH", str(APP_DIR))

    return {
        "home_dir": home_dir,
        "xdg_dir": xdg_dir,
        "state_dir": state_dir,
        "log_dir": log_dir,
    }


@pytest.fixture
def panel_source_root(tmp_path) -> Path:
    """Copy the Git-visible panel source without local router runtime state."""

    result = subprocess.run(
        ["git", "ls-files", "--cached", "--others", "--exclude-standard", "-z", "--", "xkeen-ui"],
        cwd=ROOT,
        capture_output=True,
        check=False,
    )
    if result.returncode != 0:
        raise RuntimeError("cannot list the Git-visible panel source")

    destination_root = tmp_path / "panel-source"
    for raw_path in result.stdout.split(b"\0"):
        if not raw_path:
            continue
        relative = Path(raw_path.decode("utf-8", errors="surrogateescape"))
        source = ROOT / relative
        if source.is_symlink():
            target = os.readlink(source)
            destination = destination_root / relative
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.symlink_to(target)
        elif source.is_file():
            destination = destination_root / relative
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source, destination)
    return destination_root


@pytest.fixture
def app_client(isolated_runtime_env):
    if not _platform_supports_full_app():
        pytest.skip("Full Flask app startup requires Unix-only modules (pty/termios).")

    app_factory = importlib.import_module("app_factory")
    app = app_factory.create_app(ws_runtime=False)
    app.config["TESTING"] = True
    return app.test_client()
