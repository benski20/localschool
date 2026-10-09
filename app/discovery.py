"""Bonjour/mDNS advertising so the Mac app can find this server on the school network.

Advertises `_localschool._tcp.local.` with the school name and version. Enabled with
ADVERTISE_MDNS=true. (Docker's bridge network blocks multicast — run the server natively
or with host networking for discovery to work.)
"""

from __future__ import annotations

import logging
import socket

log = logging.getLogger(__name__)
SERVICE_TYPE = "_localschool._tcp.local."


def _lan_addresses() -> list[str]:
    addrs: set[str] = set()
    try:
        # the address the OS would use to reach the LAN (no packet is sent)
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("10.255.255.255", 1))
            addrs.add(s.getsockname()[0])
    except OSError:
        pass
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            addrs.add(info[4][0])
    except OSError:
        pass
    return sorted(a for a in addrs if not a.startswith("127."))


class Advertiser:
    def __init__(self, school_name: str, port: int, version: str) -> None:
        self.school_name = school_name
        self.port = port
        self.version = version
        self._zc = None
        self._info = None

    async def start(self) -> None:
        try:
            from zeroconf import ServiceInfo
            from zeroconf.asyncio import AsyncZeroconf
        except ImportError:
            log.warning("zeroconf not installed; mDNS discovery disabled")
            return
        addrs = _lan_addresses()
        if not addrs:
            log.warning("no LAN address found; mDNS discovery disabled")
            return
        host = socket.gethostname().split(".")[0] or "localschool"
        instance = "".join(c for c in self.school_name if c.isalnum() or c in " -")[:50] or "Local School"
        self._info = ServiceInfo(
            SERVICE_TYPE,
            f"{instance}.{SERVICE_TYPE}",
            addresses=[socket.inet_aton(a) for a in addrs],
            port=self.port,
            properties={"name": self.school_name, "version": self.version, "path": "/"},
            server=f"{host}.local.",
        )
        self._zc = AsyncZeroconf()
        try:
            await self._zc.async_register_service(self._info, allow_name_change=True)
            log.info("advertising %s on %s:%s via mDNS", self.school_name, ",".join(addrs), self.port)
        except Exception as e:  # never block startup on discovery
            log.warning("mDNS advertising failed: %s", e)
            await self._zc.async_close()
            self._zc = None

    async def stop(self) -> None:
        if self._zc and self._info:
            await self._zc.async_unregister_service(self._info)
            await self._zc.async_close()
        self._zc = None
