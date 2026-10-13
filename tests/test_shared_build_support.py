"""Общая копия дерева панели возвращается следующему тесту нетронутой.

Тесты карты владения дописывают файлы в одну копию на файл тестов. Здесь
проверяется сторож этой копии: дописанное убирается, а порча прежних файлов
не остаётся незамеченной.
"""

from __future__ import annotations

import os
from pathlib import Path

from tests.support.shared_build import drop_additions, tree_state


def _tree(tmp_path: Path) -> Path:
    root = tmp_path / "tree"
    (root / "static" / "js").mkdir(parents=True)
    (root / "app.py").write_text("app = None\n", encoding="utf-8")
    (root / "static" / "js" / "page.js").write_text("export {};\n", encoding="utf-8")
    return root


def test_added_files_and_directories_are_removed(tmp_path: Path) -> None:
    root = _tree(tmp_path)
    original = tree_state(root)
    (root / "static" / "js" / "page.js.gz").write_bytes(b"gz")
    (root / "static" / "frontend-build" / ".vite").mkdir(parents=True)
    (root / "static" / "frontend-build" / ".vite" / "manifest.json").write_text("{}", encoding="utf-8")
    (root / "module-ownership.json").write_text("{}", encoding="utf-8")

    assert drop_additions(root, original)

    assert tree_state(root) == original
    assert not (root / "static" / "frontend-build").exists()


def test_bytecode_cache_is_not_counted_as_a_change(tmp_path: Path) -> None:
    root = _tree(tmp_path)
    original = tree_state(root)
    (root / "__pycache__").mkdir()
    (root / "__pycache__" / "app.cpython-312.pyc").write_bytes(b"pyc")

    assert drop_additions(root, original)


def test_a_rewritten_file_is_reported(tmp_path: Path) -> None:
    root = _tree(tmp_path)
    original = tree_state(root)
    (root / "app.py").write_text("app = object()\n", encoding="utf-8")

    assert not drop_additions(root, original)


def test_a_rewrite_of_the_same_size_is_reported(tmp_path: Path) -> None:
    root = _tree(tmp_path)
    original = tree_state(root)
    target = root / "app.py"
    stat = target.stat()
    target.write_text("app = True\n", encoding="utf-8")
    os.utime(target, ns=(stat.st_atime_ns, stat.st_mtime_ns + 1_000_000_000))

    assert not drop_additions(root, original)


def test_a_removed_file_is_reported(tmp_path: Path) -> None:
    root = _tree(tmp_path)
    original = tree_state(root)
    (root / "static" / "js" / "page.js").unlink()

    assert not drop_additions(root, original)
