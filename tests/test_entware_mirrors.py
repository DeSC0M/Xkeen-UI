"""Список зеркал Entware собирается при сборке архива, а не на роутере.

Зеркала берутся со страницы проекта Entware при каждой сборке, чтобы новые
попадали в архив сами. Молчащее зеркало убирается не сразу: дата, с которой оно
молчит, лежит в общем файле наблюдения (его видят все, кто собирает), и только
после 7 календарных дней молчания зеркало уходит из архива — до первого ответа.
Сеть здесь не нужна: страница и проверка зеркал подставные.
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

ONE = "http://mirrors.one.example/entware"
TLS = "https://tls-only.example"


def _load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


@pytest.fixture(scope="module")
def mirrors():
    return _load("entware_mirrors", ROOT / "scripts" / "entware_mirrors.py")


def _check(alive: set[str]):
    return lambda url: url in alive


@pytest.fixture
def bench(mirrors, tmp_path):
    """Сборка в заданный день: что ушло в архив, что сказано собирающему."""
    saved = tmp_path / "saved.txt"
    saved.write_text(mirrors.render([ONE, TLS]), encoding="utf-8")
    watch = tmp_path / "watch.json"

    def build(day: str, alive: set[str], page: str = PAGE):
        lines: list[str] = []
        urls = mirrors.refresh(tmp_path / "pkg", saved, lambda: page, _check(alive), lines.append, watch, day)
        return urls, lines

    return build, watch


def test_only_the_mirror_list_is_read_from_the_page(mirrors):
    assert mirrors.parse_mirror_page(PAGE) == [
        "https://mirrors.one.example/entware",
        "https://mirrors.dead.example/entware",
        "https://tls-only.example",
    ]


def test_a_single_timeout_does_not_count_as_silence(mirrors):
    seen: dict[str, int] = {}

    def flaky(url: str) -> bool:
        seen[url] = seen.get(url, 0) + 1
        return url == TLS and seen[url] > 1

    _listed, alive = mirrors.survey(lambda: PAGE, flaky, lambda _line: None)

    assert alive == [TLS]


def test_a_mirror_that_never_answered_does_not_get_in(bench):
    build, watch = bench

    urls, lines = build("2026-10-01", {ONE, TLS})

    assert urls == [ONE, TLS]
    assert any("mirrors.dead.example" in line and "новое" in line for line in lines)
    assert not watch.exists()


def test_a_silent_mirror_stays_for_seven_calendar_days_then_goes(bench):
    build, watch = bench

    urls, _ = build("2026-10-01", {TLS})
    assert urls == [ONE, TLS]
    assert json.loads(watch.read_text(encoding="utf-8")) == {ONE: "2026-10-01"}

    # Считаются календарные дни от первого молчания, а не число сборок.
    assert ONE in build("2026-10-07", {TLS})[0]
    urls, lines = build("2026-10-08", {TLS})
    assert ONE not in urls
    assert any("убрано" in line and ONE in line for line in lines)
    # Дата не сдвигается от повторных сборок.
    assert json.loads(watch.read_text(encoding="utf-8")) == {ONE: "2026-10-01"}


def test_a_removed_mirror_comes_back_when_it_answers(bench):
    build, watch = bench
    build("2026-10-01", {TLS})
    assert ONE not in build("2026-10-09", {TLS})[0]

    urls, lines = build("2026-10-10", {ONE, TLS})

    assert urls == [ONE, TLS]
    assert any("снова отвечает" in line for line in lines)
    assert json.loads(watch.read_text(encoding="utf-8")) == {}


def test_an_answer_from_anyone_clears_the_silence(bench):
    # Один собирал через VPN и записал молчание, другой собрал без VPN —
    # зеркало ответило, и счёт снят: убрано будет, только если неделю его не
    # услышал никто.
    build, _watch = bench
    build("2026-10-01", {TLS})
    build("2026-10-03", {ONE, TLS})

    assert ONE in build("2026-10-09", {TLS})[0]


def test_the_watch_file_is_written_only_when_something_changes(bench):
    build, watch = bench
    build("2026-10-01", {TLS})
    before = watch.stat().st_mtime_ns

    _urls, lines = build("2026-10-02", {TLS})

    assert watch.stat().st_mtime_ns == before
    assert not any("закоммитить" in line for line in lines)


def test_a_mirror_gone_from_the_page_is_forgotten(bench):
    build, watch = bench
    build("2026-10-01", {TLS})
    page = PAGE.replace('<li><a href="https://mirrors.one.example/entware/">https://mirrors.one.example/entware/</a></li>', "")

    urls, _ = build("2026-10-02", {TLS}, page)

    assert urls == [TLS]
    assert json.loads(watch.read_text(encoding="utf-8")) == {}


def test_a_known_mirror_is_asked_again_past_the_vpn_before_it_counts_as_silent(mirrors, tmp_path):
    # 16.10.2026: на машине с Happ прямой путь пропал на полминуты, и живые
    # bfsu/nju записались в молчащие. Знакомое зеркало, не ответившее ни через
    # VPN, ни мимо него, спрашивается мимо VPN ещё раз — после паузы.
    saved = tmp_path / "saved.txt"
    saved.write_text(mirrors.render([ONE, TLS]), encoding="utf-8")
    watch = tmp_path / "watch.json"
    asked: list[str] = []
    paused: list[float] = []

    def recheck(url: str) -> bool:
        asked.append(url)
        return url == ONE

    urls = mirrors.refresh(
        tmp_path / "pkg", saved, lambda: PAGE, _check({TLS}), lambda _l: None, watch, "2026-10-16",
        recheck=recheck, pause=paused.append,
    )

    assert urls == [ONE, TLS]
    assert not watch.exists()
    assert paused == [mirrors.RECHECK_DELAY_S]
    # Ни разу не отвечавшее в список не идёт и сборку не удлиняет.
    assert "https://mirrors.dead.example/entware" not in asked
    assert asked == [ONE]


def test_nothing_is_asked_again_when_every_known_mirror_answered(mirrors, tmp_path):
    saved = tmp_path / "saved.txt"
    saved.write_text(mirrors.render([ONE, TLS]), encoding="utf-8")
    paused: list[float] = []

    mirrors.refresh(
        tmp_path / "pkg", saved, lambda: PAGE, _check({ONE, TLS}), lambda _l: None, tmp_path / "w.json", "2026-10-16",
        recheck=lambda _u: pytest.fail("asked again"), pause=paused.append,
    )

    assert paused == []


def test_the_build_asks_again_past_the_vpn_by_default(mirrors):
    source = (ROOT / "scripts" / "entware_mirrors.py").read_text(encoding="utf-8")
    assert "if recheck is None and check is probe:\n        recheck = probe_direct" in source


def test_without_network_the_saved_list_goes_into_the_archive(mirrors, tmp_path):
    saved = tmp_path / "saved.txt"
    saved.write_text(mirrors.render(["http://kept.example/entware"]), encoding="utf-8")

    def offline() -> str:
        raise OSError("network is unreachable")

    urls = mirrors.refresh(tmp_path / "pkg", saved, offline, _check(set()), lambda _l: None, tmp_path / "w.json")

    assert urls == ["http://kept.example/entware"]
    written = (tmp_path / "pkg" / mirrors.LIST_RELATIVE).read_bytes()
    assert b"\r" not in written
    assert mirrors.read_list(tmp_path / "pkg" / mirrors.LIST_RELATIVE) == urls


def test_the_saved_list_is_in_the_repository_and_well_formed(mirrors):
    urls = mirrors.read_list(SAVED)

    assert urls, "в репозитории должен лежать список на случай сборки без сети"
    assert all(url.startswith(("http://", "https://")) and not url.endswith("/") for url in urls)
    assert SAVED.read_text(encoding="utf-8").startswith(mirrors.HEADER)


def test_the_watch_file_is_shared_through_git_and_not_shipped(mirrors):
    # Общий для всех, кто собирает, — значит в git; на роутере он не нужен.
    assert mirrors.WATCH_PATH == ROOT / "scripts" / "entware_mirrors_watch.json"
    assert mirrors.WATCH_PATH.is_file()
    assert isinstance(json.loads(mirrors.WATCH_PATH.read_text(encoding="utf-8")), dict)


def test_a_vpn_is_bypassed_when_a_mirror_does_not_answer(mirrors, monkeypatch):
    # Happ ставит системный прокси и TUN на весь интернет: не ответившее
    # зеркало проверяется ещё раз напрямую — с адреса каждого адаптера.
    asked: list[str] = []

    def ask(opener, url, timeout):
        source = getattr(opener, "_xk_source", None)
        asked.append(source or "usual")
        return source == "192.168.45.2"

    original = mirrors._direct_opener

    def direct_opener(source):
        opener = original(source)
        opener._xk_source = source
        return opener

    monkeypatch.setattr(mirrors, "_ask", ask)
    monkeypatch.setattr(mirrors, "_direct_opener", direct_opener)
    monkeypatch.setattr(mirrors, "local_addresses", lambda: ["10.6.7.1", "192.168.45.2"])

    assert mirrors.probe(ONE) is True
    assert asked == ["usual", "10.6.7.1", "192.168.45.2"]


def test_the_direct_path_ignores_the_system_proxy(mirrors, monkeypatch):
    # Системный прокси Happ (127.0.0.1:10809) urllib берёт сам; прямой путь — без него.
    happ = {"http": "http://127.0.0.1:10809", "https": "http://127.0.0.1:10809"}
    monkeypatch.setattr(mirrors.urllib.request, "getproxies", lambda: happ)

    def proxied(opener) -> bool:
        return any(isinstance(h, mirrors.urllib.request.ProxyHandler) and h.proxies for h in opener.handlers)

    assert proxied(mirrors.urllib.request.build_opener(mirrors._NoRedirect))
    assert not proxied(mirrors._direct_opener("192.168.45.2"))


def test_local_addresses_skip_loopback_and_autoconfig(mirrors, monkeypatch):
    found = [(2, 1, 6, "", (ip, 0)) for ip in ("127.0.0.1", "169.254.1.1", "192.168.45.2", "10.6.7.1", "192.168.45.2")]
    monkeypatch.setattr(mirrors.socket, "getaddrinfo", lambda *_a, **_k: found)

    assert mirrors.local_addresses() == ["192.168.45.2", "10.6.7.1"]


def _builder():
    return _load("build_user_archive_for_mirrors", ROOT / "scripts" / "build_user_archive.py")


def test_the_builder_tells_what_needs_attention_and_the_rule(tmp_path, monkeypatch, capsys):
    monkeypatch.delenv("GITHUB_ACTIONS", raising=False)
    builder = _builder()

    notices = builder.refresh_entware_mirrors(
        tmp_path, page=lambda: PAGE, check=_check({TLS}), watch_path=tmp_path / "watch.json"
    )
    builder.print_entware_mirror_notices(notices)
    out = capsys.readouterr().out

    assert "нужно внимание" in out
    assert "7 календарных дней" in out
    assert "закоммитить" in out
    assert "::warning" not in out


def test_in_ci_the_notices_become_github_warnings(tmp_path, monkeypatch, capsys):
    monkeypatch.setenv("GITHUB_ACTIONS", "true")
    builder = _builder()

    builder.refresh_entware_mirrors(tmp_path, page=lambda: PAGE, check=_check({TLS}), watch_path=tmp_path / "w.json")
    warnings = [line for line in capsys.readouterr().out.splitlines() if line.startswith("::warning")]

    assert warnings and all(line.startswith("::warning title=Зеркала Entware::") for line in warnings)
    assert any("7 календарных дней" in line for line in warnings)


def test_a_quiet_build_says_nothing_extra(tmp_path, monkeypatch, capsys):
    monkeypatch.setenv("GITHUB_ACTIONS", "true")
    builder = _builder()
    saved = [line.strip() for line in SAVED.read_text(encoding="utf-8").splitlines() if line.strip() and not line.startswith("#")]
    hosts = list(dict.fromkeys(url.split("://", 1)[1] for url in saved))
    page = "<ul>" + "".join(f'<li><a href="https://{host}/">x</a></li>' for host in hosts) + "</ul>"

    notices = builder.refresh_entware_mirrors(
        tmp_path, page=lambda: page, check=_check(set(saved)), watch_path=tmp_path / "w.json"
    )

    assert notices == []
    assert "::warning" not in capsys.readouterr().out


def test_the_explicit_refresh_follows_the_same_rule():
    # `npm run mirrors:entware` через VPN не должен стереть живые зеркала.
    main = (ROOT / "scripts" / "entware_mirrors.py").read_text(encoding="utf-8").split("def main()", 1)[1]
    assert "_apply(" in main


def test_both_the_local_and_the_release_build_refresh_the_list():
    builder = (ROOT / "scripts" / "build_user_archive.py").read_text(encoding="utf-8")
    workflow = (ROOT / ".github" / "workflows" / "build-user-archive.yml").read_text(encoding="utf-8")
    scripts = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))["scripts"]

    main = builder.split("def main()", 1)[1]
    # До штампа: tree_sha256 должен описывать архив вместе со списком.
    assert main.index("refresh_entware_mirrors(package_root)") < main.index("write_build_json(")
    assert workflow.index("builder.refresh_entware_mirrors(root)") < workflow.index("builder.write_build_json(")
    assert scripts["mirrors:entware"] == "node scripts/run_python.mjs scripts/entware_mirrors.py"
