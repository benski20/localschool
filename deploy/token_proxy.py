"""A tiny authenticating reverse proxy in front of Ollama.

Ollama has no auth, so any runtime reachable from the internet (Modal, a tunnel) runs
this in front of it. Requests need `Authorization: Bearer $LS_RUNTIME_TOKEN`; bodies and
streamed responses pass through untouched.

    LS_RUNTIME_TOKEN=… python token_proxy.py --listen 0.0.0.0:11434 --upstream http://127.0.0.1:11435
"""

from __future__ import annotations

import argparse
import hmac
import os

from aiohttp import ClientSession, ClientTimeout, web

HOP_HEADERS = {"host", "authorization", "content-length", "transfer-encoding", "connection"}


def make_app(upstream: str, token: str) -> web.Application:
    expected = f"Bearer {token}".encode()

    async def handle(request: web.Request) -> web.StreamResponse:
        given = request.headers.get("Authorization", "").encode()
        if not token or not hmac.compare_digest(given, expected):
            return web.json_response({"error": "unauthorized"}, status=401)
        headers = {k: v for k, v in request.headers.items() if k.lower() not in HOP_HEADERS}
        async with request.app["session"].request(
            request.method, upstream + request.path_qs, data=await request.read(), headers=headers
        ) as up:
            resp = web.StreamResponse(
                status=up.status,
                headers={"Content-Type": up.headers.get("Content-Type", "application/json")},
            )
            await resp.prepare(request)
            async for chunk in up.content.iter_any():
                await resp.write(chunk)
            await resp.write_eof()
            return resp

    async def on_startup(app: web.Application) -> None:
        app["session"] = ClientSession(timeout=ClientTimeout(total=None, sock_connect=10))

    async def on_cleanup(app: web.Application) -> None:
        await app["session"].close()

    app = web.Application(client_max_size=64 * 1024 * 1024)
    app.router.add_route("*", "/{tail:.*}", handle)
    app.on_startup.append(on_startup)
    app.on_cleanup.append(on_cleanup)
    return app


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--listen", default="0.0.0.0:11434")
    ap.add_argument("--upstream", default="http://127.0.0.1:11435")
    args = ap.parse_args()
    token = os.environ.get("LS_RUNTIME_TOKEN", "")
    if len(token) < 16:
        raise SystemExit("LS_RUNTIME_TOKEN must be set (16+ characters)")
    host, port = args.listen.rsplit(":", 1)
    web.run_app(make_app(args.upstream.rstrip("/"), token), host=host, port=int(port), print=None)


if __name__ == "__main__":
    main()
