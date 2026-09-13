//! Apple Music catalog search via the public iTunes Search API — no keys, no
//! login. The ids it returns are the same catalog ids Sonos uses for Apple Music.

use serde_json::Value;

use super::error::{Error, Result};
use super::model::{ItemKind, MediaItem, ServiceId};
use super::soap::is_digits;

const BASE: &str = "https://itunes.apple.com";

fn big_art(url: &str) -> String {
    url.replace("100x100bb", "600x600bb").replace("60x60bb", "600x600bb")
}

fn year_of(v: &Value) -> Option<u32> {
    v.get("releaseDate")?.as_str()?.get(0..4)?.parse().ok()
}

pub fn track_from(v: &Value) -> Option<MediaItem> {
    let id = v.get("trackId")?.as_u64()?;
    Some(MediaItem {
        service: ServiceId::Apple,
        kind: ItemKind::Track,
        id: id.to_string(),
        title: v.get("trackName")?.as_str()?.to_string(),
        subtitle: v.get("artistName").and_then(|a| a.as_str()).map(|a| {
            match v.get("collectionName").and_then(|c| c.as_str()) {
                Some(album) => format!("{} · {}", a, album),
                None => a.to_string(),
            }
        }),
        art: v.get("artworkUrl100").and_then(|a| a.as_str()).map(big_art),
        duration_secs: v.get("trackTimeMillis").and_then(|m| m.as_u64()).map(|m| (m / 1000) as u32),
        explicit: v.get("trackExplicitness").and_then(|e| e.as_str()).map(|e| e == "explicit"),
        year: year_of(v),
        track_count: None,
    })
}

pub fn album_from(v: &Value) -> Option<MediaItem> {
    let id = v.get("collectionId")?.as_u64()?;
    Some(MediaItem {
        service: ServiceId::Apple,
        kind: ItemKind::Album,
        id: id.to_string(),
        title: v.get("collectionName")?.as_str()?.to_string(),
        subtitle: v.get("artistName").and_then(|a| a.as_str()).map(|s| s.to_string()),
        art: v.get("artworkUrl100").and_then(|a| a.as_str()).map(big_art),
        duration_secs: None,
        explicit: v.get("collectionExplicitness").and_then(|e| e.as_str()).map(|e| e == "explicit"),
        year: year_of(v),
        track_count: v.get("trackCount").and_then(|t| t.as_u64()).map(|t| t as u32),
    })
}

pub fn artist_from(v: &Value) -> Option<MediaItem> {
    let id = v.get("artistId")?.as_u64()?;
    Some(MediaItem {
        service: ServiceId::Apple,
        kind: ItemKind::Artist,
        id: id.to_string(),
        title: v.get("artistName")?.as_str()?.to_string(),
        subtitle: v.get("primaryGenreName").and_then(|g| g.as_str()).map(|s| s.to_string()),
        art: None,
        duration_secs: None,
        explicit: None,
        year: None,
        track_count: None,
    })
}

async fn get_json(http: &reqwest::Client, url: &str) -> Result<Value> {
    let resp = http.get(url).send().await?;
    let status = resp.status();
    if status.as_u16() == 403 || status.as_u16() == 429 {
        return Err(Error::other("Apple's catalog is rate-limiting us — try again in a moment"));
    }
    if !status.is_success() {
        let text = resp.text().await.unwrap_or_default();
        return Err(Error::status(status.as_u16(), &text));
    }
    let text = resp.text().await?;
    Ok(serde_json::from_str(&text)?)
}

fn results(v: &Value) -> Vec<Value> {
    v.get("results").and_then(|r| r.as_array()).cloned().unwrap_or_default()
}

pub struct AppleResults {
    pub tracks: Vec<MediaItem>,
    pub albums: Vec<MediaItem>,
    pub artists: Vec<MediaItem>,
}

pub async fn search(http: &reqwest::Client, term: &str, country: &str) -> Result<AppleResults> {
    let q = url::form_urlencoded::byte_serialize(term.as_bytes()).collect::<String>();
    let u_songs = format!("{BASE}/search?term={q}&media=music&entity=song&limit=12&country={country}");
    let u_albums = format!("{BASE}/search?term={q}&media=music&entity=album&limit=10&country={country}");
    let u_artists = format!("{BASE}/search?term={q}&media=music&entity=musicArtist&limit=6&country={country}");
    let (songs, albums, artists) = futures::join!(get_json(http, &u_songs), get_json(http, &u_albums), get_json(http, &u_artists));
    // One failing endpoint shouldn't kill the others, but surface if all fail.
    if songs.is_err() && albums.is_err() && artists.is_err() {
        return Err(songs.err().unwrap());
    }
    Ok(AppleResults {
        tracks: songs.map(|v| results(&v).iter().filter_map(track_from).collect()).unwrap_or_default(),
        albums: albums.map(|v| results(&v).iter().filter_map(album_from).collect()).unwrap_or_default(),
        artists: artists.map(|v| results(&v).iter().filter_map(artist_from).collect()).unwrap_or_default(),
    })
}

pub async fn artist_albums(http: &reqwest::Client, artist_id: &str, country: &str) -> Result<Vec<MediaItem>> {
    if !is_digits(artist_id) {
        return Err(Error::other("not an Apple Music artist id"));
    }
    let v = get_json(http, &format!("{BASE}/lookup?id={artist_id}&entity=album&limit=80&country={country}")).await?;
    // The lookup also returns compilations the artist merely appears on; keep their own.
    let mut albums: Vec<MediaItem> = results(&v)
        .iter()
        .filter(|r| r.get("wrapperType").and_then(|w| w.as_str()) == Some("collection"))
        .filter(|r| r.get("artistId").and_then(|a| a.as_u64()).map(|a| a.to_string()) == Some(artist_id.to_string()))
        .filter_map(album_from)
        .collect();
    albums.sort_by_key(|a| std::cmp::Reverse(a.year));
    Ok(albums)
}
