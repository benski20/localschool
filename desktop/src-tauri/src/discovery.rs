//! Bonjour discovery of Local School servers (`_localschool._tcp`) on the school network.

use std::{
    collections::BTreeMap,
    net::IpAddr,
    time::{Duration, Instant},
};

use mdns_sd::{ServiceDaemon, ServiceEvent};
use serde::Serialize;

pub const SERVICE_TYPE: &str = "_localschool._tcp.local.";

#[derive(Debug, Clone, Serialize)]
pub struct Found {
    pub name: String,
    pub url: String,
    pub host: String,
    pub version: String,
}

/// Browse for `wait`, returning each server once (keyed by its advertised instance name).
pub fn browse(wait: Duration) -> Result<Vec<Found>, String> {
    let mdns = ServiceDaemon::new().map_err(|e| format!("Discovery unavailable: {e}"))?;
    let rx = mdns.browse(SERVICE_TYPE).map_err(|e| format!("Discovery unavailable: {e}"))?;
    let deadline = Instant::now() + wait;
    let mut found: BTreeMap<String, Found> = BTreeMap::new();

    while let Some(left) = deadline.checked_duration_since(Instant::now()) {
        match rx.recv_timeout(left) {
            Ok(ServiceEvent::ServiceResolved(info)) => {
                // Prefer IPv4: it works without the .local resolver and through most Wi-Fi.
                let mut addrs: Vec<IpAddr> = info.get_addresses().iter().copied().collect();
                addrs.sort_by_key(|a| !a.is_ipv4());
                let Some(ip) = addrs.first() else { continue };
                let host = match ip {
                    IpAddr::V4(v4) => v4.to_string(),
                    IpAddr::V6(v6) => format!("[{v6}]"),
                };
                let name = info
                    .get_property_val_str("name")
                    .map(str::to_string)
                    .unwrap_or_else(|| info.get_fullname().trim_end_matches(SERVICE_TYPE).trim_end_matches('.').to_string());
                found.insert(
                    info.get_fullname().to_string(),
                    Found {
                        name,
                        url: format!("http://{host}:{}", info.get_port()),
                        host: info.get_hostname().trim_end_matches('.').to_string(),
                        version: info.get_property_val_str("version").unwrap_or("").to_string(),
                    },
                );
            }
            Ok(_) => {}
            Err(_) => break, // timed out or daemon closed
        }
    }
    let _ = mdns.shutdown();
    Ok(found.into_values().collect())
}
