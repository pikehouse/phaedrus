//! Album-art cache. Sonos serves art through each speaker's own proxy, which
//! fetches from the internet on every request and answers one image at a
//! time — so a long queue starves the cover you're actually looking at.
//! We fetch each image once, keep it on disk, and hand it to the webview from
//! an `art://` scheme with permissive CORS so the canvas can sample colours.

use std::collections::{HashMap, VecDeque};
use std::net::Ipv4Addr;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime};

use tokio::sync::Semaphore;
use url::{Host, Url};

use crate::lock;
use crate::sonos::error::{Error, Result};

/// Decoded images kept in memory, by total bytes.
const MEM_CAP_BYTES: usize = 64 * 1024 * 1024;
/// Largest image we'll download.
const MAX_IMAGE_BYTES: usize = 8 * 1024 * 1024;
/// Disk budget, enforced at startup and every `TRIM_EVERY` writes.
const DISK_CAP_BYTES: u64 = 300 * 1024 * 1024;
const TRIM_EVERY: usize = 50;

/// Album art comes from a speaker's own art proxy on the LAN, or from a public
/// host. Some radio logos are still served over plain http, so http is allowed
/// for public hosts too; the risk this guards against is reaching into the LAN.
/// Other LAN services, loopback, link-local, `.local` names and credentials in
/// the URL are refused.
pub fn allowed(url: &Url) -> bool {
    if !url.username().is_empty() || url.password().is_some() {
        return false;
    }
    match (url.scheme(), url.host()) {
        ("http", Some(Host::Ipv4(ip))) if ip.is_private() => {
            url.port() == Some(1400) && url.path() == "/getaa"
        }
        ("http" | "https", Some(Host::Domain(d))) => {
            let d = d.trim_end_matches('.');
            !(d == "localhost" || d.ends_with(".localhost") || d.ends_with(".local"))
        }
        ("http" | "https", Some(Host::Ipv4(ip))) => is_public(ip),
        _ => false,
    }
}

fn is_public(ip: Ipv4Addr) -> bool {
    let [a, b, ..] = ip.octets();
    !(ip.is_private()
        || ip.is_loopback()
        || ip.is_link_local()
        || ip.is_unspecified()
        || ip.is_broadcast()
        || ip.is_documentation()
        || a == 0
        || (a == 100 && (b & 0xc0) == 64)) // carrier-grade NAT, 100.64/10
}

/// FNV-1a 64. Cache file names must survive toolchain upgrades, which rules
/// out `DefaultHasher`.
fn fnv1a(seed: u64, bytes: &[u8]) -> u64 {
    bytes.iter().fold(seed, |h, b| (h ^ u64::from(*b)).wrapping_mul(0x0000_0100_0000_01b3))
}

fn key(url: &str) -> String {
    // Two differently-seeded passes so two urls need two collisions.
    format!("{:016x}{:016x}", fnv1a(0xcbf2_9ce4_8422_2325, url.as_bytes()), fnv1a(0x6c62_272e_07bb_0142, url.as_bytes()))
}

#[derive(Default)]
struct Mem {
    map: HashMap<String, Arc<Vec<u8>>>,
    order: VecDeque<String>,
    bytes: usize,
}

impl Mem {
    /// Insert, evicting oldest entries until the total fits in `cap` bytes.
    fn insert(&mut self, key: String, bytes: Arc<Vec<u8>>, cap: usize) {
        if self.map.contains_key(&key) {
            return;
        }
        self.bytes += bytes.len();
        self.order.push_back(key.clone());
        self.map.insert(key, bytes);
        while self.bytes > cap {
            let Some(old) = self.order.pop_front() else { break };
            if let Some(b) = self.map.remove(&old) {
                self.bytes -= b.len();
            }
        }
    }
}

pub struct ArtCache {
    dir: PathBuf,
    http: reqwest::Client,
    gate: Semaphore,
    mem: Mutex<Mem>,
    /// One fetch per key at a time; latecomers wait, then find it cached.
    inflight: Mutex<HashMap<String, Arc<tokio::sync::Mutex<()>>>>,
    writes: AtomicUsize,
    trimming: Arc<AtomicBool>,
}

impl ArtCache {
    pub fn new(dir: PathBuf) -> Self {
        let _ = std::fs::create_dir_all(&dir);
        let http = reqwest::Client::builder()
            .user_agent("Phaedrus/0.1 (macOS)")
            .connect_timeout(Duration::from_secs(4))
            .timeout(Duration::from_secs(15))
            .redirect(reqwest::redirect::Policy::custom(|attempt| {
                if attempt.previous().len() >= 5 {
                    attempt.error("too many redirects")
                } else if allowed(attempt.url()) {
                    attempt.follow()
                } else {
                    attempt.stop()
                }
            }))
            .build()
            .expect("art client");
        let cache = Self {
            dir,
            http,
            gate: Semaphore::new(6),
            mem: Mutex::new(Mem::default()),
            inflight: Mutex::new(HashMap::new()),
            writes: AtomicUsize::new(0),
            trimming: Arc::new(AtomicBool::new(false)),
        };
        cache.trim_in_background();
        cache
    }

    /// Bytes for the image at `url`, from memory, disk, or the network.
    pub async fn get(&self, url: &Url) -> Result<Arc<Vec<u8>>> {
        if !allowed(url) {
            return Err(Error::other("not an album-art url"));
        }
        let key = key(url.as_str());
        if let Some(b) = self.cached(&key).await {
            return Ok(b);
        }
        let slot = lock(&self.inflight).entry(key.clone()).or_default().clone();
        let result = {
            let _turn = slot.lock().await;
            match self.cached(&key).await {
                Some(b) => Ok(b),
                None => self.fetch(url, &key).await,
            }
        };
        let mut inflight = lock(&self.inflight);
        // The map's copy and ours; anyone else would have cloned under this lock.
        if Arc::strong_count(&slot) <= 2 {
            inflight.remove(&key);
        }
        result
    }

    async fn cached(&self, key: &str) -> Option<Arc<Vec<u8>>> {
        if let Some(b) = lock(&self.mem).map.get(key).cloned() {
            return Some(b);
        }
        let path = self.dir.join(key);
        let bytes = tokio::fs::read(&path).await.ok().filter(|b| !b.is_empty())?;
        // Touch it so the disk trim sees it as recently used.
        let _ = std::fs::File::options().write(true).open(&path).and_then(|f| f.set_modified(SystemTime::now()));
        let b = Arc::new(bytes);
        lock(&self.mem).insert(key.to_string(), b.clone(), MEM_CAP_BYTES);
        Some(b)
    }

    async fn fetch(&self, url: &Url, key: &str) -> Result<Arc<Vec<u8>>> {
        let _permit = self.gate.acquire().await.map_err(|_| Error::other("art cache closed"))?;
        let mut resp = self.http.get(url.clone()).send().await?;
        if !resp.status().is_success() {
            return Err(Error::status(resp.status().as_u16(), ""));
        }
        if resp.content_length().is_some_and(|n| n > MAX_IMAGE_BYTES as u64) {
            return Err(Error::other("image too large"));
        }
        let mut bytes = Vec::new();
        while let Some(chunk) = resp.chunk().await? {
            if bytes.len() + chunk.len() > MAX_IMAGE_BYTES {
                return Err(Error::other("image too large"));
            }
            bytes.extend_from_slice(&chunk);
        }
        if bytes.is_empty() {
            return Err(Error::other("empty image"));
        }
        // Unique temp name, so a concurrent or abandoned write never gets published.
        let tmp = self.dir.join(format!("{key}.part-{}", uuid::Uuid::new_v4().simple()));
        if tokio::fs::write(&tmp, &bytes).await.is_err() || tokio::fs::rename(&tmp, self.dir.join(key)).await.is_err() {
            let _ = tokio::fs::remove_file(&tmp).await;
        }
        if self.writes.fetch_add(1, Ordering::Relaxed) % TRIM_EVERY == TRIM_EVERY - 1 {
            self.trim_in_background();
        }
        let b = Arc::new(bytes);
        lock(&self.mem).insert(key.to_string(), b.clone(), MEM_CAP_BYTES);
        Ok(b)
    }

    fn trim_in_background(&self) {
        if self.trimming.swap(true, Ordering::SeqCst) {
            return;
        }
        let (dir, trimming) = (self.dir.clone(), self.trimming.clone());
        std::thread::spawn(move || {
            trim_dir(&dir, DISK_CAP_BYTES);
            trimming.store(false, Ordering::SeqCst);
        });
    }
}

/// Delete least-recently-modified files until the directory fits in `cap` bytes.
fn trim_dir(dir: &Path, cap: u64) {
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    let mut files: Vec<(SystemTime, u64, PathBuf)> = entries
        .flatten()
        .filter_map(|e| {
            let m = e.metadata().ok()?;
            m.is_file().then(|| (m.modified().unwrap_or(SystemTime::UNIX_EPOCH), m.len(), e.path()))
        })
        .collect();
    let mut total: u64 = files.iter().map(|f| f.1).sum();
    if total <= cap {
        return;
    }
    files.sort_by_key(|f| f.0);
    for (_, len, path) in files {
        if total <= cap {
            break;
        }
        if std::fs::remove_file(&path).is_ok() {
            total -= len;
        }
    }
}

/// Sniff the content type; the speaker's proxy lies about it sometimes.
pub fn content_type(bytes: &[u8]) -> &'static str {
    if bytes.starts_with(&[0x89, b'P', b'N', b'G']) {
        "image/png"
    } else if bytes.starts_with(&[0xFF, 0xD8]) {
        "image/jpeg"
    } else if bytes.starts_with(b"GIF8") {
        "image/gif"
    } else if bytes.len() > 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        "image/webp"
    } else if bytes.starts_with(b"<svg") || bytes.starts_with(b"<?xml") {
        "image/svg+xml"
    } else {
        "application/octet-stream"
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ok(u: &str) -> bool {
        allowed(&Url::parse(u).unwrap())
    }

    #[test]
    fn allowlist_admits_speaker_proxies_and_public_https() {
        assert!(ok("http://10.0.0.12:1400/getaa?s=1&u=x-sonos-spotify%3a1"));
        assert!(ok("http://172.16.4.2:1400/getaa?u=x"));
        assert!(ok(&format!("http://{}:1400/getaa?u=x", Ipv4Addr::new(192, 168, 0, 2))));
        assert!(ok("https://i.scdn.co/image/ab67616d0000b273"));
        assert!(ok("https://is1-ssl.mzstatic.com/image/thumb/a.jpg/600x600bb.jpg"));
        assert!(ok("https://8.8.8.8/a.png"));
        // Radio logos are sometimes plain http from public hosts.
        assert!(ok("http://cdn-radiotime-logos.tunein.com/s32537q.png"));
        assert!(ok("http://8.8.8.8/a.png"));
    }

    #[test]
    fn allowlist_refuses_everything_else() {
        // LAN, but not a speaker's art proxy.
        assert!(!ok("http://10.0.0.12:1400/xml/device_description.xml"));
        assert!(!ok("http://10.0.0.12:80/getaa?u=x"));
        assert!(!ok("http://10.0.0.12/getaa?u=x"));
        assert!(!ok("http://172.31.255.1/a.png"), "top of 172.16/12 is still LAN");
        // Loopback, link-local, local names over http.
        assert!(!ok("http://127.0.0.1:1400/getaa?u=x"));
        assert!(!ok("http://localhost/a.png"));
        assert!(!ok("http://nas.local/a.png"));
        assert!(!ok("http://169.254.169.254:1400/getaa?u=x"));
        assert!(!ok("https://169.254.169.254/latest/meta-data"));
        assert!(!ok("https://127.0.0.1/a.png"));
        assert!(!ok("https://0x7f.1/a.png"), "alternate IPv4 spellings are normalised");
        assert!(!ok("https://10.0.0.12/a.png"));
        assert!(!ok("https://localhost/a.png"));
        assert!(!ok("https://printer.local/a.png"));
        assert!(!ok("https://[::1]/a.png"));
        // Credentials and other schemes.
        assert!(!ok("https://user:pw@i.scdn.co/a.jpg"));
        assert!(!ok("http://user@10.0.0.12:1400/getaa?u=x"));
        assert!(!ok("file:///etc/passwd"));
        assert!(!ok("ftp://i.scdn.co/a.jpg"));
    }

    #[test]
    fn keys_are_stable_fnv() {
        assert_eq!(fnv1a(0xcbf2_9ce4_8422_2325, b""), 0xcbf2_9ce4_8422_2325);
        assert_eq!(fnv1a(0xcbf2_9ce4_8422_2325, b"a"), 0xaf63_dc4c_8601_ec8c);
        let k = key("https://i.scdn.co/a.jpg");
        assert_eq!(k.len(), 32);
        assert_eq!(k, key("https://i.scdn.co/a.jpg"));
        assert_ne!(k, key("https://i.scdn.co/b.jpg"));
    }

    #[test]
    fn memory_cache_is_capped_by_bytes() {
        let mut m = Mem::default();
        for i in 0..5 {
            m.insert(format!("k{i}"), Arc::new(vec![0u8; 40]), 100);
        }
        assert!(m.bytes <= 100);
        assert_eq!(m.map.len(), 2);
        assert!(m.map.contains_key("k4") && m.map.contains_key("k3"), "oldest go first");
    }

    #[test]
    fn disk_trim_removes_oldest_until_under_cap() {
        let dir = std::env::temp_dir().join(format!("phaedrus-art-test-{}", uuid::Uuid::new_v4().simple()));
        std::fs::create_dir_all(&dir).unwrap();
        let base = SystemTime::now() - Duration::from_secs(1000);
        for i in 0..4u64 {
            let p = dir.join(format!("f{i}"));
            std::fs::write(&p, vec![0u8; 100]).unwrap();
            std::fs::File::options().write(true).open(&p).unwrap().set_modified(base + Duration::from_secs(i * 10)).unwrap();
        }
        trim_dir(&dir, 250);
        let mut left: Vec<String> = std::fs::read_dir(&dir).unwrap().flatten().map(|e| e.file_name().to_string_lossy().into_owned()).collect();
        left.sort();
        assert_eq!(left, vec!["f2", "f3"]);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
