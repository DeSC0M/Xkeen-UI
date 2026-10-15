"""Зеркала Entware — запасные источники пакетов для установщика панели.

Список берётся при каждой сборке архива со страницы проекта Entware, поэтому
новые зеркала попадают в архив сами. Каждое зеркало проверяется по http и по
https: в архив идут только адреса, по которым оно отдало список пакетов. На
роутере страницу никто не читает — установщик перебирает то, что лежит в архиве.

Если страница или все зеркала недоступны (сборка без сети), в архив идёт список,
сохранённый в репозитории. Обновить его: `npm run mirrors:entware`.
"""

from __future__ import annotations

import sys
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from html.parser import HTMLParser
from pathlib import Path
from typing import Callable, Iterable, Optional


PAGE_URL = "https://entware.net/mirrors.html"
LIST_RELATIVE = Path("scripts") / "entware_mirrors.txt"
# Каталог, по которому проверяется зеркало: самая частая архитектура роутеров.
PROBE_PATH = "aarch64-k3.10/Packages.gz"
TIMEOUT_S = 15
ATTEMPTS = 2

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


def collect(
    page: Callable[[], str] = fetch_page,
    check: Callable[[str], bool] = probe,
    log: Callable[[str], None] = print,
) -> list[str]:
    """Живые адреса зеркал со страницы; пустой список — взять сохранённый."""
    try:
        mirrors = parse_mirror_page(page())
    except Exception as error:  # сеть, сертификат, разметка — всё равно
        log(f"[!] страница зеркал Entware недоступна ({error})")
        return []
    if not mirrors:
        log("[!] на странице зеркал Entware не нашлось ни одного адреса")
        return []
    urls = [url for base in mirrors for url in candidates(base)]
    with ThreadPoolExecutor(max_workers=len(urls)) as pool:
        alive = list(pool.map(lambda url: _alive(url, check), urls))
    # У каждого зеркала два адреса подряд — http и https.
    for index, base in enumerate(mirrors):
        if not any(alive[2 * index : 2 * index + 2]):
            log(f"[*] зеркало Entware не отвечает и в архив не идёт: {base}")
    return [url for url, ok in zip(urls, alive) if ok]


def render(urls: Iterable[str]) -> str:
    return HEADER + "".join(f"{url}\n" for url in urls)


def read_list(path: Path) -> list[str]:
    try:
        text = path.read_text(encoding="utf-8")
    except OSError:
        return []
    return [line.strip() for line in text.splitlines() if line.strip() and not line.startswith("#")]


def refresh(
    package_root: Path,
    saved: Path,
    page: Callable[[], str] = fetch_page,
    check: Callable[[str], bool] = probe,
    log: Callable[[str], None] = print,
) -> list[str]:
    """Записать в дерево архива свежий список; без сети — сохранённый."""
    urls = collect(page, check, log)
    kept = read_list(saved)
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
    saved = Path(__file__).resolve().parents[1] / "xkeen-ui" / LIST_RELATIVE
    urls = collect()
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
