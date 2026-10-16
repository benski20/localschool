"""Set the first admin's password from ADMIN_PASSWORD (used once by the hosted deploy).

    ADMIN_PASSWORD=… python -m scripts.set_admin_password
"""

import os

from app.config import get_settings
from app.db import connect
from app.services.auth import create_user, hash_password


def main() -> None:
    settings = get_settings()
    with connect(settings.db_path) as db:
        row = db.execute("SELECT id FROM users WHERE email = ?", (settings.admin_email,)).fetchone()
        if row is None:
            create_user(db, email=settings.admin_email, name="Administrator", role="admin",
                        password=os.environ["ADMIN_PASSWORD"])
            print(f"Created {settings.admin_email} (admin) with the new password.")
            return
        db.execute("UPDATE users SET password_hash = ? WHERE id = ?", (hash_password(os.environ["ADMIN_PASSWORD"]), row["id"]))
        db.execute("DELETE FROM sessions WHERE user_id = ?", (row["id"],))
    print(f"Password set for {settings.admin_email}; its sessions were signed out.")


if __name__ == "__main__":
    main()
