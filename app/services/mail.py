"""Sending email: sign-up codes and password resets, through the school's own mail server.

Python's built-in smtplib, nothing else: STARTTLS on the usual submission port (587), or
SSL from the start on port 465. Settings live in the settings table (Settings › People ›
Who can join › Email); SMTP_* environment variables override them, for IT. The password is
never sent back to the browser.

Tests swap the sender: `app.state.mail_sender = fake` (any callable taking the config and
an EmailMessage).
"""

from __future__ import annotations

import smtplib
import sqlite3
import ssl
from collections.abc import Callable
from dataclasses import dataclass
from email.message import EmailMessage
from email.utils import make_msgid, parseaddr

from ..config import Settings

DEFAULT_PORT = 587
TIMEOUT_S = 20
_FIELDS = ("host", "port", "username", "password", "from")
_ENV = {"host": "smtp_host", "port": "smtp_port", "username": "smtp_user", "password": "smtp_password",
        "from": "smtp_from"}
_LOCAL_HOSTS = ("localhost", "127.0.0.1", "::1")


class MailError(Exception):
    """Shown to the admin as is."""


@dataclass(frozen=True)
class MailConfig:
    host: str
    port: int
    username: str
    password: str
    sender: str
    from_env: tuple[str, ...] = ()

    def configured(self) -> bool:
        return bool(self.host and "@" in parseaddr(self.sender)[1])

    def public(self) -> dict:
        return {
            "host": self.host,
            "port": self.port,
            "username": self.username,
            "has_password": bool(self.password),
            "from": self.sender,
            "configured": self.configured(),
            "from_env": list(self.from_env),  # set by IT on the server; saving here won't change them
        }


Sender = Callable[[MailConfig, EmailMessage], None]


def load(db: sqlite3.Connection, settings: Settings) -> MailConfig:
    vals = {k: "" for k in _FIELDS}
    for row in db.execute(f"SELECT key, value FROM settings WHERE key IN ({','.join('?' * len(_FIELDS))})",
                          [f"smtp_{k}" for k in _FIELDS]):
        vals[row["key"][5:]] = row["value"]
    from_env = []
    for k, attr in _ENV.items():
        env = getattr(settings, attr)
        if env not in ("", 0, None):
            vals[k] = str(env)
            from_env.append(k)
    try:
        port = int(vals["port"] or DEFAULT_PORT)
    except ValueError:
        port = DEFAULT_PORT
    return MailConfig(host=vals["host"].strip(), port=port, username=vals["username"].strip(),
                      password=vals["password"], sender=vals["from"].strip(), from_env=tuple(from_env))


def save(db: sqlite3.Connection, values: dict) -> None:
    """Only the keys given (host, port, username, password, from); an empty or missing
    password keeps the saved one."""
    for k in _FIELDS:
        v = values.get(k)
        if v is None or (k == "password" and v == ""):
            continue
        if k == "port":
            try:
                v = int(v) if str(v).strip() else DEFAULT_PORT
            except ValueError as e:
                raise MailError("The port must be a number, usually 587.") from e
            if not 0 < v < 65536:
                raise MailError("The port must be a number, usually 587.")
        if k == "from" and v and "@" not in parseaddr(str(v))[1]:
            raise MailError("The from address must be an email address.")
        db.execute("INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                   (f"smtp_{k}", str(v) if k == "password" else str(v).strip()))


def message(cfg: MailConfig, to: str, subject: str, body: str) -> EmailMessage:
    msg = EmailMessage()
    msg["From"] = cfg.sender
    msg["To"] = to
    msg["Subject"] = subject
    msg["Message-ID"] = make_msgid(domain=parseaddr(cfg.sender)[1].rsplit("@", 1)[-1] or None)
    msg.set_content(body)
    return msg


def send_smtp(cfg: MailConfig, msg: EmailMessage) -> None:
    """Deliver one message. Codes never travel unencrypted except to a relay on this machine."""
    if not cfg.configured():
        raise MailError("Email isn't set up yet.")
    context = ssl.create_default_context()
    try:
        if cfg.port == 465:
            server: smtplib.SMTP = smtplib.SMTP_SSL(cfg.host, cfg.port, timeout=TIMEOUT_S, context=context)
        else:
            server = smtplib.SMTP(cfg.host, cfg.port, timeout=TIMEOUT_S)
        with server:
            if cfg.port != 465:
                server.ehlo()
                if server.has_extn("starttls"):
                    server.starttls(context=context)
                    server.ehlo()
                elif cfg.host not in _LOCAL_HOSTS:
                    raise MailError(f"{cfg.host} doesn't offer an encrypted connection (STARTTLS). Try port 465.")
            if cfg.username:
                server.login(cfg.username, cfg.password)
            server.send_message(msg)
    except MailError:
        raise
    except smtplib.SMTPAuthenticationError as e:
        raise MailError("The mail server didn't accept the username or password.") from e
    except (smtplib.SMTPException, OSError) as e:
        raise MailError(f"Couldn't send email through {cfg.host}:{cfg.port} ({e.__class__.__name__}: {e}).") from e


def sender_for(app_state) -> Sender:
    sender = getattr(app_state, "mail_sender", None)
    return send_smtp if sender is None else sender
