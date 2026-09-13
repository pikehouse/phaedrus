//! Tiny JSON persistence: per-household speaker IPs and learned account slots.
//! Lives in the app data directory. The Spotify link token lives in the
//! Keychain; its JSON field is only a fallback and a migration source.

use std::collections::HashMap;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

use crate::lock;

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
    /// Only set when the Keychain refused the token; moved there on load.
    #[serde(default, skip_serializing_if = "Option::is_none")]
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
    /// household → token, so the Keychain is asked at most once per household.
    tokens: Mutex<HashMap<String, Option<SpotifyToken>>>,
}

impl Store {
    pub fn load(path: Option<PathBuf>) -> Self {
        let (path, mut data) = match path {
            Some(p) => read_or_quarantine(p),
            None => (None, Persisted::default()),
        };
        if data.device_id.is_empty() {
            data.device_id = format!("phaedrus-{}", uuid::Uuid::new_v4().simple());
        }
        for (hh, prefs) in data.households.iter_mut() {
            if let Some(tok) = prefs.spotify.take() {
                match keychain::set(hh, &tok) {
                    Ok(()) => log::info!("moved Spotify token for {hh} into the Keychain"),
                    Err(e) => {
                        log::warn!("Keychain unavailable, keeping Spotify token in settings: {e}");
                        prefs.spotify = Some(tok);
                    }
                }
            }
        }
        let store = Self { path, data: Mutex::new(data), tokens: Mutex::new(HashMap::new()) };
        store.save();
        store
    }

    pub fn device_id(&self) -> String {
        lock(&self.data).device_id.clone()
    }

    pub fn household(&self, id: &str) -> HouseholdPrefs {
        lock(&self.data).households.get(id).cloned().unwrap_or_default()
    }

    /// All IPs we've ever seen, most recently seen household first.
    pub fn all_known_ips(&self) -> Vec<String> {
        let d = lock(&self.data);
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
            let mut d = lock(&self.data);
            let h = d.households.entry(id.to_string()).or_default();
            f(h);
        }
        self.save();
    }

    pub fn spotify_token(&self, household: &str) -> Option<SpotifyToken> {
        if let Some(t) = lock(&self.tokens).get(household) {
            return t.clone();
        }
        let from_json = || lock(&self.data).households.get(household).and_then(|h| h.spotify.clone());
        let tok = match keychain::get(household) {
            Ok(Some(t)) => Some(t),
            Ok(None) => from_json(),
            Err(e) => {
                log::warn!("Keychain read failed, using settings file: {e}");
                from_json()
            }
        };
        lock(&self.tokens).insert(household.to_string(), tok.clone());
        tok
    }

    /// Store (or with None, forget) the token: Keychain first, JSON if that fails.
    pub fn set_spotify_token(&self, household: &str, tok: Option<SpotifyToken>) {
        let written = match &tok {
            Some(t) => keychain::set(household, t),
            None => keychain::delete(household),
        };
        let fallback = match written {
            Ok(()) => None,
            Err(e) => {
                log::warn!("Keychain write failed, using settings file: {e}");
                tok.clone()
            }
        };
        let in_json = lock(&self.data).households.get(household).is_some_and(|h| h.spotify.is_some());
        if fallback.is_some() || in_json {
            self.update(household, |h| h.spotify = fallback);
        }
        lock(&self.tokens).insert(household.to_string(), tok);
    }

    fn save(&self) {
        let Some(p) = &self.path else { return };
        // Held across the write so concurrent saves can't land out of order.
        let d = lock(&self.data);
        let res = serde_json::to_vec_pretty(&*d).map_err(std::io::Error::other).and_then(|json| write_atomic(p, &json));
        if let Err(e) = res {
            log::warn!("couldn't save settings to {}: {e}", p.display());
        }
    }
}

/// Read the settings file. One that exists but can't be read or parsed is moved
/// aside, never overwritten, so a bad write can't silently wipe the household.
fn read_or_quarantine(p: PathBuf) -> (Option<PathBuf>, Persisted) {
    let err = match std::fs::read_to_string(&p) {
        Ok(s) => match serde_json::from_str::<Persisted>(&s) {
            Ok(d) => return (Some(p), d),
            Err(e) => e.to_string(),
        },
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return (Some(p), Persisted::default()),
        Err(e) => e.to_string(),
    };
    let ts = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
    let mut bad = p.clone().into_os_string();
    bad.push(format!(".corrupt-{ts}"));
    let bad = PathBuf::from(bad);
    match std::fs::rename(&p, &bad) {
        Ok(()) => {
            log::error!("settings at {} were unreadable ({err}); moved to {} and starting fresh", p.display(), bad.display());
            (Some(p), Persisted::default())
        }
        Err(e) => {
            log::error!("settings at {} are unreadable ({err}) and couldn't be moved aside ({e}); not saving this session", p.display());
            (None, Persisted::default())
        }
    }
}

/// Temp file beside the target, fsync, rename: a crash leaves the old file or
/// the new one, never a torn mix.
fn write_atomic(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    let dir = path.parent().ok_or_else(|| std::io::Error::other("settings path has no parent"))?;
    std::fs::create_dir_all(dir)?;
    let mut name = path.file_name().unwrap_or_default().to_os_string();
    name.push(format!(".tmp-{}", uuid::Uuid::new_v4().simple()));
    let tmp = dir.join(name);
    let res = (|| {
        let mut opts = std::fs::OpenOptions::new();
        opts.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            opts.mode(0o600);
        }
        let mut f = opts.open(&tmp)?;
        f.write_all(bytes)?;
        f.sync_all()?;
        std::fs::rename(&tmp, path)
    })();
    if res.is_err() {
        let _ = std::fs::remove_file(&tmp);
    }
    res
}

#[cfg(any(target_os = "macos", target_os = "ios"))]
mod keychain {
    use super::SpotifyToken;

    const SERVICE: &str = "com.jrtipton.phaedrus.spotify";

    fn entry(household: &str) -> keyring::Result<keyring::Entry> {
        keyring::Entry::new(SERVICE, household)
    }

    pub fn get(household: &str) -> Result<Option<SpotifyToken>, String> {
        match entry(household).and_then(|e| e.get_password()) {
            Ok(s) => serde_json::from_str(&s).map(Some).map_err(|e| e.to_string()),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(e.to_string()),
        }
    }

    pub fn set(household: &str, tok: &SpotifyToken) -> Result<(), String> {
        let json = serde_json::to_string(tok).map_err(|e| e.to_string())?;
        entry(household).and_then(|e| e.set_password(&json)).map_err(|e| e.to_string())
    }

    pub fn delete(household: &str) -> Result<(), String> {
        match entry(household).and_then(|e| e.delete_credential()) {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(e.to_string()),
        }
    }
}

#[cfg(not(any(target_os = "macos", target_os = "ios")))]
mod keychain {
    use super::SpotifyToken;

    pub fn get(_household: &str) -> Result<Option<SpotifyToken>, String> {
        Ok(None)
    }
    pub fn set(_household: &str, _tok: &SpotifyToken) -> Result<(), String> {
        Err("no keychain on this platform".into())
    }
    pub fn delete(_household: &str) -> Result<(), String> {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir() -> PathBuf {
        let d = std::env::temp_dir().join(format!("phaedrus-store-test-{}", uuid::Uuid::new_v4().simple()));
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn unparseable_settings_are_moved_aside_not_overwritten() {
        let dir = temp_dir();
        let p = dir.join("phaedrus.json");
        std::fs::write(&p, "{ not json").unwrap();
        let store = Store::load(Some(p.clone()));
        assert!(!store.device_id().is_empty());
        let names: Vec<String> = std::fs::read_dir(&dir).unwrap().flatten().map(|e| e.file_name().to_string_lossy().into_owned()).collect();
        let corrupt = names.iter().find(|n| n.starts_with("phaedrus.json.corrupt-")).expect("quarantined copy");
        assert_eq!(std::fs::read_to_string(dir.join(corrupt)).unwrap(), "{ not json");
        let fresh: Persisted = serde_json::from_str(&std::fs::read_to_string(&p).unwrap()).unwrap();
        assert_eq!(fresh.device_id, store.device_id());
        assert_eq!(names.len(), 2, "no temp files left behind: {names:?}");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(std::fs::metadata(&p).unwrap().permissions().mode() & 0o777, 0o600);
        }
        let _ = std::fs::remove_dir_all(&dir);
    }
}
