"""Если ни зеркало роутера, ни официальный источник не ответили — зеркала Entware.

Список зеркал приезжает в архиве (scripts/entware_mirrors.txt, его собирает
сборщик архива). Порядок: официальный по http, зеркала по http, затем по https —
официальный и зеркала, но только когда opkg качает через wget-ssl: wget из
BusyBox на https падает. Каждое обращение — через временные настройки, настройки
роутера не меняются. Запасным источникам — свой, более короткий предел времени.
"""

from __future__ import annotations

import os
import subprocess
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[1]
LIB = ROOT / "xkeen-ui" / "scripts" / "provision_env.sh"
INSTALL = ROOT / "xkeen-ui" / "install.sh"

ROUTER_CONF = """src/gz entware http://router-mirror.invalid/entware/aarch64-k3.10
dest root /
lists_dir ext /opt/var/opkg-lists
arch aarch64-3.10 150
"""

MIRRORS = """# Зеркала Entware
http://one.example/entware
https://one.example/entware
http://two.example/entware
https://tls-only.example
"""

# Подставной opkg: пишет, к какому источнику обращён запрос (первый `src/gz`
# в настройках), и отвечает только тем, что перечислены в FAKE_ANSWER.
FAKE_OPKG = """#!/bin/sh
conf="$XKEEN_OPKG_CONF"
temporary=0
prev=""
for arg in "$@"; do [ "$prev" = "-f" ] && conf="$arg" && temporary=1; prev="$arg"; done
source="$(sed -n 's#^src/gz[[:space:]]*[^[:space:]]*[[:space:]]*\\(.*\\)/aarch64-k3.10.*#\\1#p' "$conf" | head -n 1)"
echo "$source" >> "$FAKE_LOG"
case " $FAKE_ANSWER " in
  *" $source "*)
    # Список пакетов — только во временные настройки: каталог списков роутера
    # (/opt/var/…) на машине с тестами трогать нельзя. У отставшего источника
    # (FAKE_STALE, по умолчанию любой) нет пакетов из FAKE_OMIT.
    if [ "$temporary" = 1 ] && [ "$3" = "update" ]; then
      lists="$(sed -n 's#^lists_dir[[:space:]]*[^[:space:]]*[[:space:]]*##p' "$conf")"
      mkdir -p "$lists"
      for p in python3 python3-pip python3-cryptography wget-ssl ca-bundle lftp; do
        if [ "$source" = "${FAKE_STALE:-$source}" ]; then
          case " $FAKE_OMIT " in *" $p "*) continue ;; esac
        fi
        echo "Package: $p"
      done > "$lists/entware"
    fi
    exit 0 ;;
esac
exit 1
"""


@pytest.fixture
def stand(tmp_path):
    opkg = tmp_path / "opkg"
    opkg.write_bytes(FAKE_OPKG.encode("utf-8"))
    os.chmod(opkg, 0o755)
    (tmp_path / "opkg.conf").write_text(ROUTER_CONF, encoding="utf-8")
    (tmp_path / "mirrors.txt").write_text(MIRRORS, encoding="utf-8")
    return tmp_path, opkg


def _run(stand, body: str, *, answer: str = "", wget_ssl: bool = False, **env: str):
    tmp_path, opkg = stand
    log = tmp_path / "opkg.log"
    wget = tmp_path / "libexec" / "wget-ssl"
    certs = tmp_path / "certs"
    if wget_ssl:
        wget.parent.mkdir(exist_ok=True)
        wget.write_bytes(b"#!/bin/sh\nexit 0\n")
        os.chmod(wget, 0o755)
        certs.mkdir(exist_ok=True)
        (certs / "ca-certificates.crt").write_text("cert", encoding="utf-8")
    script = tmp_path / "call.sh"
    script.write_bytes(
        "\n".join(["set -e", f'. "{LIB.as_posix()}"', f'OPKG_BIN="{opkg.as_posix()}"', body, ""]).encode("utf-8")
    )
    proc = subprocess.run(
        ["sh", script.as_posix()],
        capture_output=True,
        text=True,
        encoding="utf-8",
        env={
            **os.environ,
            "FAKE_LOG": log.as_posix(),
            "FAKE_ANSWER": answer,
            "XKEEN_OPKG_CONF": (tmp_path / "opkg.conf").as_posix(),
            "XKEEN_ENTWARE_MIRRORS": (tmp_path / "mirrors.txt").as_posix(),
            "XKEEN_WGET_SSL": wget.as_posix(),
            "XKEEN_SSL_CERTS": certs.as_posix(),
            "XKEEN_OPKG_UPDATE_TIMEOUT": "5",
            "TMPDIR": tmp_path.as_posix(),
            **env,
        },
    )
    calls = log.read_text(encoding="utf-8").splitlines() if log.exists() else []
    return proc, calls


def test_a_mirror_answers_when_the_official_source_does_not(stand):
    proc, calls = _run(
        stand,
        'provision_opkg_update && cat "$PROVISION_OPKG_CONF" && provision_opkg install lftp',
        answer="http://one.example/entware",
    )

    assert proc.returncode == 0, proc.stdout + proc.stderr
    assert calls == [
        "http://router-mirror.invalid/entware",
        "http://bin.entware.net",
        "http://one.example/entware",
        "http://one.example/entware",
    ]
    assert "src/gz entware http://one.example/entware/aarch64-k3.10\n" in proc.stdout
    assert (stand[0] / "opkg.conf").read_text(encoding="utf-8") == ROUTER_CONF


def test_without_wget_ssl_https_sources_are_not_tried(stand):
    proc, calls = _run(stand, "provision_opkg_update || echo refused", answer="https://tls-only.example")

    assert "refused" in proc.stdout
    assert calls == [
        "http://router-mirror.invalid/entware",
        "http://bin.entware.net",
        "http://one.example/entware",
        "http://two.example/entware",
    ]


def test_with_wget_ssl_https_comes_after_http_official_first(stand):
    proc, calls = _run(
        stand, "provision_opkg_update && echo got", answer="https://tls-only.example", wget_ssl=True
    )

    assert "got" in proc.stdout, proc.stdout + proc.stderr
    assert calls == [
        "http://router-mirror.invalid/entware",
        "http://bin.entware.net",
        "http://one.example/entware",
        "http://two.example/entware",
        "https://bin.entware.net",
        "https://one.example/entware",
        "https://tls-only.example",
    ]


def test_a_mirror_without_needed_packages_is_passed_over(stand):
    # Зеркало ответило, но отстало и python3-cryptography в нём нет: ставить с
    # него нечего, берём следующее.
    proc, calls = _run(
        stand,
        'provision_opkg_update && echo "conf=[$PROVISION_OPKG_CONF]" && cat "$PROVISION_OPKG_CONF"',
        answer="http://one.example/entware http://two.example/entware",
        FAKE_OMIT="python3-cryptography",
        FAKE_STALE="http://one.example/entware",
    )

    assert proc.returncode == 0, proc.stdout + proc.stderr
    assert "python3-cryptography" in proc.stdout
    assert "src/gz entware http://two.example/entware/aarch64-k3.10\n" in proc.stdout
    assert calls[-1] == "http://two.example/entware"


def test_a_mirror_without_optional_packages_is_still_used(stand):
    proc, _calls = _run(
        stand, "provision_opkg_update && cat \"$PROVISION_OPKG_CONF\"", answer="http://one.example/entware", FAKE_OMIT="lftp"
    )

    assert proc.returncode == 0, proc.stdout + proc.stderr
    assert "src/gz entware http://one.example/entware/aarch64-k3.10\n" in proc.stdout


def test_the_source_of_the_router_is_not_asked_twice(stand):
    tmp_path, _opkg = stand
    (tmp_path / "opkg.conf").write_text(
        ROUTER_CONF.replace("http://router-mirror.invalid/entware", "http://one.example/entware"), encoding="utf-8"
    )

    proc, calls = _run(stand, "provision_opkg_update || echo refused")

    assert "refused" in proc.stdout
    assert calls == ["http://one.example/entware", "http://bin.entware.net", "http://two.example/entware"]


def test_without_a_mirror_list_only_the_official_source_is_tried(stand):
    proc, calls = _run(stand, "provision_opkg_update || echo refused", XKEEN_ENTWARE_MIRRORS="/nonexistent/list")

    assert "refused" in proc.stdout
    assert calls == ["http://router-mirror.invalid/entware", "http://bin.entware.net"]


def test_what_was_tried_is_left_in_the_log(stand):
    proc, _calls = _run(stand, "provision_opkg_update || echo refused")

    assert "http://two.example/entware" in proc.stdout
    assert "Ни один источник Entware не ответил" in proc.stdout


def test_the_source_that_answered_is_named_in_the_log(stand):
    proc, _calls = _run(stand, "provision_opkg_update", answer="http://two.example/entware")

    assert "Список пакетов получен с http://two.example/entware" in proc.stdout, proc.stdout + proc.stderr


def test_temporary_settings_of_failed_sources_do_not_pile_up(stand):
    tmp_path, _opkg = stand

    proc, _calls = _run(stand, "provision_opkg_update; provision_opkg_cleanup; echo done", answer="http://two.example/entware")

    assert "done" in proc.stdout
    assert not [p.name for p in tmp_path.iterdir() if p.name.startswith("xkeen-opkg")]


def test_spare_sources_get_the_shorter_limit(stand):
    proc, _calls = _run(
        stand,
        'provision_opkg_spare_limit',
        XKEEN_OPKG_UPDATE_TIMEOUT="120",
        XKEEN_OPKG_MIRROR_TIMEOUT="30",
    )
    assert proc.stdout.strip() == "30"

    proc, _calls = _run(stand, "provision_opkg_spare_limit", XKEEN_OPKG_UPDATE_TIMEOUT="5")
    # Запасной предел не больше основного.
    assert proc.stdout.strip() == "5"


def test_the_list_comes_from_the_archive_being_installed():
    install = INSTALL.read_text(encoding="utf-8")
    lib = LIB.read_text(encoding="utf-8")

    after_source = install.split('. "$PROVISION_LIB"', 1)[1]
    assert 'PROVISION_MIRRORS_FILE="$SRC_DIR/scripts/entware_mirrors.txt"' in after_source
    # Запуск командой (обновление из панели) — список рядом со скриптом.
    command_mode = lib.rsplit('case "${0##*/}" in', 1)[1]
    assert 'PROVISION_MIRRORS_FILE="$(dirname "$0")/entware_mirrors.txt"' in command_mode
