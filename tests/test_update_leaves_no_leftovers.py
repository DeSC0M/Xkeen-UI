"""Обновление панели не должно оставлять за собой копий и временных каталогов.

Уборка 25.09.2026 на 45.1, 10.1 и 20.1 нашла два источника мусора:

- резервные копии встроенных шаблонов `*.dist-*`: 88–128 штук, но всего три
  разных версии. Локальный архив, собранный на Windows, везёт шаблоны с CRLF,
  релизный из CI — с LF. При смене источника установщик видел «изменённый»
  шаблон и откладывал копию, хотя отличались только переводы строк;
- каталоги `/tmp/xkeen-ui-update.*` по одному на каждое обновление: их
  оставлял прежний скрипт обновления, он удалён вместе со своими проверками.
"""

from __future__ import annotations

import os
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
INSTALLER = ROOT / "xkeen-ui" / "install.sh"
PROVISION = ROOT / "xkeen-ui" / "scripts" / "provision_env.sh"
SH = shutil.which("sh")

pytestmark = pytest.mark.skipif(SH is None, reason="нужен POSIX sh")


def _function(script: Path, name: str) -> str:
    text = script.read_text(encoding="utf-8")
    start = text.index(f"\n{name}() {{\n") + 1
    end = text.index("\n}\n", start) + 3
    return text[start:end]


def _sh(code: str, cwd: Path) -> subprocess.CompletedProcess:
    return subprocess.run([SH, "-c", code], cwd=str(cwd), capture_output=True, text=True, encoding="utf-8")


# --- Шаблоны ----------------------------------------------------------------


def _sync(tmp_path: Path, bundled: bytes, installed: bytes | None) -> tuple[Path, list[Path], str]:
    src = tmp_path / "src"
    dest = tmp_path / "dest"
    src.mkdir()
    dest.mkdir()
    (src / "05_routing_base.jsonc").write_bytes(bundled)
    if installed is not None:
        (dest / "05_routing_base.jsonc").write_bytes(installed)
    code = _function(PROVISION, "same_ignoring_cr") + _function(PROVISION, "sync_bundled_template_dir")
    code += f'\nsync_bundled_template_dir "{src.as_posix()}" "{dest.as_posix()}" test\n'
    proc = _sh(code, tmp_path)
    assert proc.returncode == 0, proc.stderr
    return dest / "05_routing_base.jsonc", sorted(dest.glob("*.dist-*")), proc.stdout


LF = b'// base\n{\n  "rules": []\n}\n'
CRLF = LF.replace(b"\n", b"\r\n")


def test_line_endings_alone_do_not_make_a_backup(tmp_path: Path) -> None:
    target, backups, _out = _sync(tmp_path, bundled=LF, installed=CRLF)

    assert backups == []
    assert target.read_bytes() == LF, "the shipped copy still wins"


def test_real_change_is_still_backed_up(tmp_path: Path) -> None:
    edited = b'// base\n{\n  "rules": [{"outboundTag": "mine"}]\n}\n'

    target, backups, out = _sync(tmp_path, bundled=LF, installed=edited)

    assert len(backups) == 1
    assert backups[0].read_bytes() == edited
    assert target.read_bytes() == LF
    assert "backup:" in out


def test_identical_template_is_left_alone(tmp_path: Path) -> None:
    target, backups, out = _sync(tmp_path, bundled=LF, installed=LF)

    assert backups == []
    assert target.read_bytes() == LF
    assert "обновляю" not in out


def test_new_template_is_added(tmp_path: Path) -> None:
    target, backups, _out = _sync(tmp_path, bundled=LF, installed=None)

    assert backups == []
    assert target.read_bytes() == LF
