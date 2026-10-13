"""Дорогая заготовка, которую за весь прогон строит один поток."""

from __future__ import annotations

import os
import shutil
import time
from pathlib import Path
from typing import Callable

import pytest


def build_once(tmp_path_factory, name: str, build: Callable[[Path], None]) -> Path:
    """Вернуть каталог ``name``, общий для всех потоков xdist.

    Первый поток, которому каталог понадобился, вызывает ``build(каталог)``,
    остальные ждут готовый. Готовое никто не меняет: его читают все сразу.
    """

    base = tmp_path_factory.getbasetemp()
    if os.environ.get("PYTEST_XDIST_WORKER"):
        base = base.parent
    base = base / name
    ready, failed = base / ".ready", base / ".failed"
    try:
        base.mkdir()
    except FileExistsError:
        deadline = time.monotonic() + 900
        while not ready.exists():
            if failed.exists() or time.monotonic() > deadline:
                pytest.fail(f"{name} was not built by the worker that started it")
            time.sleep(0.2)
    else:
        try:
            build(base)
            ready.touch()
        except BaseException:
            failed.touch()
            raise
    return base


def tree_state(root: Path) -> dict[Path, tuple[int, int]]:
    """Что лежит в дереве: размер и время правки каждого файла, без кэша байткода."""

    state = {}
    for path in root.rglob("*"):
        if "__pycache__" in path.parts:
            continue
        stat = path.lstat()
        state[path] = (0, 0) if path.is_dir() and not path.is_symlink() else (stat.st_size, stat.st_mtime_ns)
    return state


def drop_additions(root: Path, original: dict[Path, tuple[int, int]]) -> bool:
    """Убрать из дерева всё, чего не было в ``original``.

    Возвращает, осталось ли прежнее нетронутым. Нет — дерево испорчено и чинить
    его по частям нечем: вызывающий делает копию заново.
    """

    for path in sorted(root.rglob("*"), reverse=True):
        if "__pycache__" in path.parts or path in original:
            continue
        if path.is_dir() and not path.is_symlink():
            shutil.rmtree(path)
        else:
            path.unlink()
    return tree_state(root) == original
