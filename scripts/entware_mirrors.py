"""Зеркала Entware — запасные источники пакетов для установщика панели.

Список берётся при каждой сборке архива со страницы проекта Entware, поэтому
новые зеркала попадают в архив сами. Каждое зеркало проверяется по http и по
https: в архив идут только адреса, по которым оно отдало список пакетов. На
роутере страницу никто не читает — установщик перебирает то, что лежит в архиве.

Если страница или все зеркала недоступны (сборка без сети), в архив идёт список,
сохранённый в репозитории. Обновить его: `npm run mirrors:entware`. Зеркало из
сохранённого списка, не ответившее при сборке, убирается только после 7 разных
дней молчания: при сборке молчать может сеть сборщика (VPN), а не зеркало.
"""

from __future__ import annotations

import json
import sys
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import date
from html.parser import HTMLParser
from pathlib import Path
from typing import Callable, Iterable, Optional


PAGE_URL = "https://entware.net/mirrors.html"
LIST_RELATIVE = Path("scripts") / "entware_mirrors.txt"
# Каталог, по которому проверяется зеркало: самая частая архитектура роутеров.
PROBE_PATH = "aarch64-k3.10/Packages.gz"
TIMEOUT_S = 15
ATTEMPTS = 2
# Сколько разных дней сборок зеркало из сохранённого списка может молчать,
# прежде чем его уберут. Счётчик локальный, вне git.
SILENT_DAYS_LIMIT = 7
REPO_ROOT = Path(__file__).resolve().parents[1]
STATE_PATH = REPO_ROOT / ".tmp" / "entware_mirrors_state.json"
# Объяснение для того, кто собирает архив: печатается вместе с предупреждениями.
RULE_NOTE = (
    f"Правило: зеркало из сохранённого списка, не ответившее при сборке, остаётся в архиве, "
    f"пока не промолчит при сборках в {SILENT_DAYS_LIMIT} разных дней (молчать может сеть сборщика, "
    f"например VPN), потом убирается. Ответило хоть раз — счёт заново. Счёт дней ведёт только "
    f"локальная сборка (.tmp/entware_mirrors_state.json), в CI сохранённое зеркало остаётся. "
    f"Сохранить список в репозиторий: npm run mirrors:entware и закоммитить "
    f"xkeen-ui/scripts/entware_mirrors.txt."
)

HEADER = """# Зеркала Entware — запасные источники пакетов для установщика.
# Список берётся при сборке архива со страницы https://entware.net/mirrors.html;
# строка — адрес, по которому зеркало отдало список пакетов. Порядок перебора
# задаёт установщик. Файл обновляет `npm run mirrors:entware`, руками не править.
"""


class _MirrorPage(HTMLParser):
    """Ссылки из списков без класса: так на странице размечены зеркала,
    а меню и подвал — списки со своим классом."""

    def __init__(self) -> None:
        super().__init__()
        self._lists: list[bool] = []
        self.links: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, Optional[str]]]) -> None:
        if tag == "ul":
            self._lists.append(not dict(attrs).get("class"))
        elif tag == "a" and self._lists and self._lists[-1]:
            href = (dict(attrs).get("href") or "").strip()
            if href.startswith(("http://", "https://")):
                self.links.append(href)

    def handle_endtag(self, tag: str) -> None:
        if tag == "ul" and self._lists:
            self._lists.pop()


def parse_mirror_page(html: str) -> list[str]:
    page = _MirrorPage()
    page.feed(html)
    mirrors: list[str] = []
    for link in page.links:
        base = link.rstrip("/")
        if base not in mirrors:
            mirrors.append(base)
    return mirrors


def candidates(base: str) -> list[str]:
    """Адрес зеркала по http и по https: страница даёт один, отвечать может любой."""
    rest = base.split("://", 1)[1]
    return [f"http://{rest}", f"https://{rest}"]


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    # Переадресация не считается ответом: opkg с wget из BusyBox за http → https
    # не пойдёт, а такой адрес в списке только отнимет у установщика время.
    def redirect_request(self, *_args, **_kwargs):
        return None


def probe(url: str, timeout: float = TIMEOUT_S) -> bool:
    request = urllib.request.Request(f"{url}/{PROBE_PATH}", headers={"Range": "bytes=0-0", "User-Agent": "xkeen-ui-build"})
    opener = urllib.request.build_opener(_NoRedirect)
    try:
        with opener.open(request, timeout=timeout) as response:
            return response.status in (200, 206)
    except (urllib.error.URLError, OSError, ValueError):
        return False


def fetch_page(url: str = PAGE_URL, timeout: float = TIMEOUT_S) -> str:
    request = urllib.request.Request(url, headers={"User-Agent": "xkeen-ui-build"})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return response.read().decode("utf-8", errors="replace")


def _alive(url: str, check: Callable[[str], bool]) -> bool:
    # Разовый таймаут — не повод выкинуть зеркало из выпуска.
    return any(check(url) for _ in range(ATTEMPTS))


def survey(
    page: Callable[[], str] = fetch_page,
    check: Callable[[str], bool] = probe,
    log: Callable[[str], None] = print,
) -> tuple[list[str], list[str]]:
    """Все адреса зеркал со страницы (http и https) и те из них, что ответили.

    Пустые списки — страница недоступна или пуста.
    """
    try:
        mirrors = parse_mirror_page(page())
    except Exception as error:  # сеть, сертификат, разметка — всё равно
        log(f"[!] страница зеркал Entware недоступна ({error})")
        return [], []
    if not mirrors:
        log("[!] на странице зеркал Entware не нашлось ни одного адреса")
        return [], []
    urls = [url for base in mirrors for url in candidates(base)]
    with ThreadPoolExecutor(max_workers=len(urls)) as pool:
        alive = list(pool.map(lambda url: _alive(url, check), urls))
    return urls, [url for url, ok in zip(urls, alive) if ok]


def collect(
    page: Callable[[], str] = fetch_page,
    check: Callable[[str], bool] = probe,
    log: Callable[[str], None] = print,
) -> list[str]:
    """Только ответившие адреса — для явного обновления сохранённого списка."""
    urls, alive = survey(page, check, log)
    for url in urls:
        if url not in alive:
            log(f"[*] не отвечает: {url}")
    return alive


def render(urls: Iterable[str]) -> str:
    return HEADER + "".join(f"{url}\n" for url in urls)


def read_list(path: Path) -> list[str]:
    try:
        text = path.read_text(encoding="utf-8")
    except OSError:
        return []
    return [line.strip() for line in text.splitlines() if line.strip() and not line.startswith("#")]


def load_state(path: Optional[Path]) -> dict[str, list[str]]:
    if path is None:
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    if not isinstance(data, dict):
        return {}
    return {str(url): sorted({str(day) for day in days}) for url, days in data.items() if isinstance(days, list)}


def save_state(path: Optional[Path], state: dict[str, list[str]]) -> None:
    if path is None:
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(state, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def choose(
    listed: list[str],
    alive: list[str],
    kept: list[str],
    state: Optional[dict[str, list[str]]],
    today: str,
    log: Callable[[str], None],
) -> list[str]:
    """Какие адреса идут в список.

    Ответивший — идёт. Новый без ответа — нет. Зеркало из сохранённого списка
    без ответа остаётся, пока не промолчит при сборках в SILENT_DAYS_LIMIT
    разных дней: молчать может сеть сборщика (VPN на машине разработчика
    отрезал китайские зеркала), а не само зеркало. Ответило хоть раз — счёт
    заново. Пропавшее со страницы уходит. Без счётчика (state=None, сборка в
    CI, где он не переживает запуск) сохранённое зеркало остаётся всегда.
    """
    urls: list[str] = []
    for url in listed:
        if url in alive:
            if state is not None:
                state.pop(url, None)
            urls.append(url)
            continue
        if url not in kept:
            log(f"[*] новое зеркало Entware не отвечает и в список не идёт: {url}")
            continue
        if state is None:
            log(f"[!] зеркало Entware не ответило, но оставлено (есть в сохранённом списке): {url}")
            urls.append(url)
            continue
        days = sorted(set(state.get(url, [])) | {today})
        state[url] = days
        if len(days) >= SILENT_DAYS_LIMIT:
            log(f"[!] зеркало Entware молчит {len(days)} дн. сборок с {days[0]} — убрано: {url}")
        else:
            log(f"[!] зеркало Entware не ответило ({len(days)} из {SILENT_DAYS_LIMIT} дн.), оставлено: {url}")
            urls.append(url)
    if state is not None:
        for url in list(state):
            if url not in listed:
                state.pop(url)
    return urls


def refresh(
    package_root: Path,
    saved: Path,
    page: Callable[[], str] = fetch_page,
    check: Callable[[str], bool] = probe,
    log: Callable[[str], None] = print,
    state_path: Optional[Path] = None,
    today: Optional[str] = None,
) -> list[str]:
    """Записать в дерево архива свежий список; без сети — сохранённый.

    Правила отбора — в choose(). state_path — счётчик дней молчания
    (локальная сборка); без него сохранённые зеркала не убираются.
    """
    listed, alive = survey(page, check, log)
    kept = read_list(saved)
    urls: list[str] = []
    if listed:
        state = load_state(state_path) if state_path is not None else None
        urls = choose(listed, alive, kept, state, today or date.today().isoformat(), log)
        if state is not None:
            save_state(state_path, state)
    if not urls:
        log(f"[!] зеркала Entware: беру список из репозитория ({len(kept)} адрес(ов))")
        urls = kept
    elif urls != kept:
        log("[*] список зеркал Entware изменился; сохранить в репозиторий: npm run mirrors:entware")
    target = package_root / LIST_RELATIVE
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(render(urls), encoding="utf-8", newline="\n")
    log(f"[*] зеркала Entware в архиве: {len(urls)} адрес(ов)")
    return urls


def main() -> int:
    # По тем же правилам, что и сборка: прогон через VPN не должен стереть
    # из сохранённого списка живые зеркала.
    saved = REPO_ROOT / "xkeen-ui" / LIST_RELATIVE
    listed, alive = survey()
    urls: list[str] = []
    if listed:
        state = load_state(STATE_PATH)
        urls = choose(listed, alive, read_list(saved), state, date.today().isoformat(), print)
        save_state(STATE_PATH, state)
    if not urls:
        print("[!] список не обновлён: ни страница, ни зеркала не ответили", file=sys.stderr)
        return 1
    saved.write_text(render(urls), encoding="utf-8", newline="\n")
    print(f"[*] {saved}: {len(urls)} адрес(ов)")
    for url in urls:
        print(f"    {url}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
