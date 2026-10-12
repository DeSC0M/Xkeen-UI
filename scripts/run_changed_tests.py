"""Запустить только те тесты, которых касаются несохранённые в Git правки.

Тесты панели называют проверяемый файл по имени: читают `panel_init.sh`,
импортируют `services.happ_links`, ищут строки в `panel.html`. Поэтому выборка
делается по тексту: изменён файл — идут тесты, где встречается его имя, и сами
изменённые тесты. Косвенные зависимости так не поймать, и полный прогон перед
пушем это не заменяет: выборка нужна, чтобы узнать о поломке за секунды.
"""

from __future__ import annotations

import argparse
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TESTS = ROOT / "tests"
# Имена, по которым нашлась бы половина набора: вместо них берётся каталог.
GENERIC_STEMS = frozenset({"__init__", "index", "main", "app", "utils", "state", "base", "common"})
# С такого числа файлов запуск потоков окупается.
PARALLEL_FROM = 8


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run the tests that mention the files changed since a Git revision.")
    parser.add_argument("--since", default="HEAD", help="revision to compare the working tree with")
    parser.add_argument("--list", action="store_true", help="print the selection and do not run it")
    return parser.parse_args()


def _git(*args: str) -> list[str]:
    result = subprocess.run(["git", *args], cwd=ROOT, capture_output=True, text=True, encoding="utf-8", check=True)
    return [line for line in result.stdout.split("\0") if line]


def changed_files(since: str) -> list[Path]:
    names = _git("diff", "--name-only", "-z", since) + _git("ls-files", "--others", "--exclude-standard", "-z")
    return sorted({Path(name) for name in names})


def needle(path: Path) -> str:
    stem = path.name.split(".", 1)[0]
    return f"{path.parent.name}/{stem}" if stem in GENERIC_STEMS else stem


def select(changed: list[Path]) -> list[Path]:
    selected = {ROOT / path for path in changed if path.parent.name == "tests" and path.name.startswith("test_")}
    needles = {needle(path) for path in changed if path.parent.name != "tests" or not path.name.startswith("test_")}
    needles.discard("")
    if needles:
        # Имя ищется целым словом: `state` не должен находить `state_store`.
        pattern = re.compile("|".join(rf"(?<![\w-]){re.escape(item)}(?![\w-])" for item in sorted(needles)))
        for test in TESTS.glob("test_*.py"):
            if test not in selected and pattern.search(test.read_text(encoding="utf-8", errors="replace")):
                selected.add(test)
    return sorted(selected)


def main() -> int:
    args = parse_args()
    changed = changed_files(args.since)
    selected = select(changed)
    print(f"changed files: {len(changed)}, test files to run: {len(selected)}")
    if args.list or not selected:
        for test in selected:
            print(test.relative_to(ROOT).as_posix())
        return 0

    files = [test.relative_to(ROOT).as_posix() for test in selected]
    base = [sys.executable, "-m", "pytest", "-q", *files]
    parallel = ["-n", "auto", "--dist", "loadfile"] if len(files) >= PARALLEL_FROM else []
    # Проверки с замером времени идут отдельным проходом, как в полном прогоне.
    first = subprocess.run([*base, *parallel, "-m", "not timing"], cwd=ROOT).returncode
    second = subprocess.run([*base, "-m", "timing"], cwd=ROOT).returncode
    # Код 5 — «ничего не собрано»: для одного из двух проходов это обычное дело.
    codes = [code for code in (first, second) if code != 5]
    return max(codes, default=0)


if __name__ == "__main__":
    raise SystemExit(main())
