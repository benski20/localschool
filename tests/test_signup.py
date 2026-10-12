"""Join with a school email, and forgot password (codes by email, or on screen in the demo)."""

from __future__ import annotations

import re

import pytest
from fastapi.testclient import TestClient

from app.db import connect
from app.services import codes, mail

from .conftest import PASSWORD, login

ADMIN = ("admin@test.local", "admin-pass-123")
SMTP = {"host": "smtp.shipley.demo", "port": 587, "username": "desk", "password": "smtp-secret-pw",
        "from": "Teacher's Desk <desk@shipley.demo>"}


class Outbox(list):
    def __call__(self, cfg: mail.MailConfig, msg) -> None:
        assert cfg.configured()
        self.append(msg)

    def to(self, email: str) -> list:
        return [m for m in self if m["To"] == email]


def code_in(msg) -> str:
    return re.search(r"\b(\d{6})\b", msg.get_content()).group(1)


@pytest.fixture
def outbox(client) -> Outbox:
    box = Outbox()
    client.app.state.mail_sender = box
    return box


def setup(client: TestClient, *, auto_join: bool = True, domains: str = "shipley.demo", email: dict | None = SMTP):
    login(client, *ADMIN)
    body: dict = {"domains": domains, "auto_join": auto_join}
    if email is not None:
        body["email"] = email
    r = client.put("/api/admin/sso", json=body)
    assert r.status_code == 200, r.text
    client.post("/api/auth/logout")
    client.cookies.clear()
    return r.json()


def start(client, email="new.teacher@shipley.demo", name="Casey New"):
    return client.post("/api/auth/signup/start", json={"name": name, "email": email})


def finish(client, code, email="new.teacher@shipley.demo", password="a-good-password"):
    return client.post("/api/auth/signup/finish",
                       json={"email": email, "code": code, "password": password, "name": "Casey New"})


def test_sign_up_happy_path(client, outbox, settings):
    setup(client)
    h = client.get("/api/health").json()
    assert h["signup"] is True and h["reset"] is True and h["signup_domains"] == ["shipley.demo"]
    assert client.get("/api/trust").json()["signup"] is True  # the privacy page says so

    r = start(client)
    assert r.status_code == 200 and r.json() == {"ok": True, "message": "If that address can join, we've emailed a code."}
    [msg] = outbox.to("new.teacher@shipley.demo")
    assert msg["From"] == SMTP["from"] and "code" in msg["Subject"]
    code = code_in(msg)

    r = finish(client, code)
    assert r.status_code == 200, r.text
    assert r.json()["user"]["role"] == "teacher" and r.json()["user"]["name"] == "Casey New"
    assert client.get("/api/auth/me").json()["user"]["email"] == "new.teacher@shipley.demo"
    assert finish(client, code).status_code == 400  # used up

    client.post("/api/auth/logout")
    login(client, "new.teacher@shipley.demo", "a-good-password")
    with connect(settings.db_path) as db:
        acts = [r["action"] for r in db.execute("SELECT action FROM activity ORDER BY id")]
        assert "signup_code" in acts and "signed_up" in acts
        assert not db.execute("SELECT 1 FROM email_codes").fetchone()


def test_codes_are_stored_hashed(client, outbox, settings):
    setup(client)
    start(client)
    code = code_in(outbox[-1])
    with connect(settings.db_path) as db:
        row = db.execute("SELECT * FROM email_codes").fetchone()
    assert code not in row["code_hash"] and len(row["code_hash"]) == 64


def test_wrong_domain_is_refused(client, outbox):
    setup(client)
    r = start(client, email="someone@gmail.com")
    assert r.status_code == 400 and r.json()["error"] == "Use your school email (@shipley.demo)."
    assert finish(client, "123456", email="someone@gmail.com").status_code == 400
    assert not outbox


def test_join_off_or_no_domains_means_no_sign_up(client, outbox):
    setup(client, auto_join=False)
    assert client.get("/api/health").json()["signup"] is False
    assert start(client).status_code == 400
    setup(client, auto_join=True, domains="")
    assert client.get("/api/health").json()["signup"] is False
    assert start(client).status_code == 400
    assert not outbox


def test_no_email_server_means_no_sign_up(client, outbox):
    setup(client, email=None)
    h = client.get("/api/health").json()
    assert h["signup"] is False and h["reset"] is False and "signup_domains" not in h
    assert client.get("/api/trust").json()["signup"] is False
    assert start(client).status_code == 400
    assert client.post("/api/auth/reset/start", json={"email": "jordan.lee@shipley.demo"}).status_code == 400


def test_personal_desk_never_offers_sign_up(client, outbox, settings):
    setup(client)
    settings.local_mode = True
    h = client.get("/api/health").json()
    assert h["signup"] is False and h["reset"] is False
    assert start(client).status_code == 400


def test_existing_email_gets_the_same_answer_and_no_code(client, outbox, settings):
    setup(client)
    new, old = start(client), start(client, email="jordan.lee@shipley.demo")
    assert new.status_code == old.status_code == 200 and new.json() == old.json()
    [msg] = outbox.to("jordan.lee@shipley.demo")
    assert "already have" in msg["Subject"] and "Forgot password" in msg.get_content()
    assert not re.search(r"\b\d{6}\b", msg.get_content())
    with connect(settings.db_path) as db:
        assert not db.execute("SELECT 1 FROM email_codes WHERE email = 'jordan.lee@shipley.demo'").fetchone()
    assert finish(client, "000000", email="jordan.lee@shipley.demo").status_code == 400
    login(client, "jordan.lee@shipley.demo", PASSWORD)  # untouched


def test_wrong_code_and_too_many_tries(client, outbox):
    setup(client)
    start(client)
    code = code_in(outbox[-1])
    wrong = f"{(int(code) + 1) % 10**6:06d}"
    r = finish(client, wrong)
    assert r.status_code == 400 and "isn't right" in r.json()["error"]
    for _ in range(codes.MAX_ATTEMPTS - 1):
        assert finish(client, wrong).status_code == 400
    r = finish(client, code)  # right code, but the tries are used up
    assert r.status_code == 400 and "Too many tries" in r.json()["error"]
    assert client.get("/api/auth/me").status_code == 401


def test_expired_code(client, outbox, settings):
    setup(client)
    start(client)
    code = code_in(outbox[-1])
    with connect(settings.db_path) as db:
        db.execute("UPDATE email_codes SET expires_at = datetime('now', '-1 minute')")
    r = finish(client, code)
    assert r.status_code == 400 and "expired" in r.json()["error"]


def test_a_new_code_replaces_the_old_one(client, outbox):
    setup(client)
    start(client)
    first = code_in(outbox[-1])
    start(client)
    second = code_in(outbox[-1])
    if first != second:
        assert finish(client, first).status_code == 400
    assert finish(client, second).status_code == 200


def test_short_password_keeps_the_code(client, outbox):
    setup(client)
    start(client)
    code = code_in(outbox[-1])
    r = finish(client, code, password="short")
    assert r.status_code == 400 and "8 characters" in r.json()["error"]
    assert finish(client, code).status_code == 200


def test_rate_limits_per_email_and_per_address(client, outbox):
    setup(client)
    for _ in range(codes.PER_EMAIL_HOUR):
        assert start(client).status_code == 200
    r = start(client)
    assert r.status_code == 429 and "Wait an hour" in r.json()["error"]
    # the limit counts requests, not accounts: an existing email is limited the same way
    for _ in range(codes.PER_EMAIL_HOUR):
        assert start(client, email="jordan.lee@shipley.demo").status_code == 200
    assert start(client, email="jordan.lee@shipley.demo").status_code == 429

    sent = 2 * codes.PER_EMAIL_HOUR
    for i in range(codes.PER_IP_HOUR - sent):
        assert start(client, email=f"t{i}@shipley.demo").status_code == 200
    assert start(client, email="fresh@shipley.demo").status_code == 429
    other = client.post("/api/auth/signup/start", json={"email": "fresh@shipley.demo"},
                        headers={"X-Forwarded-For": "203.0.113.9"})
    assert other.status_code == 200


def test_demo_shows_the_code_on_screen(client, outbox, settings):
    settings.demo_logins = True
    setup(client, email=None)
    h = client.get("/api/health").json()
    assert h["signup"] is True and h["reset"] is True
    r = start(client)
    code = r.json()["demo_code"]
    assert re.fullmatch(r"\d{6}", code) and not outbox
    assert "demo_code" not in start(client, email="jordan.lee@shipley.demo").json()
    assert finish(client, code).status_code == 200

    # demo reset: teachers yes; never an administrator's password
    client.cookies.clear()
    r = client.post("/api/auth/reset/start", json={"email": "jordan.lee@shipley.demo"}).json()
    assert re.fullmatch(r"\d{6}", r["demo_code"])
    admin = client.post("/api/auth/reset/start", json={"email": ADMIN[0]}).json()
    assert "demo_code" not in admin and admin["ok"] is True
    nobody = client.post("/api/auth/reset/start", json={"email": "nobody@shipley.demo"}).json()
    assert "demo_code" not in nobody and admin == nobody


def test_demo_never_returns_codes_once_email_is_set_up(client, outbox, settings):
    settings.demo_logins = True
    setup(client)
    r = start(client)
    assert "demo_code" not in r.json() and len(outbox) == 1
    r = client.post("/api/auth/reset/start", json={"email": "jordan.lee@shipley.demo"})
    assert "demo_code" not in r.json() and len(outbox) == 2


def test_no_codes_shown_outside_the_demo(client, outbox):
    setup(client)
    assert "demo_code" not in start(client).json()
    assert "demo_code" not in client.post("/api/auth/reset/start", json={"email": "jordan.lee@shipley.demo"}).json()


def test_reset_sets_the_password_and_ends_other_sessions(client, outbox, settings):
    setup(client)
    other = TestClient(client.app)
    login(other, "jordan.lee@shipley.demo")
    assert other.get("/api/auth/me").status_code == 200

    nobody = client.post("/api/auth/reset/start", json={"email": "nobody@shipley.demo"})
    r = client.post("/api/auth/reset/start", json={"email": "Jordan.Lee@shipley.demo"})
    assert r.status_code == nobody.status_code == 200 and r.json() == nobody.json()
    assert not outbox.to("nobody@shipley.demo")
    [msg] = outbox.to("jordan.lee@shipley.demo")
    code = code_in(msg)

    bad = client.post("/api/auth/reset/finish", json={"email": "jordan.lee@shipley.demo", "code": "x", "password": "new-pass-456"})
    assert bad.status_code == 400
    r = client.post("/api/auth/reset/finish", json={"email": "jordan.lee@shipley.demo", "code": code, "password": "new-pass-456"})
    assert r.status_code == 200 and r.json()["user"]["email"] == "jordan.lee@shipley.demo"
    assert client.get("/api/auth/me").status_code == 200        # this browser: signed in
    assert other.get("/api/auth/me").status_code == 401         # elsewhere: signed out
    assert client.post("/api/auth/login", json={"email": "jordan.lee@shipley.demo", "password": PASSWORD}).status_code == 401
    login(client, "jordan.lee@shipley.demo", "new-pass-456")
    with connect(settings.db_path) as db:
        assert db.execute("SELECT 1 FROM activity WHERE action = 'password_reset'").fetchone()


def test_admin_email_settings_never_return_the_password(client, outbox, settings):
    login(client, *ADMIN)
    r = client.put("/api/admin/sso", json={"email": SMTP})
    assert r.status_code == 200 and SMTP["password"] not in r.text
    e = r.json()["email"]
    assert e["has_password"] is True and e["configured"] is True and e["host"] == SMTP["host"]
    # an empty password keeps the saved one
    r = client.put("/api/admin/sso", json={"email": {**SMTP, "password": "", "port": 465}})
    assert r.json()["email"]["port"] == 465 and r.json()["email"]["has_password"]
    with connect(settings.db_path) as db:
        assert mail.load(db, settings).password == SMTP["password"]
    assert client.put("/api/admin/sso", json={"email": {"port": "abc"}}).status_code == 400

    r = client.post("/api/admin/sso/test-email", json={})
    assert r.status_code == 200 and r.json()["to"] == ADMIN[0]
    assert outbox.to(ADMIN[0])

    def broken(cfg, msg):
        raise mail.MailError("The mail server didn't accept the username or password.")
    client.app.state.mail_sender = broken
    r = client.post("/api/admin/sso/test-email", json={})
    assert r.status_code == 400 and "didn't accept" in r.json()["error"]

    login(client, "jordan.lee@shipley.demo")
    assert client.get("/api/admin/sso").status_code == 403
    assert client.post("/api/admin/sso/test-email", json={}).status_code == 403


def test_environment_overrides_saved_email_settings(client, settings):
    settings.smtp_host = "relay.it.example"
    settings.smtp_from = "desk@it.example"
    with connect(settings.db_path) as db:
        mail.save(db, {"host": "smtp.saved", "from": "saved@x.example", "port": 2525})
        cfg = mail.load(db, settings)
    assert cfg.host == "relay.it.example" and cfg.sender == "desk@it.example" and cfg.port == 2525
    assert set(cfg.public()["from_env"]) == {"host", "from"}


class FakeSMTP:
    calls: list = []
    tls = True

    def __init__(self, host, port, timeout=None, context=None):
        FakeSMTP.calls.append(("connect", host, port, type(self).__name__))

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def ehlo(self):
        pass

    def has_extn(self, name):
        return FakeSMTP.tls and name == "starttls"

    def starttls(self, context=None):
        FakeSMTP.calls.append(("starttls",))

    def login(self, user, pw):
        FakeSMTP.calls.append(("login", user, pw))

    def send_message(self, msg):
        FakeSMTP.calls.append(("send", msg["To"]))


class FakeSMTPSSL(FakeSMTP):
    pass


def test_smtp_uses_starttls_or_ssl_and_refuses_plain_text(monkeypatch):
    monkeypatch.setattr(mail.smtplib, "SMTP", FakeSMTP)
    monkeypatch.setattr(mail.smtplib, "SMTP_SSL", FakeSMTPSSL)
    cfg = mail.MailConfig(host="smtp.x.example", port=587, username="u", password="p", sender="desk@x.example")
    FakeSMTP.calls = []
    mail.send_smtp(cfg, mail.message(cfg, "t@x.example", "Hi", "Body"))
    assert FakeSMTP.calls == [("connect", "smtp.x.example", 587, "FakeSMTP"), ("starttls",), ("login", "u", "p"),
                              ("send", "t@x.example")]
    FakeSMTP.calls = []
    ssl_cfg = mail.MailConfig(host="smtp.x.example", port=465, username="", password="", sender="desk@x.example")
    mail.send_smtp(ssl_cfg, mail.message(ssl_cfg, "t@x.example", "Hi", "Body"))
    assert FakeSMTP.calls == [("connect", "smtp.x.example", 465, "FakeSMTPSSL"), ("send", "t@x.example")]
    FakeSMTP.tls = False
    try:
        with pytest.raises(mail.MailError, match="encrypted"):
            mail.send_smtp(cfg, mail.message(cfg, "t@x.example", "Hi", "Body"))
    finally:
        FakeSMTP.tls = True
