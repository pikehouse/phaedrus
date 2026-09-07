//! The one object the app talks to: discovery state, household prefs, and
//! the high-level operations the UI needs.

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Duration;

use super::apple;
use super::content;
use super::didl;
use super::discovery;
use super::error::{Error, Result};
use super::items::{self, Accounts};
use super::model::*;
use super::rendering;
use super::smapi::{Creds, ServiceDesc, SmapiClient};
use super::soap::{Service, SoapClient};
use super::topology;
use super::transport;
use crate::store::{SpotifyToken, Store};

#[derive(Default)]
struct Runtime {
    household: Option<String>,
    known_ips: Vec<String>,
    models: HashMap<String, String>,
    services: Option<Vec<ServiceDesc>>,
    accounts_learned_at: u64,
}

pub struct SonosSystem {
    pub soap: SoapClient,
    http: reqwest::Client,
    smapi: SmapiClient,
    store: Store,
    rt: Mutex<Runtime>,
    country: String,
}

impl SonosSystem {
    pub fn new(store: Store) -> Self {
        let http = reqwest::Client::builder()
            .user_agent("Phaedrus/0.1 (macOS)")
            .connect_timeout(Duration::from_secs(5))
            .timeout(Duration::from_secs(10))
            .build()
            .expect("http client");
        let smapi = SmapiClient::new(store.device_id());
        Self { soap: SoapClient::new(), http, smapi, store, rt: Mutex::new(Runtime::default()), country: "US".into() }
    }

    fn household(&self) -> Option<String> {
        self.rt.lock().unwrap().household.clone()
    }

    pub fn any_ip(&self) -> Option<String> {
        self.rt.lock().unwrap().known_ips.first().cloned()
    }

    // ── Discovery ────────────────────────────────────────────────────────────

    pub async fn discover(&self) -> Result<Topology> {
        let mut hints = self.rt.lock().unwrap().known_ips.clone();
        for ip in self.store.all_known_ips() {
            if !hints.contains(&ip) {
                hints.push(ip);
            }
        }
        let (ip, zgs) = discovery::find_household(&self.soap, &hints, Duration::from_secs(9)).await?;
        self.finish_topology(&ip, &zgs, true).await
    }

    pub async fn topology(&self) -> Result<Topology> {
        let known = self.rt.lock().unwrap().known_ips.clone();
        if known.is_empty() {
            return self.discover().await;
        }
        // Ask up to three known speakers at once; first answer wins.
        let attempts = known.iter().take(3).map(|ip| {
            let soap = self.soap.clone();
            let ip = ip.clone();
            async move {
                let r = tokio::time::timeout(Duration::from_millis(3000), soap.call(&ip, Service::ZoneGroupTopology, "GetZoneGroupState", &[])).await;
                match r {
                    Ok(Ok(resp)) => resp.get("ZoneGroupState").filter(|s| !s.is_empty()).map(|s| (ip, s.to_string())),
                    _ => None,
                }
            }
        });
        let mut set: futures::stream::FuturesUnordered<_> = attempts.collect();
        use futures::StreamExt;
        while let Some(r) = set.next().await {
            if let Some((ip, zgs)) = r {
                return self.finish_topology(&ip, &zgs, false).await;
            }
        }
        // Known speakers vanished (new network?) — full discovery.
        self.rt.lock().unwrap().known_ips.clear();
        self.discover().await
    }

    async fn finish_topology(&self, ip: &str, zgs: &str, fetch_models: bool) -> Result<Topology> {
        let household = match self.soap.call(ip, Service::DeviceProperties, "GetHouseholdID", &[]).await {
            Ok(r) => r.get("CurrentHouseholdID").map(|s| s.to_string()).filter(|s| !s.is_empty()),
            Err(_) => None,
        }
        .or_else(|| self.household())
        .unwrap_or_else(|| "unknown".to_string());

        let members = topology::all_member_ips(zgs);
        let ips: Vec<String> = {
            let mut v: Vec<String> = vec![ip.to_string()];
            for (_, mip) in &members {
                if !v.contains(mip) {
                    v.push(mip.clone());
                }
            }
            v
        };

        if fetch_models {
            let need: Vec<(String, String)> = {
                let rt = self.rt.lock().unwrap();
                members.iter().filter(|(u, _)| !rt.models.contains_key(u)).cloned().collect()
            };
            let fetched = futures::future::join_all(need.into_iter().map(|(uuid, mip)| {
                let http = self.soap.http().clone();
                async move {
                    let url = format!("http://{}:1400/xml/device_description.xml", mip);
                    let model = match tokio::time::timeout(Duration::from_millis(2500), http.get(&url).send()).await {
                        Ok(Ok(resp)) => resp.text().await.ok().and_then(|t| extract_tag(&t, "modelName")),
                        _ => None,
                    };
                    (uuid, model)
                }
            }))
            .await;
            let mut rt = self.rt.lock().unwrap();
            for (uuid, model) in fetched {
                if let Some(m) = model {
                    rt.models.insert(uuid, m);
                }
            }
        }

        let groups = {
            let rt = self.rt.lock().unwrap();
            topology::parse_groups(zgs, &rt.models)?
        };
        {
            let mut rt = self.rt.lock().unwrap();
            rt.household = Some(household.clone());
            rt.known_ips = ips.clone();
        }
        self.store.update(&household, |h| {
            h.known_ips = ips;
            h.last_seen = now_ms();
        });
        Ok(Topology { household_id: household, groups, discovered_at: now_ms() })
    }

    // ── Playback passthroughs ────────────────────────────────────────────────

    pub async fn group_state(&self, ip: &str, members: &[MemberRef]) -> Result<GroupState> {
        transport::group_state(&self.soap, ip, members).await
    }
    pub async fn play(&self, ip: &str) -> Result<()> { transport::play(&self.soap, ip).await }
    pub async fn pause(&self, ip: &str) -> Result<()> { transport::pause(&self.soap, ip).await }
    pub async fn stop(&self, ip: &str) -> Result<()> { transport::stop(&self.soap, ip).await }
    pub async fn next(&self, ip: &str) -> Result<()> { transport::next(&self.soap, ip).await }
    pub async fn previous(&self, ip: &str) -> Result<()> { transport::previous(&self.soap, ip).await }
    pub async fn seek(&self, ip: &str, secs: u32) -> Result<()> { transport::seek_time(&self.soap, ip, secs).await }
    pub async fn play_queue_index(&self, ip: &str, index: u32) -> Result<()> {
        transport::seek_track(&self.soap, ip, index).await?;
        transport::play(&self.soap, ip).await
    }
    pub async fn set_play_mode(&self, ip: &str, mode: &str) -> Result<()> { transport::set_play_mode(&self.soap, ip, mode).await }
    pub async fn set_crossfade(&self, ip: &str, on: bool) -> Result<()> { transport::set_crossfade(&self.soap, ip, on).await }
    pub async fn set_group_volume(&self, ip: &str, v: u32) -> Result<()> { rendering::set_group_volume(&self.soap, ip, v).await }
    pub async fn set_group_mute(&self, ip: &str, m: bool) -> Result<()> { rendering::set_group_mute(&self.soap, ip, m).await }
    pub async fn set_volume(&self, ip: &str, v: u32) -> Result<()> { rendering::set_volume(&self.soap, ip, v).await }
    pub async fn set_mute(&self, ip: &str, m: bool) -> Result<()> { rendering::set_mute(&self.soap, ip, m).await }
    pub async fn queue(&self, ip: &str, start: u32, count: u32) -> Result<QueuePage> { content::queue(&self.soap, ip, start, count).await }
    pub async fn remove_from_queue(&self, ip: &str, index: u32) -> Result<()> { transport::remove_track(&self.soap, ip, index).await }
    pub async fn clear_queue(&self, ip: &str) -> Result<()> { transport::remove_all_tracks(&self.soap, ip).await }
    pub async fn reorder_queue(&self, ip: &str, from: u32, to: u32) -> Result<()> { transport::reorder(&self.soap, ip, from, to).await }
    pub async fn favorites(&self, ip: &str) -> Result<Vec<Favorite>> { content::favorites(&self.soap, ip).await }
    pub async fn join_group(&self, ip: &str, coordinator_uuid: &str) -> Result<()> { transport::join(&self.soap, ip, coordinator_uuid).await }
    pub async fn leave_group(&self, ip: &str) -> Result<()> { transport::become_standalone(&self.soap, ip).await }

    pub async fn play_favorite(&self, ip: &str, coordinator_uuid: &str, fav: &Favorite, action: PlayAction) -> Result<()> {
        let p = items::from_favorite(fav)?;
        items::perform(&self.soap, ip, coordinator_uuid, &p, action).await
    }

    pub async fn play_item(&self, ip: &str, coordinator_uuid: &str, item: &MediaItem, action: PlayAction) -> Result<()> {
        let acc = self.accounts(ip).await;
        let p = items::build(item, &acc)?;
        items::perform(&self.soap, ip, coordinator_uuid, &p, action).await
    }

    // ── Accounts (which sid/sn this household uses) ──────────────────────────

    /// Learn account slots by looking at what the household already plays.
    async fn accounts(&self, ip: &str) -> Accounts {
        let hh = self.household().unwrap_or_default();
        let stale = now_ms().saturating_sub(self.rt.lock().unwrap().accounts_learned_at) > 10 * 60 * 1000;
        if stale {
            let mut learned: HashMap<u32, u32> = HashMap::new();
            let (fav, q) = futures::join!(content::browse(&self.soap, ip, "FV:2", 0, 200), content::browse(&self.soap, ip, "Q:0", 0, 200));
            for br in [fav, q].into_iter().flatten() {
                for it in br.items {
                    if let Some(uri) = it.res_uri.as_deref() {
                        if let (Some(sid), Some(sn)) = (didl::uri_sid(uri), didl::uri_sn(uri)) {
                            learned.entry(sid).or_insert(sn);
                        }
                    }
                }
            }
            if !learned.is_empty() {
                self.store.update(&hh, |h| {
                    for (sid, sn) in &learned {
                        h.accounts.insert(sid.to_string(), *sn);
                    }
                });
            }
            self.rt.lock().unwrap().accounts_learned_at = now_ms();
        }
        let prefs = self.store.household(&hh);
        let mut acc = Accounts::default();
        if let Some(sn) = prefs.accounts.get("12") {
            acc.spotify_sid = 12;
            acc.spotify_sn = *sn;
        } else if let Some(sn) = prefs.accounts.get("9") {
            acc.spotify_sid = 9;
            acc.spotify_sn = *sn;
        }
        if let Some(sn) = prefs.accounts.get("204") {
            acc.apple_sn = *sn;
        }
        acc
    }

    // ── Music services ───────────────────────────────────────────────────────

    async fn service_descs(&self, ip: &str) -> Result<Vec<ServiceDesc>> {
        if let Some(s) = self.rt.lock().unwrap().services.clone() {
            return Ok(s);
        }
        let descs = super::smapi::list_available_services(&self.soap, ip).await?;
        self.rt.lock().unwrap().services = Some(descs.clone());
        Ok(descs)
    }

    async fn service_desc(&self, ip: &str, id: ServiceId) -> Result<ServiceDesc> {
        let descs = self.service_descs(ip).await?;
        let want: &[u32] = match id {
            ServiceId::Spotify => &[12, 9],
            ServiceId::Apple => &[204],
            ServiceId::Tunein => &[254],
        };
        for sid in want {
            if let Some(d) = descs.iter().find(|d| d.sid == *sid) {
                return Ok(d.clone());
            }
        }
        Err(Error::other(format!("{} isn't available on this Sonos system", id.label())))
    }

    fn spotify_token(&self) -> Option<SpotifyToken> {
        let hh = self.household()?;
        self.store.household(&hh).spotify
    }

    pub async fn services(&self, ip: &str) -> Result<Vec<MusicService>> {
        let _ = self.service_descs(ip).await; // warm cache; ignore failure
        let linked = self.spotify_token().is_some();
        Ok(vec![
            MusicService { id: ServiceId::Apple, name: "Apple Music".into(), available: true, linked: true, needs_link: false },
            MusicService { id: ServiceId::Spotify, name: "Spotify".into(), available: true, linked, needs_link: !linked },
            MusicService { id: ServiceId::Tunein, name: "TuneIn".into(), available: true, linked: true, needs_link: false },
        ])
    }

    /// Spotify SMAPI call with automatic token refresh.
    async fn spotify_creds(&self) -> Result<Creds> {
        let hh = self.household().ok_or_else(|| Error::other("no household yet"))?;
        let tok = self.spotify_token().ok_or_else(|| Error::other("Spotify isn't connected yet"))?;
        Ok(Creds::Token { token: tok.token, key: tok.key, household: hh })
    }

    fn store_spotify_token(&self, token: String, key: String) {
        if let Some(hh) = self.household() {
            self.store.update(&hh, |h| h.spotify = Some(SpotifyToken { token, key }));
        }
    }

    async fn spotify_search(&self, ip: &str, category: &str, term: &str, count: u32) -> Result<Vec<super::smapi::SmapiItem>> {
        let svc = self.service_desc(ip, ServiceId::Spotify).await?;
        let creds = self.spotify_creds().await?;
        match self.smapi.search(&svc, &creds, category, term, 0, count).await {
            Ok((items, _)) => Ok(items),
            Err(Error::Smapi { refresh: Some((t, k)), .. }) => {
                self.store_spotify_token(t.clone(), k.clone());
                let creds = self.spotify_creds().await?;
                Ok(self.smapi.search(&svc, &creds, category, term, 0, count).await?.0)
            }
            Err(e) => Err(e),
        }
    }

    fn spotify_item(it: &super::smapi::SmapiItem) -> Option<MediaItem> {
        let kind = if it.id.contains(":track:") {
            ItemKind::Track
        } else if it.id.contains(":album:") {
            ItemKind::Album
        } else if it.id.contains(":playlist:") {
            ItemKind::Playlist
        } else if it.id.contains(":artist:") {
            ItemKind::Artist
        } else {
            return None;
        };
        let subtitle = match kind {
            ItemKind::Track => match (&it.artist, &it.album) {
                (Some(a), Some(b)) => Some(format!("{} · {}", a, b)),
                (Some(a), None) => Some(a.clone()),
                _ => it.album.clone(),
            },
            ItemKind::Playlist => it.artist.clone().or_else(|| it.summary.clone()),
            _ => it.artist.clone(),
        };
        Some(MediaItem {
            service: ServiceId::Spotify,
            kind,
            id: it.id.clone(),
            title: it.title.clone(),
            subtitle,
            art: it.art.clone(),
            duration_secs: it.duration_secs,
            explicit: it.explicit,
            year: None,
            track_count: None,
        })
    }

    pub async fn search(&self, ip: &str, query: &str) -> Result<SearchResults> {
        let query = query.trim();
        let mut out = SearchResults { query: query.to_string(), ..Default::default() };
        if query.is_empty() {
            return Ok(out);
        }
        let spotify_linked = self.spotify_token().is_some();

        let apple = apple::search(&self.http, query, &self.country);
        let tunein = async {
            let svc = self.service_desc(ip, ServiceId::Tunein).await?;
            self.smapi.search(&svc, &Creds::Anonymous, "search:station", query, 0, 8).await.map(|r| r.0)
        };
        let spotify = async {
            if !spotify_linked {
                return Ok::<_, Error>(None);
            }
            let (t, a, ar, p) = futures::join!(
                self.spotify_search(ip, "track", query, 12),
                self.spotify_search(ip, "album", query, 10),
                self.spotify_search(ip, "artist", query, 6),
                self.spotify_search(ip, "playlist", query, 8)
            );
            // If every category failed, report the first error; otherwise take what we got.
            if t.is_err() && a.is_err() && ar.is_err() && p.is_err() {
                return Err(t.err().unwrap());
            }
            Ok(Some((t.unwrap_or_default(), a.unwrap_or_default(), ar.unwrap_or_default(), p.unwrap_or_default())))
        };
        let (apple, tunein, spotify) = futures::join!(apple, tunein, spotify);

        match apple {
            Ok(r) => {
                out.tracks.extend(r.tracks);
                out.albums.extend(r.albums);
                out.artists.extend(r.artists);
            }
            Err(e) => out.errors.push(SearchError { service: ServiceId::Apple, message: String::from(e) }),
        }
        match spotify {
            Ok(Some((t, a, ar, p))) => {
                out.tracks.extend(t.iter().filter_map(Self::spotify_item));
                out.albums.extend(a.iter().filter_map(Self::spotify_item));
                out.artists.extend(ar.iter().filter_map(Self::spotify_item));
                out.playlists.extend(p.iter().filter_map(Self::spotify_item));
            }
            Ok(None) => {}
            Err(e) => out.errors.push(SearchError { service: ServiceId::Spotify, message: String::from(e) }),
        }
        match tunein {
            Ok(items) => out.stations.extend(items.iter().filter(|i| i.item_type == "stream" || i.can_play).map(|i| MediaItem {
                service: ServiceId::Tunein,
                kind: ItemKind::Station,
                id: i.id.clone(),
                title: i.title.clone(),
                subtitle: i.artist.clone().or_else(|| i.summary.clone()),
                art: i.art.clone(),
                duration_secs: None,
                explicit: None,
                year: None,
                track_count: None,
            })),
            Err(e) => out.errors.push(SearchError { service: ServiceId::Tunein, message: String::from(e) }),
        }
        // Interleave services so one doesn't bury the other.
        out.tracks = interleave_by_service(out.tracks);
        out.albums = interleave_by_service(out.albums);
        out.artists = interleave_by_service(out.artists);
        Ok(out)
    }

    pub async fn artist_albums(&self, ip: &str, item: &MediaItem) -> Result<Vec<MediaItem>> {
        match item.service {
            ServiceId::Apple => apple::artist_albums(&self.http, &item.id, &self.country).await,
            ServiceId::Spotify => {
                let svc = self.service_desc(ip, ServiceId::Spotify).await?;
                let creds = self.spotify_creds().await?;
                // Artist node → sub-containers (Top Tracks, Albums, …). Prefer "Albums".
                let (children, _) = self.smapi.get_metadata(&svc, &creds, &item.id, 0, 50).await?;
                let albums_node = children.iter().find(|c| c.title.eq_ignore_ascii_case("albums") || c.id.contains("artistAlbums"));
                let (items, _) = match albums_node {
                    Some(n) => self.smapi.get_metadata(&svc, &creds, &n.id, 0, 60).await?,
                    None => (children, 0),
                };
                Ok(items.iter().filter(|i| i.id.contains(":album:")).filter_map(Self::spotify_item).collect())
            }
            ServiceId::Tunein => Ok(vec![]),
        }
    }

    // ── Linking ──────────────────────────────────────────────────────────────

    pub async fn link_begin(&self, ip: &str, service: ServiceId) -> Result<LinkSession> {
        let hh = self.household().ok_or_else(|| Error::other("no household yet"))?;
        let svc = self.service_desc(ip, service).await?;
        let (url, code) = if svc.auth == "DeviceLink" {
            self.smapi.get_device_link_code(&svc, &hh).await?
        } else {
            self.smapi.get_app_link(&svc, &hh).await?
        };
        Ok(LinkSession { service, url, link_code: code })
    }

    pub async fn link_poll(&self, ip: &str, session: &LinkSession) -> Result<LinkStatus> {
        let hh = self.household().ok_or_else(|| Error::other("no household yet"))?;
        let svc = self.service_desc(ip, session.service).await?;
        match self.smapi.get_device_auth_token(&svc, &hh, &session.link_code).await {
            Ok(Some((token, key))) => {
                if session.service == ServiceId::Spotify {
                    self.store_spotify_token(token, key);
                }
                Ok(LinkStatus::Linked)
            }
            Ok(None) => Ok(LinkStatus::Pending),
            Err(e) => {
                log::warn!("link poll failed: {e}");
                Ok(LinkStatus::Failed)
            }
        }
    }

    pub fn unlink(&self, service: ServiceId) {
        if service == ServiceId::Spotify {
            if let Some(hh) = self.household() {
                self.store.update(&hh, |h| h.spotify = None);
            }
        }
    }
}

fn extract_tag(xml: &str, tag: &str) -> Option<String> {
    let open = format!("<{}>", tag);
    let close = format!("</{}>", tag);
    let s = xml.find(&open)? + open.len();
    let e = xml[s..].find(&close)? + s;
    Some(xml[s..e].trim().to_string())
}

/// Alternate services so results read Apple, Spotify, Apple, Spotify…
fn interleave_by_service(items: Vec<MediaItem>) -> Vec<MediaItem> {
    let mut apple: Vec<MediaItem> = Vec::new();
    let mut spotify: Vec<MediaItem> = Vec::new();
    let mut other: Vec<MediaItem> = Vec::new();
    for it in items {
        match it.service {
            ServiceId::Apple => apple.push(it),
            ServiceId::Spotify => spotify.push(it),
            _ => other.push(it),
        }
    }
    let mut out = Vec::with_capacity(apple.len() + spotify.len() + other.len());
    let (mut a, mut s) = (apple.into_iter(), spotify.into_iter());
    loop {
        match (s.next(), a.next()) {
            (None, None) => break,
            (x, y) => {
                out.extend(x);
                out.extend(y);
            }
        }
    }
    out.extend(other);
    out
}
