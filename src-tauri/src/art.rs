//! Album-art cache. Sonos serves art through each speaker's own proxy, which
//! fetches from the internet on every request and answers one image at a
//! time — so a long queue starves the cover you're actually looking at.
//! We fetch each image once, keep it on disk, and hand it to the webview from
//! an `art://` scheme with permissive CORS so the canvas can sample colours.

use std::collections::HashMap;
use std::hash::{Hash, Hasher};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use tokio::sync::Semaphore;

use crate::sonos::error::{Error, Result};

const MEM_CAP: usize = 160;

pub struct ArtCache {
    dir: PathBuf,
    http: reqwest::Client,
    gate: Semaphore,
    mem: Mutex<HashMap<String, Arc<Vec<u8>>>>,
}

impl ArtCache {
    pub fn new(dir: PathBuf) -> Self {
        let _ = std::fs::create_dir_all(&dir);
        let http = reqwest::Client::builder()
            .user_agent("Phaedrus/0.1 (macOS)")
            .connect_timeout(Duration::from_secs(4))
            .timeout(Duration::from_secs(15))
            .build()
            .expect("art client");
        Self { dir, http, gate: Semaphore::new(6), mem: Mutex::new(HashMap::new()) }
    }

    fn key(url: &str) -> String {
        let mut h = std::collections::hash_map::DefaultHasher::new();
        url.hash(&mut h);
        let a = h.finish();
        // A second, differently-seeded pass so two urls need two collisions.
        let mut h2 = std::collections::hash_map::DefaultHasher::new();
        (url.len() as u64 ^ 0x9e37_79b9_7f4a_7c15).hash(&mut h2);
        url.hash(&mut h2);
        format!("{:016x}{:016x}", a, h2.finish())
    }

    /// Bytes for the image at `url`, from memory, disk, or the network.
    pub async fn get(&self, url: &str) -> Result<Arc<Vec<u8>>> {
        let key = Self::key(url);
        if let Some(b) = self.mem.lock().unwrap().get(&key).cloned() {
            return Ok(b);
        }
        let path = self.dir.join(&key);
        if let Ok(bytes) = tokio::fs::read(&path).await {
            if !bytes.is_empty() {
                let b = Arc::new(bytes);
                self.remember(key, b.clone());
                return Ok(b);
            }
        }
        let _permit = self.gate.acquire().await.map_err(|_| Error::other("art cache closed"))?;
        let resp = self.http.get(url).send().await?;
        if !resp.status().is_success() {
            return Err(Error::Status(resp.status().as_u16()));
        }
        let bytes = resp.bytes().await?.to_vec();
        if bytes.is_empty() {
            return Err(Error::other("empty image"));
        }
        let tmp = self.dir.join(format!("{}.part", key));
        if tokio::fs::write(&tmp, &bytes).await.is_ok() {
            let _ = tokio::fs::rename(&tmp, &path).await;
        }
        let b = Arc::new(bytes);
        self.remember(key, b.clone());
        Ok(b)
    }

    fn remember(&self, key: String, bytes: Arc<Vec<u8>>) {
        let mut m = self.mem.lock().unwrap();
        if m.len() >= MEM_CAP {
            m.clear();
        }
        m.insert(key, bytes);
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
