"""Последняя ступень: wget-ssl через curl, когда по http не ответил никто.

При первой установке wget-ssl ещё нет, а wget из BusyBox на https падает. Если
ни один источник по http не ответил, установщик берёт curl (он умеет https):
качает список пакетов, находит wget-ssl, ca-bundle и то из их зависимостей, чего
на роутере нет, сверяет SHA256 по списку и ставит пакеты из файлов. Дальше opkg
идёт к источникам по https обычным путём.
"""

from __future__ import annotations

import gzip
import hashlib
import os
import subprocess
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[1]
LIB = ROOT / "xkeen-ui" / "scripts" / "provision_env.sh"

ROUTER_CONF = """src/gz entware http://router-mirror.invalid/entware/aarch64-k3.10
dest root /
lists_dir ext /opt/var/opkg-lists
arch aarch64-3.10 150
"""
MIRRORS = "http://one.example/entware\nhttps://one.example/entware\n"
OFFICIAL_HTTPS = "https://bin.entware.net"

PACKAGES = {
    "wget-ssl": ("libc, libpcre2, zlib, libopenssl", "wget-ssl, wget"),
    "ca-bundle": ("libc", "ca-certs"),
    "libc": ("", ""),
    "libpcre2": ("libc", ""),
    "zlib": ("libc", ""),
    "libopenssl": ("libc, zlib", ""),
    "lftp": ("libc, libopenssl", ""),
}

# opkg: `update` отвечает только источникам из FAKE_ANSWER, `list-installed` —
# то, что уже стоит, `install` из файлов кладёт wget-ssl и сертификаты.
FAKE_OPKG = """#!/bin/sh
conf="$XKEEN_OPKG_CONF"
prev=""
for arg in "$@"; do [ "$prev" = "-f" ] && conf="$arg"; prev="$arg"; done
case "$*" in
  list-installed) printf 'libc - 1\\nzlib - 1\\n'; exit 0 ;;
  *update)
    source="$(sed -n 's#^src/gz[[:space:]]*[^[:space:]]*[[:space:]]*\\(.*\\)/aarch64-k3.10.*#\\1#p' "$conf" | head -n 1)"
    echo "update $source" >> "$FAKE_LOG"
    case " $FAKE_ANSWER " in *" $source "*) exit 0 ;; esac
    exit 1 ;;
  install*)
    shift
    names=""
    for f in "$@"; do names="$names ${f##*/}"; done
    echo "install$names" >> "$FAKE_LOG"
    mkdir -p "$(dirname "$XKEEN_WGET_SSL")" "$XKEEN_SSL_CERTS"
    printf '#!/bin/sh\\nexit 0\\n' > "$XKEEN_WGET_SSL"; chmod +x "$XKEEN_WGET_SSL"
    echo cert > "$XKEEN_SSL_CERTS/ca-certificates.crt"
    exit 0 ;;
esac
exit 0
"""

# curl: отдаёт файлы из FAKE_REPO по пути `хост/путь`; без https, если просили.
FAKE_CURL = """#!/bin/sh
if [ "$1" = "--version" ]; then
  echo "curl 8.15.0"
  [ -n "$FAKE_CURL_NO_TLS" ] && echo "Protocols: http" || echo "Protocols: http https"
  exit 0
fi
out=""; url=""; prev=""
for arg in "$@"; do
  [ "$prev" = "-o" ] && out="$arg"
  prev="$arg"; url="$arg"
done
echo "curl $url" >> "$FAKE_LOG"
src="$FAKE_REPO/${url#*://}"
[ -f "$src" ] || exit 22
cp "$src" "$out"
"""


def _ipk_name(name: str) -> str:
    return f"{name}_1.0_aarch64-3.10.ipk"


def _publish(repo: Path, base: str, *, tamper: str = "") -> None:
    root = repo / base.split("://", 1)[1] / "aarch64-k3.10"
    root.mkdir(parents=True, exist_ok=True)
    stanzas = []
    for name, (depends, provides) in PACKAGES.items():
        payload = f"package {name}\n".encode()
        (root / _ipk_name(name)).write_bytes(payload)
        digest = hashlib.sha256(b"tampered" if name == tamper else payload).hexdigest()
        lines = [f"Package: {name}", "Version: 1.0"]
        if depends:
            lines.append(f"Depends: {depends}")
        if provides:
            lines.append(f"Provides: {provides}")
        lines += [f"Filename: {_ipk_name(name)}", f"SHA256sum: {digest}", ""]
        stanzas.append("\n".join(lines))
    (root / "Packages.gz").write_bytes(gzip.compress("\n".join(stanzas).encode()))


@pytest.fixture
def stand(tmp_path):
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    for name, text in (("opkg", FAKE_OPKG), ("curl", FAKE_CURL)):
        (bin_dir / name).write_bytes(text.encode("utf-8"))
        os.chmod(bin_dir / name, 0o755)
    (tmp_path / "opkg.conf").write_text(ROUTER_CONF, encoding="utf-8")
    (tmp_path / "mirrors.txt").write_text(MIRRORS, encoding="utf-8")
    (tmp_path / "repo").mkdir()
    return tmp_path


def _run(tmp_path: Path, body: str, *, answer: str = "", curl: bool = True, **env: str):
    log = tmp_path / "calls.log"
    script = tmp_path / "call.sh"
    script.write_bytes(
        "\n".join(
            ["set -e", f'. "{LIB.as_posix()}"', f'OPKG_BIN="{(tmp_path / "bin" / "opkg").as_posix()}"', body, ""]
        ).encode("utf-8")
    )
    fake_curl = tmp_path / "bin" / "curl" if curl else tmp_path / "no-curl"
    proc = subprocess.run(
        ["sh", script.as_posix()],
        capture_output=True,
        text=True,
        encoding="utf-8",
        env={
            **os.environ,
            "XKEEN_CURL": fake_curl.as_posix(),
            "FAKE_LOG": log.as_posix(),
            "FAKE_ANSWER": answer,
            "FAKE_REPO": (tmp_path / "repo").as_posix(),
            "XKEEN_OPKG_CONF": (tmp_path / "opkg.conf").as_posix(),
            "XKEEN_ENTWARE_MIRRORS": (tmp_path / "mirrors.txt").as_posix(),
            "XKEEN_WGET_SSL": (tmp_path / "libexec" / "wget-ssl").as_posix(),
            "XKEEN_SSL_CERTS": (tmp_path / "certs").as_posix(),
            "XKEEN_OPKG_UPDATE_TIMEOUT": "5",
            "TMPDIR": tmp_path.as_posix(),
            **env,
        },
    )
    calls = log.read_text(encoding="utf-8").splitlines() if log.exists() else []
    return proc, calls


def test_wget_ssl_is_brought_by_curl_and_https_is_tried_after(stand):
    _publish(stand / "repo", OFFICIAL_HTTPS)

    proc, calls = _run(stand, "provision_opkg_update && echo got", answer=OFFICIAL_HTTPS)

    assert "got" in proc.stdout, proc.stdout + proc.stderr
    http = ["update http://router-mirror.invalid/entware", "update http://bin.entware.net", "update http://one.example/entware"]
    assert calls[:3] == http
    assert calls[3] == "curl https://bin.entware.net/aarch64-k3.10/Packages.gz"
    install = [line for line in calls if line.startswith("install")]
    # libc и zlib уже стоят: их не качаем.
    assert install == [
        "install " + " ".join(_ipk_name(n) for n in ("wget-ssl", "ca-bundle", "libpcre2", "libopenssl"))
    ]
    assert not [line for line in calls if "libc_" in line or "zlib_" in line or "lftp" in line]
    assert calls[-1] == f"update {OFFICIAL_HTTPS}"


def test_the_list_is_taken_from_a_mirror_if_the_official_source_is_silent(stand):
    _publish(stand / "repo", "https://one.example/entware")

    proc, calls = _run(stand, "provision_opkg_update && echo got", answer="https://one.example/entware")

    assert "got" in proc.stdout, proc.stdout + proc.stderr
    assert "curl https://one.example/entware/aarch64-k3.10/Packages.gz" in calls
    assert f"curl https://one.example/entware/aarch64-k3.10/{_ipk_name('wget-ssl')}" in calls


def test_a_package_that_does_not_match_its_checksum_is_not_installed(stand):
    _publish(stand / "repo", OFFICIAL_HTTPS, tamper="libopenssl")

    proc, calls = _run(stand, "provision_opkg_update || echo refused", answer=OFFICIAL_HTTPS)

    assert "refused" in proc.stdout
    assert not [line for line in calls if line.startswith("install")]
    assert "SHA256" in proc.stdout


def test_curl_without_tls_is_of_no_use(stand):
    _publish(stand / "repo", OFFICIAL_HTTPS)

    proc, calls = _run(stand, "provision_opkg_update || echo refused", answer=OFFICIAL_HTTPS, FAKE_CURL_NO_TLS="1")

    assert "refused" in proc.stdout
    assert not [line for line in calls if line.startswith("curl")]
    assert "opkg install wget-ssl ca-bundle" in proc.stdout


def test_without_curl_the_owner_is_told_what_to_do(stand):
    proc, calls = _run(stand, "provision_opkg_update || echo refused", answer=OFFICIAL_HTTPS, curl=False)

    assert "refused" in proc.stdout
    assert "opkg install wget-ssl ca-bundle" in proc.stdout


def test_with_wget_ssl_in_place_curl_is_not_needed(stand):
    wget = stand / "libexec" / "wget-ssl"
    wget.parent.mkdir()
    wget.write_bytes(b"#!/bin/sh\nexit 0\n")
    os.chmod(wget, 0o755)
    (stand / "certs").mkdir()
    (stand / "certs" / "ca-certificates.crt").write_text("cert", encoding="utf-8")

    proc, calls = _run(stand, "provision_opkg_update || echo refused")

    assert "refused" in proc.stdout
    assert not [line for line in calls if line.startswith("curl")]


def test_the_downloaded_packages_do_not_stay_behind(stand):
    _publish(stand / "repo", OFFICIAL_HTTPS)

    proc, _calls = _run(stand, "provision_opkg_update; provision_opkg_cleanup; echo done", answer=OFFICIAL_HTTPS)

    assert "done" in proc.stdout
    assert not [p.name for p in stand.iterdir() if p.name.startswith(("xkeen-opkg", "xkeen-bootstrap", "xkeen-wget"))]
