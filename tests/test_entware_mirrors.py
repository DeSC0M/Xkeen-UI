"""Список зеркал Entware собирается при сборке архива, а не на роутере.

Зеркала берутся со страницы проекта Entware при каждой сборке, чтобы новые
попадали в архив сами. В архив идут только адреса, по которым зеркало ответило;
без сети — список, сохранённый в репозитории. Сеть здесь не нужна: страница и
проверка зеркал подставные.
"""

from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[1]
SAVED = ROOT / "xkeen-ui" / "scripts" / "entware_mirrors.txt"

PAGE = """<html><body>
<nav><ul class="menu"><li><a href="https://entware.net/about.html">About</a></li></ul></nav>
<ul>
  <li><a href="https://mirrors.one.example/entware/">https://mirrors.one.example/entware/</a></li>
  <li><a href="https://mirrors.dead.example/entware/">https://mirrors.dead.example/entware/</a></li>
  <li><a href="https://tls-only.example/">https://tls-only.example/</a></li>
</ul>
<ul class="contact-list"><li><a href="https://entware.net/feed.xml">feed</a></li></ul>
</body></html>"""


def _load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


@pytest.fixture(scope="module")
def mirrors():
    return _load("entware_mirrors", ROOT / "scripts" / "entware_mirrors.py")


def _check(alive: set[str], calls: list[str] | None = None):
    def check(url: str) -> bool:
        if calls is not None:
            calls.append(url)
        return url in alive

    return check


def test_only_the_mirror_list_is_read_from_the_page(mirrors):
    assert mirrors.parse_mirror_page(PAGE) == [
        "https://mirrors.one.example/entware",
        "https://mirrors.dead.example/entware",
        "https://tls-only.example",
    ]


def test_each_mirror_is_kept_by_the_schemes_it_answers(mirrors):
    alive = {"http://mirrors.one.example/entware", "https://mirrors.one.example/entware", "https://tls-only.example"}
    lines: list[str] = []

    urls = mirrors.collect(lambda: PAGE, _check(alive), lines.append)

    assert urls == [
        "http://mirrors.one.example/entware",
        "https://mirrors.one.example/entware",
        "https://tls-only.example",
    ]
    assert any("mirrors.dead.example" in line for line in lines)


def test_a_single_timeout_does_not_drop_a_mirror(mirrors):
    seen: dict[str, int] = {}

    def flaky(url: str) -> bool:
        seen[url] = seen.get(url, 0) + 1
        return url == "https://tls-only.example" and seen[url] > 1

    urls = mirrors.collect(lambda: PAGE, flaky, lambda _line: None)

    assert urls == ["https://tls-only.example"]


def test_without_network_the_saved_list_goes_into_the_archive(mirrors, tmp_path):
    saved = tmp_path / "saved.txt"
    saved.write_text(mirrors.render(["http://kept.example/entware"]), encoding="utf-8")

    def offline() -> str:
        raise OSError("network is unreachable")

    urls = mirrors.refresh(tmp_path / "pkg", saved, offline, _check(set()), lambda _line: None)

    assert urls == ["http://kept.example/entware"]
    assert mirrors.read_list(tmp_path / "pkg" / mirrors.LIST_RELATIVE) == urls


def test_a_known_mirror_that_is_silent_at_build_time_is_kept(mirrors, tmp_path):
    # VPN на машине сборщика отрезал китайские зеркала, и в архив ушло одно.
    # Проверенное раньше зеркало из-за сети сборщика не выпадает; новое без
    # ответа не попадает; пропавшее со страницы уходит.
    saved = tmp_path / "saved.txt"
    saved.write_text(
        mirrors.render(["http://mirrors.one.example/entware", "http://gone.example/entware"]), encoding="utf-8"
    )
    lines: list[str] = []

    urls = mirrors.refresh(tmp_path / "pkg", saved, lambda: PAGE, _check({"https://tls-only.example"}), lines.append)

    assert urls == ["http://mirrors.one.example/entware", "https://tls-only.example"]
    assert any("оставлено" in line and "mirrors.one.example" in line for line in lines)


def test_a_known_mirror_is_dropped_after_seven_silent_days(mirrors, tmp_path):
    saved = tmp_path / "saved.txt"
    saved.write_text(mirrors.render(["http://mirrors.one.example/entware"]), encoding="utf-8")
    state = tmp_path / "state.json"
    silent = _check({"https://tls-only.example"})

    def build(day: str) -> list[str]:
        return mirrors.refresh(tmp_path / "pkg", saved, lambda: PAGE, silent, lambda _l: None, state, day)

    # Несколько сборок в один день — один день молчания.
    for _ in range(3):
        assert "http://mirrors.one.example/entware" in build("2026-10-01")
    for day in range(2, 7):
        assert "http://mirrors.one.example/entware" in build(f"2026-10-0{day}")
    assert "http://mirrors.one.example/entware" not in build("2026-10-07")


def test_one_answer_starts_the_count_over(mirrors, tmp_path):
    saved = tmp_path / "saved.txt"
    saved.write_text(mirrors.render(["http://mirrors.one.example/entware"]), encoding="utf-8")
    state = tmp_path / "state.json"
    silent = _check(set())
    answers = _check({"http://mirrors.one.example/entware"})

    def build(day: str, check) -> list[str]:
        return mirrors.refresh(tmp_path / "pkg", saved, lambda: PAGE, check, lambda _l: None, state, day)

    for day in range(1, 7):
        build(f"2026-10-0{day}", silent)
    build("2026-10-07", answers)
    assert "http://mirrors.one.example/entware" in build("2026-10-08", silent)


def _builder():
    return _load("build_user_archive_for_mirrors", ROOT / "scripts" / "build_user_archive.py")


def _saved_urls() -> list[str]:
    return [line.strip() for line in SAVED.read_text(encoding="utf-8").splitlines() if line.strip() and not line.startswith("#")]


def test_the_builder_tells_what_needs_attention_and_the_rule(tmp_path, monkeypatch, capsys):
    monkeypatch.delenv("GITHUB_ACTIONS", raising=False)
    builder = _builder()

    notices = builder.refresh_entware_mirrors(
        tmp_path, page=lambda: PAGE, check=_check({"https://tls-only.example"})
    )
    builder.print_entware_mirror_notices(notices)
    out = capsys.readouterr().out

    assert "нужно внимание" in out
    assert "7 разных дней" in out
    assert "npm run mirrors:entware" in out
    assert "::warning" not in out


def test_in_ci_the_notices_become_github_warnings(tmp_path, monkeypatch, capsys):
    monkeypatch.setenv("GITHUB_ACTIONS", "true")
    builder = _builder()

    builder.refresh_entware_mirrors(tmp_path, page=lambda: PAGE, check=_check({"https://tls-only.example"}))
    warnings = [line for line in capsys.readouterr().out.splitlines() if line.startswith("::warning")]

    assert warnings and all(line.startswith("::warning title=Зеркала Entware::") for line in warnings)
    assert any("7 разных дней" in line for line in warnings)


def test_a_quiet_build_says_nothing_extra(tmp_path, monkeypatch, capsys):
    monkeypatch.setenv("GITHUB_ACTIONS", "true")
    builder = _builder()
    # Страница перечисляет те же зеркала, что и сохранённый список, и отвечают
    # ровно сохранённые адреса: менять нечего, говорить не о чем.
    saved = _saved_urls()
    hosts = list(dict.fromkeys(url.split("://", 1)[1] for url in saved))
    page = "<ul>" + "".join(f'<li><a href="https://{host}/">x</a></li>' for host in hosts) + "</ul>"

    notices = builder.refresh_entware_mirrors(tmp_path, page=lambda: page, check=_check(set(saved)))

    assert notices == []
    assert "::warning" not in capsys.readouterr().out


def test_the_explicit_refresh_follows_the_same_rule(mirrors):
    # `npm run mirrors:entware` через VPN не должен стереть живые зеркала.
    main = (ROOT / "scripts" / "entware_mirrors.py").read_text(encoding="utf-8").split("def main()", 1)[1]
    assert "choose(" in main and "collect(" not in main


def test_when_no_mirror_answers_the_saved_list_is_used_too(mirrors, tmp_path):
    saved = tmp_path / "saved.txt"
    saved.write_text(mirrors.render(["http://kept.example/entware"]), encoding="utf-8")

    urls = mirrors.refresh(tmp_path / "pkg", saved, lambda: PAGE, _check(set()), lambda _line: None)

    assert urls == ["http://kept.example/entware"]


def test_a_fresh_list_replaces_the_saved_one_in_the_archive_only(mirrors, tmp_path):
    saved = tmp_path / "saved.txt"
    before = mirrors.render(["http://kept.example/entware"])
    saved.write_text(before, encoding="utf-8")
    lines: list[str] = []

    urls = mirrors.refresh(tmp_path / "pkg", saved, lambda: PAGE, _check({"https://tls-only.example"}), lines.append)

    assert urls == ["https://tls-only.example"]
    written = (tmp_path / "pkg" / mirrors.LIST_RELATIVE).read_bytes()
    assert b"\r" not in written
    assert saved.read_text(encoding="utf-8") == before
    assert any("npm run mirrors:entware" in line for line in lines)


def test_the_saved_list_is_in_the_repository_and_well_formed(mirrors):
    urls = mirrors.read_list(SAVED)

    assert urls, "в репозитории должен лежать список на случай сборки без сети"
    assert all(url.startswith(("http://", "https://")) and not url.endswith("/") for url in urls)
    assert SAVED.read_text(encoding="utf-8").startswith(mirrors.HEADER)


def test_both_the_local_and_the_release_build_refresh_the_list():
    builder = (ROOT / "scripts" / "build_user_archive.py").read_text(encoding="utf-8")
    workflow = (ROOT / ".github" / "workflows" / "build-user-archive.yml").read_text(encoding="utf-8")
    scripts = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))["scripts"]

    main = builder.split("def main()", 1)[1]
    # До штампа: tree_sha256 должен описывать архив вместе со списком.
    assert main.index("refresh_entware_mirrors(package_root, count_silent_days=True)") < main.index("write_build_json(")
    assert workflow.index("builder.refresh_entware_mirrors(root)") < workflow.index("builder.write_build_json(")
    assert scripts["mirrors:entware"] == "node scripts/run_python.mjs scripts/entware_mirrors.py"
