//! Tiny JSON persistence: per-household speaker IPs, learned account slots,
//! and the Spotify link token. Lives in the app data directory.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpotifyToken {
    pub token: String,
    pub key: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct HouseholdPrefs {
    #[serde(default)]
    pub known_ips: Vec<String>,
    /// sid → sn (account serial) learned from favorites and the queue
    #[serde(default)]
    pub accounts: HashMap<String, u32>,
    #[serde(default)]
    pub spotify: Option<SpotifyToken>,
    #[serde(default)]
    pub last_seen: u64,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Persisted {
    #[serde(default)]
    pub device_id: String,
    #[serde(default)]
    pub households: HashMap<String, HouseholdPrefs>,
}

pub struct Store {
    path: Option<PathBuf>,
    data: Mutex<Persisted>,
}

impl Store {
    pub fn load(path: Option<PathBuf>) -> Self {
        let mut data = path
            .as_ref()
            .and_then(|p| std::fs::read_to_string(p).ok())
            .and_then(|s| serde_json::from_str::<Persisted>(&s).ok())
            .unwrap_or_default();
        if data.device_id.is_empty() {
            data.device_id = format!("phaedrus-{}", uuid::Uuid::new_v4().simple());
        }
        let store = Self { path, data: Mutex::new(data) };
        store.save();
        store
    }

    pub fn device_id(&self) -> String {
        self.data.lock().unwrap().device_id.clone()
    }

    pub fn household(&self, id: &str) -> HouseholdPrefs {
        self.data.lock().unwrap().households.get(id).cloned().unwrap_or_default()
    }

    /// All IPs we've ever seen, most recently seen household first.
    pub fn all_known_ips(&self) -> Vec<String> {
        let d = self.data.lock().unwrap();
        let mut hh: Vec<&HouseholdPrefs> = d.households.values().collect();
        hh.sort_by_key(|h| std::cmp::Reverse(h.last_seen));
        let mut out = Vec::new();
        for h in hh {
            for ip in &h.known_ips {
                if !out.contains(ip) {
                    out.push(ip.clone());
                }
            }
        }
        out
    }

    pub fn update<F: FnOnce(&mut HouseholdPrefs)>(&self, id: &str, f: F) {
        {
            let mut d = self.data.lock().unwrap();
            let h = d.households.entry(id.to_string()).or_default();
            f(h);
        }
        self.save();
    }

    fn save(&self) {
        if let Some(p) = &self.path {
            if let Some(parent) = p.parent() {
                let _ = std::fs::create_dir_all(parent);
            }
            if let Ok(json) = serde_json::to_string_pretty(&*self.data.lock().unwrap()) {
                let _ = std::fs::write(p, json);
            }
        }
    }
}
