"""Зеркала Entware — запасные источники пакетов для установщика панели.

Список берётся при каждой сборке архива со страницы проекта Entware, поэтому
новые зеркала попадают в архив сами. Каждое зеркало проверяется по http и по
https. На роутере страницу никто не читает — установщик перебирает то, что
лежит в архиве.

Молчащее зеркало убирается не сразу. Дата, с которой оно молчит, записывается в
общий файл наблюдения (scripts/entware_mirrors_watch.json, он в git — его видят
все, кто собирает архив). Ответило хоть при одной сборке — запись снимается.
Молчит 7 календарных дней — уходит из архива, пока снова не ответит.

Если страница недоступна (сборка без сети), в архив идёт список, сохранённый в
репозитории. Обновить его: `npm run mirrors:entware`.
"""

from __future__ import annotations

import functools
import http.client
import json
import socket
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
# Сколько календарных дней зеркало из списка может молчать, прежде чем его уберут.
SILENT_DAYS_LIMIT = 7
REPO_ROOT = Path(__file__).resolve().parents[1]
WATCH_PATH = REPO_ROOT / "scripts" / "entware_mirrors_watch.json"
# Объяснение для того, кто собирает архив: печатается вместе с предупреждениями.
RULE_NOTE = (
    f"Правило: зеркало, не ответившее при сборке, записывается в scripts/entware_mirrors_watch.json "
    f"с датой, с которой молчит. Ответило при любой сборке (у кого угодно) — запись снимается. "
    f"Молчит {SILENT_DAYS_LIMIT} календарных дней — уходит из архива, пока снова не ответит. "
    f"Файл наблюдения общий: изменился — закоммитить его, чтобы счёт видели остальные. "
    f"VPN на машине сборщика (Happ) обходится: зеркало, не ответившее через него, проверяется напрямую."
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


def _direct_opener(source: str) -> urllib.request.OpenerDirector:
    """Мимо VPN: без системного прокси и с исходящим адресом сетевого адаптера.

    Happ ставит системный прокси и TUN-адаптер с маршрутами на весь интернет;
    соединение, привязанное к адресу Wi-Fi, уходит мимо TUN (так же, как
    `curl --noproxy '*' --interface 192.168.45.2`).
    """
    bind = (source, 0)

    class Http(urllib.request.HTTPHandler):
        def http_open(self, req):
            return self.do_open(functools.partial(http.client.HTTPConnection, source_address=bind), req)

    class Https(urllib.request.HTTPSHandler):
        def https_open(self, req):
            return self.do_open(
                functools.partial(http.client.HTTPSConnection, source_address=bind), req, context=self._context
            )

    return urllib.request.build_opener(urllib.request.ProxyHandler({}), Http, Https, _NoRedirect)


def local_addresses() -> list[str]:
    """Адреса IPv4 этой машины, кроме петли и автонастройки (169.254.*)."""
    try:
        found = socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET)
    except OSError:
        return []
    addresses: list[str] = []
    for *_rest, sockaddr in found:
        address = sockaddr[0]
        if address.startswith(("127.", "169.254.")) or address in addresses:
            continue
        addresses.append(address)
    return addresses


def _ask(opener: urllib.request.OpenerDirector, url: str, timeout: float) -> bool:
    request = urllib.request.Request(f"{url}/{PROBE_PATH}", headers={"Range": "bytes=0-0", "User-Agent": "xkeen-ui-build"})
    try:
        with opener.open(request, timeout=timeout) as response:
            return response.status in (200, 206)
    except (urllib.error.URLError, OSError, ValueError):
        return False


def probe(url: str, timeout: float = TIMEOUT_S) -> bool:
    if _ask(urllib.request.build_opener(_NoRedirect), url, timeout):
        return True
    # Не ответило обычным путём — возможно, его режет VPN на машине сборщика.
    # Пробуем напрямую с каждого адреса: у кого VPN нет, сюда почти не доходят.
    return any(_ask(_direct_opener(source), url, timeout) for source in local_addresses())


def fetch_page(url: str = PAGE_URL, timeout: float = TIMEOUT_S) -> str:
    request = urllib.request.Request(url, headers={"User-Agent": "xkeen-ui-build"})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return response.read().decode("utf-8", errors="replace")


def _alive(url: str, check: Callable[[str], bool]) -> bool:
    # Разовый таймаут — не повод записывать зеркало в молчащие.
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


def load_watch(path: Path) -> dict[str, str]:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    if not isinstance(data, dict):
        return {}
    return {str(url): str(since) for url, since in data.items()}


def save_watch(path: Path, watch: dict[str, str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(watch, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8", newline="\n")


def _silent_days(since: str, today: str) -> int:
    try:
        return (date.fromisoformat(today) - date.fromisoformat(since)).days
    except ValueError:
        return 0


def choose(
    listed: list[str],
    alive: list[str],
    known: list[str],
    watch: dict[str, str],
    today: str,
    log: Callable[[str], None],
) -> list[str]:
    """Какие адреса идут в список; watch правится на месте.

    Ответил — идёт, запись о молчании снимается (так убранное зеркало
    возвращается). Ни разу не отвечавший (нет в known) — не идёт. Известный
    молчащий — получает дату, с которой молчит, и идёт, пока не пройдёт
    SILENT_DAYS_LIMIT календарных дней. Пропавшее со страницы забывается.
    """
    urls: list[str] = []
    for url in listed:
        if url in alive:
            if watch.pop(url, None) is not None:
                log(f"[!] зеркало Entware снова отвечает, молчание снято: {url}")
            urls.append(url)
            continue
        if url not in known and url not in watch:
            log(f"[*] новое зеркало Entware не отвечает и в список не идёт: {url}")
            continue
        since = watch.setdefault(url, today)
        days = _silent_days(since, today)
        if days >= SILENT_DAYS_LIMIT:
            log(f"[!] зеркало Entware молчит с {since} ({days} дн.) — убрано, вернётся, когда ответит: {url}")
        else:
            log(f"[!] зеркало Entware молчит с {since} ({days} из {SILENT_DAYS_LIMIT} дн.), пока оставлено: {url}")
            urls.append(url)
    for url in list(watch):
        if url not in listed:
            watch.pop(url)
    return urls


def render(urls: Iterable[str]) -> str:
    return HEADER + "".join(f"{url}\n" for url in urls)


def read_list(path: Path) -> list[str]:
    try:
        text = path.read_text(encoding="utf-8")
    except OSError:
        return []
    return [line.strip() for line in text.splitlines() if line.strip() and not line.startswith("#")]


def _apply(
    saved: Path,
    watch_path: Path,
    page: Callable[[], str],
    check: Callable[[str], bool],
    log: Callable[[str], None],
    today: Optional[str],
) -> tuple[list[str], list[str]]:
    """(выбранные адреса, сохранённый список); пустые выбранные — страница недоступна."""
    listed, alive = survey(page, check, log)
    kept = read_list(saved)
    if not listed:
        return [], kept
    watch = load_watch(watch_path)
    before = dict(watch)
    urls = choose(listed, alive, kept, watch, today or date.today().isoformat(), log)
    if watch != before:
        save_watch(watch_path, watch)
        log(f"[!] файл наблюдения за зеркалами изменился — закоммитить: scripts/{watch_path.name}")
    return urls, kept


def refresh(
    package_root: Path,
    saved: Path,
    page: Callable[[], str] = fetch_page,
    check: Callable[[str], bool] = probe,
    log: Callable[[str], None] = print,
    watch_path: Path = WATCH_PATH,
    today: Optional[str] = None,
) -> list[str]:
    """Записать в дерево архива свежий список; без сети — сохранённый."""
    urls, kept = _apply(saved, watch_path, page, check, log, today)
    if not urls:
        log(f"[!] зеркала Entware: беру список из репозитория ({len(kept)} адрес(ов))")
        urls = kept
    elif urls != kept:
        log("[!] список зеркал Entware изменился; сохранить в репозиторий: npm run mirrors:entware")
    target = package_root / LIST_RELATIVE
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(render(urls), encoding="utf-8", newline="\n")
    log(f"[*] зеркала Entware в архиве: {len(urls)} адрес(ов)")
    return urls


def main() -> int:
    # По тем же правилам, что и сборка: молчащее зеркало не стирается из
    # сохранённого списка раньше срока.
    saved = REPO_ROOT / "xkeen-ui" / LIST_RELATIVE
    urls, _kept = _apply(saved, WATCH_PATH, fetch_page, probe, print, None)
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
