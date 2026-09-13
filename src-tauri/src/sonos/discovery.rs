//! Finding speakers on whatever network we're on.
//!
//! Strategy: race three sources of candidate IPs — cached IPs from the last
//! time we saw this network, SSDP multicast/broadcast, and a TCP sweep of the
//! local subnet on port 1400 (many mesh routers swallow multicast). The first
//! candidate that answers GetZoneGroupState wins; that reply describes every
//! speaker in the household, so finding one is finding them all.

use std::collections::HashSet;
use std::net::{Ipv4Addr, SocketAddrV4};
use std::time::Duration;

use futures::StreamExt;
use tokio::sync::mpsc;

use super::error::{Error, Result};
use super::soap::{Service, SoapClient};

const SSDP_ADDR: &str = "239.255.255.250:1900";
const M_SEARCH: &str = "M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1900\r\nMAN: \"ssdp:discover\"\r\nMX: 1\r\nST: urn:schemas-upnp-org:device:ZonePlayer:1\r\n\r\n";

#[derive(Debug, Clone)]
pub struct Iface {
    pub ip: Ipv4Addr,
    pub mask: Ipv4Addr,
}

pub fn local_interfaces() -> Vec<Iface> {
    let mut out = Vec::new();
    if let Ok(addrs) = if_addrs::get_if_addrs() {
        for a in addrs {
            if a.is_loopback() || is_virtual_iface(&a.name) {
                continue;
            }
            if let if_addrs::IfAddr::V4(v4) = a.addr {
                if v4.ip.is_link_local() {
                    continue;
                }
                out.push(Iface { ip: v4.ip, mask: v4.netmask });
            }
        }
    }
    out
}

/// VPN tunnels, VM/container bridges, AirDrop and the like: sweeping them is
/// slow and never finds a speaker.
fn is_virtual_iface(name: &str) -> bool {
    const PREFIXES: [&str; 7] = ["utun", "bridge", "vmnet", "docker", "llw", "awdl", "anpi"];
    name == "ap1" || PREFIXES.iter().any(|p| name.starts_with(p))
}

fn prefix_len(mask: Ipv4Addr) -> u32 {
    u32::from(mask).count_ones()
}

/// Hosts to sweep for an interface. Whole network for /22 or smaller; the
/// /22 around our own address for anything bigger; nothing for /31, /32 (VPNs).
fn sweep_hosts(iface: &Iface) -> Vec<Ipv4Addr> {
    let plen = prefix_len(iface.mask);
    if plen >= 31 {
        return Vec::new();
    }
    let plen = plen.max(22);
    let mask: u32 = if plen == 0 { 0 } else { !0u32 << (32 - plen) };
    let ip = u32::from(iface.ip);
    let net = ip & mask;
    let size = 1u32 << (32 - plen);
    (1..size - 1).map(|i| Ipv4Addr::from(net + i)).filter(|h| *h != iface.ip).collect()
}

fn broadcast_addr(iface: &Iface) -> Ipv4Addr {
    Ipv4Addr::from(u32::from(iface.ip) | !u32::from(iface.mask))
}

/// SSDP M-SEARCH; sends discovered IPs to `tx` as they arrive.
pub async fn ssdp_search(tx: mpsc::Sender<Ipv4Addr>, duration: Duration) {
    let std_sock = match std::net::UdpSocket::bind("0.0.0.0:0") {
        Ok(s) => s,
        Err(e) => {
            log::warn!("ssdp bind failed: {e}");
            return;
        }
    };
    let _ = std_sock.set_multicast_ttl_v4(4);
    let _ = std_sock.set_broadcast(true);
    let _ = std_sock.set_nonblocking(true);
    let sock = match tokio::net::UdpSocket::from_std(std_sock) {
        Ok(s) => s,
        Err(_) => return,
    };
    let mut targets: Vec<String> = vec![SSDP_ADDR.to_string(), "255.255.255.255:1900".to_string()];
    for iface in local_interfaces() {
        targets.push(format!("{}:1900", broadcast_addr(&iface)));
    }
    let deadline = tokio::time::Instant::now() + duration;
    let mut buf = vec![0u8; 4096];
    let mut seen = HashSet::new();
    let mut next_send = tokio::time::Instant::now();
    let mut sends_left = 3;
    loop {
        let now = tokio::time::Instant::now();
        if now >= deadline {
            break;
        }
        if sends_left > 0 && now >= next_send {
            for t in &targets {
                let _ = sock.send_to(M_SEARCH.as_bytes(), t).await;
            }
            sends_left -= 1;
            next_send = now + Duration::from_millis(350);
        }
        let wait = deadline.min(next_send.max(now + Duration::from_millis(50)));
        match tokio::time::timeout_at(wait, sock.recv_from(&mut buf)).await {
            Ok(Ok((n, from))) => {
                let text = String::from_utf8_lossy(&buf[..n]);
                if !text.to_ascii_lowercase().contains("sonos") && !text.contains("ZonePlayer") {
                    continue;
                }
                let ip = location_ip(&text).or_else(|| match from.ip() {
                    std::net::IpAddr::V4(v4) => Some(v4),
                    _ => None,
                });
                if let Some(ip) = ip {
                    if seen.insert(ip) {
                        let _ = tx.send(ip).await;
                    }
                }
            }
            Ok(Err(_)) => break,
            Err(_) => {} // timeout tick
        }
    }
}

fn location_ip(text: &str) -> Option<Ipv4Addr> {
    for line in text.lines() {
        let lower = line.to_ascii_lowercase();
        if let Some(rest) = lower.strip_prefix("location:") {
            let url = rest.trim();
            let host = url.strip_prefix("http://")?.split(['/', ':']).next()?;
            return host.parse().ok();
        }
    }
    None
}

/// TCP sweep of every local subnet on port 1400.
pub async fn sweep(tx: mpsc::Sender<Ipv4Addr>, per_host_timeout: Duration) {
    let mut hosts: Vec<Ipv4Addr> = Vec::new();
    for iface in local_interfaces() {
        hosts.extend(sweep_hosts(&iface));
    }
    if hosts.is_empty() {
        return;
    }
    log::info!("sweeping {} hosts on port 1400", hosts.len());
    futures::stream::iter(hosts)
        // Stays under macOS's default 256 open-file soft limit.
        .for_each_concurrent(128, |ip| {
            let tx = tx.clone();
            async move {
                let addr = SocketAddrV4::new(ip, 1400);
                if let Ok(Ok(_)) = tokio::time::timeout(per_host_timeout, tokio::net::TcpStream::connect(addr)).await {
                    let _ = tx.send(ip).await;
                }
            }
        })
        .await;
}

/// Find one responsive speaker and return (ip, ZoneGroupState xml).
/// `hints` are IPs that worked last time on some network; they're tried first.
pub async fn find_household(soap: &SoapClient, hints: &[String], overall: Duration) -> Result<(String, String)> {
    let (tx, mut rx) = mpsc::channel::<Ipv4Addr>(512);

    // Cached hints go straight into the queue.
    for h in hints {
        if let Ok(ip) = h.parse::<Ipv4Addr>() {
            let _ = tx.try_send(ip);
        }
    }
    let tx_ssdp = tx.clone();
    let tx_sweep = tx.clone();
    drop(tx);
    let ssdp = tokio::spawn(ssdp_search(tx_ssdp, Duration::from_millis(2500)));
    let sweep_task = tokio::spawn(async move {
        // Give SSDP and cached IPs a head start before flooding the subnet.
        tokio::time::sleep(Duration::from_millis(400)).await;
        sweep(tx_sweep, Duration::from_millis(900)).await;
    });

    let deadline = tokio::time::Instant::now() + overall;
    let mut tried = HashSet::new();
    let mut in_flight = futures::stream::FuturesUnordered::new();
    // Once every producer is gone recv() is instantly ready with None; stop
    // selecting on it or the loop spins while lookups are in flight.
    let mut closed = false;
    let result = loop {
        tokio::select! {
            maybe_ip = rx.recv(), if !closed => {
                match maybe_ip {
                    Some(ip) => {
                        if tried.insert(ip) {
                            let soap = soap.clone();
                            in_flight.push(async move {
                                let ipstr = ip.to_string();
                                let r = tokio::time::timeout(Duration::from_millis(3500), soap.call(&ipstr, Service::ZoneGroupTopology, "GetZoneGroupState", &[])).await;
                                (ipstr, r)
                            });
                        }
                    }
                    None => {
                        // producers done; drain in-flight
                        closed = true;
                        if in_flight.is_empty() { break Err(Error::NotFound); }
                    }
                }
            }
            Some((ip, r)) = in_flight.next(), if !in_flight.is_empty() => {
                if let Ok(Ok(resp)) = r {
                    if let Some(xml) = resp.get("ZoneGroupState") {
                        if !xml.is_empty() {
                            break Ok((ip, xml.to_string()));
                        }
                    }
                }
                if closed && in_flight.is_empty() {
                    break Err(Error::NotFound);
                }
            }
            _ = tokio::time::sleep_until(deadline) => {
                break Err(Error::NotFound);
            }
        }
    };
    ssdp.abort();
    sweep_task.abort();
    result
}
