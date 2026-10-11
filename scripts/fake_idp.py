"""A stand-in Google for CI (Desktop macOS workflow): just enough OpenID Connect to sign
someone in without a real Google account. Never used outside tests.

    python scripts/fake_idp.py 9999 jordan.lee@maplegrove.demo
"""

from __future__ import annotations

import base64
import json
import secrets
import sys
import time
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import parse_qs, urlencode, urlparse

PORT, EMAIL = int(sys.argv[1]), sys.argv[2]
ISSUER = f"http://127.0.0.1:{PORT}"
CODES: dict[str, dict] = {}


def jwt(claims: dict) -> str:
    enc = lambda d: base64.urlsafe_b64encode(json.dumps(d).encode()).rstrip(b"=").decode()  # noqa: E731
    return f"{enc({'alg': 'none'})}.{enc(claims)}.x"


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):  # /auth: sign in at once and send the browser back
        q = {k: v[0] for k, v in parse_qs(urlparse(self.path).query).items()}
        code = secrets.token_urlsafe(12)
        CODES[code] = {"nonce": q["nonce"], "aud": q["client_id"]}
        self.send_response(302)
        self.send_header("Location", f"{q['redirect_uri']}?{urlencode({'code': code, 'state': q['state']})}")
        self.end_headers()

    def do_POST(self):  # /token
        body = parse_qs(self.rfile.read(int(self.headers["Content-Length"])).decode())
        c = CODES.pop(body["code"][0])
        claims = {"iss": ISSUER, "aud": c["aud"], "exp": time.time() + 300, "nonce": c["nonce"],
                  "email": EMAIL, "email_verified": True, "name": "Jordan Lee"}
        out = json.dumps({"id_token": jwt(claims), "access_token": "x"}).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(out)))
        self.end_headers()
        self.wfile.write(out)


HTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
