"""opkg получает списки по https через wget-ssl, а не через wget из BusyBox.

opkg качает списки и пакеты командой `wget` из PATH. На роутерах первым в PATH
стоит wget из BusyBox (/opt/usr/bin/wget), а он на https падает с Segmentation
fault: у владельца с источником по https в opkg.conf установка останавливалась,
хотя wget-ssl на роутере был. Поэтому wget-ssl — обязательный пакет, и на время
своих вызовов opkg установщик ставит его первым в PATH. Системный PATH и ссылки
в /opt/bin не меняются.
"""

from __future__ import annotations

import os
import subprocess
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[1]
LIB = ROOT / "xkeen-ui" / "scripts" / "provision_env.sh"
INSTALL = ROOT / "xkeen-ui" / "install.sh"

CONF = """src/gz entware https://bin.entware.net/aarch64-k3.10
dest root /
lists_dir ext /opt/var/opkg-lists
arch aarch64-3.10 150
"""

# Подставной opkg: пишет вызов и то, какой `wget` он бы запустил. На
# `install wget-ssl ca-bundle` кладёт исполняемый wget-ssl и сертификаты туда,
# где их ждёт установщик.
FAKE_OPKG = """#!/bin/sh
echo "$* | wget=$(wget 2>/dev/null || echo busybox)" >> "$FAKE_LOG"
case "$*" in
  *"install wget-ssl ca-bundle"*)
    [ "$FAKE_INSTALL" = "fail" ] && exit 1
    mkdir -p "$(dirname "$XKEEN_WGET_SSL")" "$XKEEN_SSL_CERTS"
    echo cert > "$XKEEN_SSL_CERTS/ca-certificates.crt"
    printf '#!/bin/sh\\necho ssl\\n' > "$XKEEN_WGET_SSL"
    chmod +x "$XKEEN_WGET_SSL"
    ;;
esac
exit 0
"""


@pytest.fixture
def stand(tmp_path):
    opkg = tmp_path / "bin" / "opkg"
    opkg.parent.mkdir()
    opkg.write_bytes(FAKE_OPKG.encode("utf-8"))
    os.chmod(opkg, 0o755)
    conf = tmp_path / "opkg.conf"
    conf.write_text(CONF, encoding="utf-8")
    return tmp_path, opkg


def _put_wget_ssl(tmp_path: Path) -> Path:
    target = tmp_path / "libexec" / "wget-ssl"
    target.parent.mkdir(exist_ok=True)
    target.write_bytes(b"#!/bin/sh\necho ssl\n")
    os.chmod(target, 0o755)
    certs = tmp_path / "certs"
    certs.mkdir(exist_ok=True)
    (certs / "ca-certificates.crt").write_text("cert", encoding="utf-8")
    return target


def _run(stand, body: str, **env: str) -> tuple[subprocess.CompletedProcess, list[str]]:
    tmp_path, opkg = stand
    log = tmp_path / "opkg.log"
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
            "XKEEN_OPKG_CONF": (tmp_path / "opkg.conf").as_posix(),
            "XKEEN_OPKG_UPDATE_TIMEOUT": "5",
            "XKEEN_WGET_SSL": (tmp_path / "libexec" / "wget-ssl").as_posix(),
            "XKEEN_SSL_CERTS": (tmp_path / "certs").as_posix(),
            "TMPDIR": tmp_path.as_posix(),
            **env,
        },
    )
    calls = log.read_text(encoding="utf-8").splitlines() if log.exists() else []
    return proc, calls


def test_opkg_downloads_through_wget_ssl_when_it_is_there(stand):
    tmp_path, _opkg = stand
    _put_wget_ssl(tmp_path)

    proc, calls = _run(stand, "provision_opkg_update && provision_opkg install lftp")

    assert proc.returncode == 0, proc.stdout + proc.stderr
    assert calls == ["update | wget=ssl", "install lftp | wget=ssl"]


def test_without_wget_ssl_opkg_is_left_as_it_was(stand):
    proc, calls = _run(stand, 'provision_opkg_update && echo "path=[$PATH]"')

    assert proc.returncode == 0, proc.stdout + proc.stderr
    assert calls == ["update | wget=busybox"]
    assert "xkeen-wget" not in proc.stdout


def test_the_substitution_is_undone_afterwards(stand):
    tmp_path, _opkg = stand
    _put_wget_ssl(tmp_path)

    proc, _calls = _run(
        stand,
        'before="$PATH"; provision_opkg_update; provision_opkg_cleanup; '
        '[ "$PATH" = "$before" ] && echo restored',
    )

    assert "restored" in proc.stdout, proc.stdout + proc.stderr
    assert not [path.name for path in tmp_path.iterdir() if path.name.startswith("xkeen-wget")]


def test_a_missing_wget_ssl_is_installed_and_used_at_once(stand):
    proc, calls = _run(stand, "provision_wget_ssl && provision_opkg install lftp")

    assert proc.returncode == 0, proc.stdout + proc.stderr
    assert calls == ["update | wget=busybox", "install wget-ssl ca-bundle | wget=busybox", "install lftp | wget=ssl"]


def test_wget_ssl_without_root_certificates_is_completed(stand):
    # wget-ssl без корневых сертификатов не проверит ни один https-источник.
    tmp_path, _opkg = stand
    _put_wget_ssl(tmp_path)
    for cert in (tmp_path / "certs").iterdir():
        cert.unlink()

    proc, calls = _run(stand, "provision_wget_ssl && echo ready")

    assert "ready" in proc.stdout, proc.stdout + proc.stderr
    assert calls[-1].startswith("install wget-ssl ca-bundle")


def test_a_present_wget_ssl_costs_no_request(stand):
    tmp_path, _opkg = stand
    _put_wget_ssl(tmp_path)

    proc, calls = _run(stand, "provision_wget_ssl && echo ready")

    assert "ready" in proc.stdout, proc.stdout + proc.stderr
    assert calls == []


def test_a_failed_install_is_reported_but_does_not_stop_the_work(stand):
    # Панель работает и без wget-ssl: из-за него не обрывается ни установка, ни
    # обновление, которое сейчас проходит. Владелец видит, что поставить руками.
    proc, calls = _run(stand, "provision_wget_ssl || echo missing", FAKE_INSTALL="fail")

    assert "missing" in proc.stdout, proc.stdout + proc.stderr
    assert "opkg install wget-ssl ca-bundle" in proc.stdout
    assert calls[-1].startswith("install wget-ssl ca-bundle")


def test_the_installer_and_the_panel_update_both_ensure_wget_ssl():
    install = INSTALL.read_text(encoding="utf-8")
    lib = LIB.read_text(encoding="utf-8")
    prepare = lib.split("provision_cmd_prepare() {", 1)[1].split("\n}\n", 1)[0]

    assert "provision_wget_ssl" in install
    assert "provision_wget_ssl" in prepare
