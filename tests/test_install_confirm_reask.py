"""Непонятный ответ на вопрос установщика — не согласие.

Вопросы «Установить? [Y/n]» принимали за «да» всё, что не похоже на «нет»:
опечатку, букву в другой раскладке, случайный символ. Человек, нажавший «и»,
получал дополнение, которого не выбирал, и нигде об этом не узнавал. Теперь
установщик переспрашивает, а если ответа так и не понял — говорит, что выбрал.

Вопрос бывает с «да» и с «нет» по умолчанию: утилиту ссылок подписок ставят
только явным «да», а уже стоящий просмотрщик DAT той же версии, что в релизе,
по умолчанию не переустанавливают.
"""

from __future__ import annotations

import subprocess
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[1]
INSTALLER = ROOT / "xkeen-ui" / "install.sh"


def _confirm_function() -> str:
    text = INSTALLER.read_text(encoding="utf-8")
    start = text.index("ui_confirm() {")
    body = text[start:text.index("\n}\n", start) + 3]
    # В проверке ответы приходят со стандартного ввода, а не с терминала.
    assert "< /dev/tty" in body
    return body.replace(" < /dev/tty", "")


def _ask(tmp_path: Path, answers: str, default: str = "y") -> tuple[str, str, str]:
    script = tmp_path / "ask.sh"
    # Файлом, а не через `sh -c`: длинный сценарий с кириллицей на Windows до
    # оболочки не доходит.
    script.write_bytes(
        "\n".join(
            [
                "set -e",
                "exec 3>&1",
                'UI_GREEN=""; UI_YELLOW=""; UI_RESET=""; UI_ESC=""',
                _confirm_function(),
                f'ui_confirm {default} "Установить?"',
                'echo "answer=[$UI_CONFIRM_ANSWER] yes=[$UI_CONFIRM_YES]"',
                "",
            ]
        ).encode("utf-8")
    )
    proc = subprocess.run(
        ["sh", script.as_posix()], input=answers.encode("utf-8"), capture_output=True, check=False
    )
    out = proc.stdout.decode("utf-8", "replace")
    assert proc.returncode == 0, out + proc.stderr.decode("utf-8", "replace")
    tail = out.rsplit("answer=[", 1)[1]
    answer = tail.split("]", 1)[0]
    yes = tail.split("yes=[", 1)[1].split("]", 1)[0]
    return answer, yes, out


@pytest.mark.parametrize("answer", ["y", "Y", "да", "Д", "n", "N", "нет", "Н", ""])
def test_a_clear_answer_is_taken_at_once(tmp_path, answer):
    got, _yes, out = _ask(tmp_path, answer + "\n")

    assert got == answer
    assert out.count("Установить?") == 1


@pytest.mark.parametrize(
    "default, answer, yes",
    [
        ("y", "", "1"),
        ("y", "n", "0"),
        ("y", "да", "1"),
        ("n", "", "0"),
        ("n", "y", "1"),
        ("n", "Д", "1"),
        ("n", "нет", "0"),
    ],
)
def test_enter_takes_the_offered_choice_and_a_clear_answer_overrides_it(tmp_path, default, answer, yes):
    _got, got_yes, _out = _ask(tmp_path, answer + "\n", default=default)

    assert got_yes == yes


def test_the_prompt_shows_which_choice_is_the_default(tmp_path):
    _got, _yes, out_yes = _ask(tmp_path, "\n", default="y")
    _got, _yes, out_no = _ask(tmp_path, "\n", default="n")

    assert "[Y/n]" in out_yes
    assert "[y/N]" in out_no


def test_an_answer_that_is_neither_yes_nor_no_is_asked_again(tmp_path):
    got, _yes, out = _ask(tmp_path, "и\nn\n")

    assert got == "n"
    assert out.count("Установить?") == 2
    # Человеку сказано, чего от него ждут.
    assert "y" in out.split("Установить?")[1] and "n" in out.split("Установить?")[1]


def test_enter_after_a_slip_still_means_the_offered_choice(tmp_path):
    got, yes, out = _ask(tmp_path, "и\n\n", default="n")

    assert got == ""
    assert yes == "0"
    assert out.count("Установить?") == 2
    assert "просто Enter — нет" in out


def test_after_several_slips_the_installer_says_what_it_chose(tmp_path):
    got, yes, out = _ask(tmp_path, "и\nи\nи\nи\nи\n")

    # Бесконечно спрашивать нельзя: выбирается предложенный вариант, но не молча.
    assert got == ""
    assert yes == "1"
    assert out.count("Установить?") == 3
    assert "по умолчанию: да" in out


def test_after_several_slips_a_no_default_stays_no(tmp_path):
    _got, yes, out = _ask(tmp_path, "и\nи\nи\n", default="n")

    assert yes == "0"
    assert "по умолчанию: нет" in out


def test_a_closed_terminal_does_not_hang_the_question(tmp_path):
    got, yes, out = _ask(tmp_path, "", default="n")

    assert got == ""
    assert yes == "0"
    assert out.count("Установить?") == 1


def _geodat_choice(tmp_path: Path, verdict: str) -> str:
    text = INSTALLER.read_text(encoding="utf-8")
    start = text.index("choose_geodat_option() {")
    body = text[start:text.index("\n}\n", start) + 3]
    src = tmp_path / "src"
    (src / "scripts").mkdir(parents=True)
    (src / "scripts" / "install_xk_geodat.sh").write_bytes(
        ('[ "$XKEEN_GEODAT_CHECK_ONLY" = "1" ] || exit 9\necho "xk-geodat: noise"\necho "%s"\n' % verdict).encode()
    )
    script = tmp_path / "choose.sh"
    script.write_bytes(
        "\n".join(
            [
                "exec 3>&1",
                'UI_DIM=""; UI_BOLD=""; UI_RESET=""',
                f'SRC_DIR="{src.as_posix()}"',
                body,
                "choose_geodat_option",
                'echo "option=[$GEODAT_OPTION]"',
                "",
            ]
        ).encode("utf-8")
    )
    # Без терминала: так установщик запускают из скриптов и обновления.
    proc = subprocess.run(["sh", script.as_posix()], stdin=subprocess.DEVNULL, capture_output=True, check=False)
    out = proc.stdout.decode("utf-8", "replace")
    assert proc.returncode == 0, out + proc.stderr.decode("utf-8", "replace")
    return out.rsplit("option=[", 1)[1].split("]", 1)[0]


@pytest.mark.parametrize("verdict, option", [("same", "0"), ("differs", "1"), ("missing", "1"), ("unknown", "1")])
def test_a_dat_viewer_equal_to_the_release_is_not_reinstalled_by_default(tmp_path, verdict, option):
    assert _geodat_choice(tmp_path, verdict) == option
