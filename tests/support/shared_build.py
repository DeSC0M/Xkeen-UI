"""Дорогая заготовка, которую за весь прогон строит один поток."""

from __future__ import annotations

import os
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
