"""Set or check admin@school.local's password in a copy of the hosted database (stdlib only).

Used by the Deploy Modal workflow while the app is stopped. The password comes from the
ADMIN_PW environment variable and is never printed.

    ADMIN_PW=… python3 scripts/admin_pw_file.py set|check path/to/localschool.db
"""

import hashlib
import hmac
import os
import secrets
import sqlite3
import sys

EMAIL = "admin@school.local"
N, R, P = 2**14, 8, 1  # same format as app/services/auth.py


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode(), salt=salt, n=N, r=R, p=P, dklen=32)
    return f"scrypt${N}${R}${P}${salt.hex()}${digest.hex()}"


def verify(password: str, stored: str) -> bool:
    _, n, r, p, salt, digest = stored.split("$")
    calc = hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt), n=int(n), r=int(r), p=int(p),
                          dklen=len(bytes.fromhex(digest)))
    return hmac.compare_digest(calc.hex(), digest)


def main() -> None:
    action, path = sys.argv[1], sys.argv[2]
    password = os.environ["ADMIN_PW"].strip()
    db = sqlite3.connect(path)
    db.row_factory = sqlite3.Row
    row = db.execute("SELECT id, role, password_hash FROM users WHERE email = ?", (EMAIL,)).fetchone()
    if action == "check":
        print(f"admin account exists: {row is not None}"
              + (f" | role: {row['role']} | password matches the secret: {verify(password, row['password_hash'])}" if row else ""))
        print(f"accounts in the database: {db.execute('SELECT COUNT(*) FROM users').fetchone()[0]}")
        return
    if len(password) < 8:
        sys.exit("The LS_ADMIN_PASSWORD secret must be at least 8 characters.")
    if row is None:
        db.execute("INSERT INTO users(email, name, role, password_hash) VALUES (?, 'Administrator', 'admin', ?)",
                   (EMAIL, hash_password(password)))
    else:
        db.execute("UPDATE users SET password_hash = ?, role = 'admin' WHERE id = ?", (hash_password(password), row["id"]))
        db.execute("DELETE FROM sessions WHERE user_id = ?", (row["id"],))
    db.commit()
    row = db.execute("SELECT password_hash FROM users WHERE email = ?", (EMAIL,)).fetchone()
    assert verify(password, row["password_hash"])
    print(f"Password set for {EMAIL}; it matches the secret.")


if __name__ == "__main__":
    main()
