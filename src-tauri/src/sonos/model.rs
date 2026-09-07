//! Wire model — mirrors src/api/types.ts exactly.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Zone {
    pub uuid: String,
    pub name: String,
    pub ip: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    pub invisible: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Group {
    pub id: String,
    pub coordinator_uuid: String,
    pub coordinator_ip: String,
    pub name: String,
    pub members: Vec<Zone>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Topology {
    pub household_id: String,
    pub groups: Vec<Group>,
    pub discovered_at: u64,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Track {
    pub title: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub artist: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub album: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub art: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub uri: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub duration_secs: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stream_content: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemberVolume {
    pub uuid: String,
    pub name: String,
    pub ip: String,
    pub volume: u32,
    pub muted: bool,
}

/// Member descriptor passed in from the frontend for get_group_state.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemberRef {
    pub uuid: String,
    pub name: String,
    pub ip: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GroupState {
    pub state: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub track: Option<Track>,
    pub position_secs: u32,
    pub duration_secs: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub queue_index: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub queue_length: Option<u32>,
    pub play_mode: String,
    pub crossfade: bool,
    pub is_radio: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub station_name: Option<String>,
    pub source: String,
    pub volume: u32,
    pub muted: bool,
    pub members: Vec<MemberVolume>,
    pub fetched_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueueItem {
    pub index: u32,
    pub title: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub artist: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub album: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub art: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub duration_secs: Option<u32>,
    pub uri: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueuePage {
    pub items: Vec<QueueItem>,
    pub total: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ItemKind {
    Track,
    Album,
    Playlist,
    Artist,
    Station,
    Other,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Favorite {
    pub id: String,
    pub title: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub art: Option<String>,
    pub kind: ItemKind,
    pub playable: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub service: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub uri: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub metadata: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ServiceId {
    Apple,
    Spotify,
    Tunein,
}

impl ServiceId {
    pub fn label(self) -> &'static str {
        match self {
            ServiceId::Apple => "Apple Music",
            ServiceId::Spotify => "Spotify",
            ServiceId::Tunein => "TuneIn",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MusicService {
    pub id: ServiceId,
    pub name: String,
    pub available: bool,
    pub linked: bool,
    pub needs_link: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaItem {
    pub service: ServiceId,
    pub kind: ItemKind,
    pub id: String,
    pub title: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub subtitle: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub art: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub duration_secs: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub explicit: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub year: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub track_count: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchError {
    pub service: ServiceId,
    pub message: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResults {
    pub query: String,
    pub tracks: Vec<MediaItem>,
    pub albums: Vec<MediaItem>,
    pub artists: Vec<MediaItem>,
    pub playlists: Vec<MediaItem>,
    pub stations: Vec<MediaItem>,
    pub errors: Vec<SearchError>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PlayAction {
    Now,
    Next,
    Later,
    Replace,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkSession {
    pub service: ServiceId,
    pub url: String,
    pub link_code: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LinkStatus {
    Pending,
    Linked,
    Failed,
}

pub fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}
