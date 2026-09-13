//! Turning a search result or favorite into something a Sonos will play:
//! the URI + DIDL metadata pair, and the queue choreography around it.

use super::didl::build_metadata;
use super::error::{Error, Result};
use super::model::{Favorite, ItemKind, MediaItem, PlayAction, ServiceId};
use super::soap::{is_alnum, is_digits, SoapClient};
use super::transport;

/// Which account slots this household uses for each service.
#[derive(Debug, Clone)]
pub struct Accounts {
    pub spotify_sid: u32,
    pub spotify_sn: u32,
    pub apple_sn: u32,
}

impl Default for Accounts {
    fn default() -> Self {
        Self { spotify_sid: 12, spotify_sn: 1, apple_sn: 1 }
    }
}

#[derive(Debug, Clone)]
pub struct Playable {
    pub uri: String,
    pub metadata: String,
    pub is_stream: bool,
    pub title: String,
}

/// Sonos-style encoding: only ':' is escaped, as lowercase %3a.
fn enc(s: &str) -> String {
    s.replace(':', "%3a")
}

fn token(service_type: u32) -> String {
    format!("SA_RINCON{t}_X_#Svc{t}-0-Token", t = service_type)
}

pub fn build(item: &MediaItem, acc: &Accounts) -> Result<Playable> {
    let title = item.title.clone();
    match (item.service, item.kind) {
        (ServiceId::Spotify, kind) => {
            let sid = acc.spotify_sid;
            let sn = acc.spotify_sn;
            let st = sid * 256 + 7;
            let desc = token(st);
            let raw = item.id.as_str(); // spotify:track:xxx
            let bare = raw.rsplit(':').next().unwrap_or(raw);
            match kind {
                ItemKind::Track => Ok(Playable {
                    uri: format!("x-sonos-spotify:{}?sid={}&flags=8224&sn={}", enc(raw), sid, sn),
                    metadata: build_metadata(&format!("10032020{}", enc(raw)), &format!("00020000track%3a{}", bare), &title, "object.item.audioItem.musicTrack", &desc),
                    is_stream: false,
                    title,
                }),
                ItemKind::Album => Ok(Playable {
                    uri: format!("x-rincon-cpcontainer:1004206c{}?sid={}&flags=8300&sn={}", enc(raw), sid, sn),
                    metadata: build_metadata(&format!("1004206c{}", enc(raw)), &format!("00020000album%3a{}", bare), &title, "object.container.album.musicAlbum", &desc),
                    is_stream: false,
                    title,
                }),
                ItemKind::Playlist => Ok(Playable {
                    uri: format!("x-rincon-cpcontainer:1006206c{}?sid={}&flags=8300&sn={}", enc(raw), sid, sn),
                    metadata: build_metadata(&format!("1006206c{}", enc(raw)), &format!("00020000playlist%3a{}", bare), &title, "object.container.playlistContainer", &desc),
                    is_stream: false,
                    title,
                }),
                ItemKind::Artist => {
                    let radio = format!("spotify:artistRadio:{}", bare);
                    Ok(Playable {
                        uri: format!("x-sonosapi-radio:{}?sid={}&flags=8300&sn={}", enc(&radio), sid, sn),
                        metadata: build_metadata(
                            &format!("100c206c{}", enc(&radio)),
                            &format!("10052064{}", enc(raw)),
                            &format!("{} Radio", title),
                            "object.item.audioItem.audioBroadcast.#artistRadio",
                            &desc,
                        ),
                        is_stream: true,
                        title: format!("{} Radio", title),
                    })
                }
                _ => Err(Error::other("can't play that kind of Spotify item")),
            }
        }
        (ServiceId::Apple, kind) => {
            let sn = acc.apple_sn;
            let desc = token(204 * 256 + 7);
            let id = item.id.as_str();
            // Catalog ids are numeric; playlist ids look like "pl.u-AbC123".
            let valid = match kind {
                ItemKind::Playlist => !id.is_empty() && id.bytes().all(|b| b.is_ascii_alphanumeric() || b"._-".contains(&b)),
                _ => is_digits(id),
            };
            if !valid {
                return Err(Error::other("not an Apple Music id"));
            }
            match kind {
                ItemKind::Track => Ok(Playable {
                    uri: format!("x-sonos-http:song%3a{}.mp4?sid=204&flags=8232&sn={}", id, sn),
                    metadata: build_metadata(&format!("10032028song%3a{}", id), &format!("10032028song%3a{}", id), &title, "object.item.audioItem.musicTrack", &desc),
                    is_stream: false,
                    title,
                }),
                ItemKind::Album => Ok(Playable {
                    uri: format!("x-rincon-cpcontainer:1004206calbum%3a{}?sid=204&flags=8300&sn={}", id, sn),
                    metadata: build_metadata(&format!("1004206calbum%3a{}", id), &format!("1004206calbum%3a{}", id), &title, "object.container.album.musicAlbum", &desc),
                    is_stream: false,
                    title,
                }),
                ItemKind::Playlist => Ok(Playable {
                    uri: format!("x-rincon-cpcontainer:1006206cplaylist%3a{}?sid=204&flags=8300&sn={}", id, sn),
                    metadata: build_metadata(&format!("1006206cplaylist%3a{}", id), &format!("1006206cplaylist%3a{}", id), &title, "object.container.playlistContainer", &desc),
                    is_stream: false,
                    title,
                }),
                ItemKind::Artist => Err(Error::other("Pick one of this artist's albums")),
                _ => Err(Error::other("can't play that kind of Apple Music item")),
            }
        }
        (ServiceId::Tunein, ItemKind::Station) => {
            let id = item.id.as_str();
            if !is_alnum(id) {
                return Err(Error::other("not a TuneIn station id"));
            }
            Ok(Playable {
                uri: format!("x-sonosapi-stream:{}?sid=254&flags=8224&sn=0", id),
                metadata: build_metadata(&format!("F00092020{}", id), "L", &title, "object.item.audioItem.audioBroadcast", "SA_RINCON65031_"),
                is_stream: true,
                title,
            })
        }
        _ => Err(Error::other("can't play that item")),
    }
}

fn is_stream_uri(uri: &str) -> bool {
    uri.starts_with("x-sonosapi-stream:")
        || uri.starts_with("x-sonosapi-radio:")
        || uri.starts_with("x-rincon-mp3radio:")
        || uri.starts_with("x-sonosapi-hls")
        || uri.starts_with("hls-radio:")
        || uri.starts_with("aac:")
}

pub fn from_favorite(fav: &Favorite) -> Result<Playable> {
    let uri = fav.uri.clone().filter(|u| !u.is_empty()).ok_or_else(|| Error::other("That favorite can't be played directly"))?;
    Ok(Playable {
        is_stream: fav.kind == ItemKind::Station || is_stream_uri(&uri),
        uri,
        metadata: fav.metadata.clone().unwrap_or_default(),
        title: fav.title.clone(),
    })
}

pub(crate) async fn ensure_queue_is_source(soap: &SoapClient, ip: &str, coordinator_uuid: &str) -> Result<()> {
    let cur = transport::current_uri(soap, ip).await.unwrap_or_default();
    if !cur.starts_with("x-rincon-queue:") {
        transport::set_av_transport_uri(soap, ip, &format!("x-rincon-queue:{}#0", coordinator_uuid), "").await?;
    }
    Ok(())
}

pub async fn perform(soap: &SoapClient, ip: &str, coordinator_uuid: &str, p: &Playable, action: PlayAction) -> Result<()> {
    if p.is_stream {
        transport::set_av_transport_uri(soap, ip, &p.uri, &p.metadata).await?;
        transport::play(soap, ip).await?;
        return Ok(());
    }
    match action {
        PlayAction::Replace => {
            transport::remove_all_tracks(soap, ip).await?;
            let first = transport::add_uri_to_queue(soap, ip, &p.uri, &p.metadata, 0, false).await?;
            ensure_queue_is_source(soap, ip, coordinator_uuid).await?;
            transport::seek_track(soap, ip, first).await?;
            transport::play(soap, ip).await?;
        }
        PlayAction::Now => {
            let cur = transport::current_track_number(soap, ip).await.unwrap_or(0);
            let first = transport::add_uri_to_queue(soap, ip, &p.uri, &p.metadata, cur + 1, true).await?;
            ensure_queue_is_source(soap, ip, coordinator_uuid).await?;
            transport::seek_track(soap, ip, first).await?;
            transport::play(soap, ip).await?;
        }
        PlayAction::Next => {
            let cur = transport::current_track_number(soap, ip).await.unwrap_or(0);
            transport::add_uri_to_queue(soap, ip, &p.uri, &p.metadata, cur + 1, true).await?;
        }
        PlayAction::Later => {
            transport::add_uri_to_queue(soap, ip, &p.uri, &p.metadata, 0, false).await?;
        }
    }
    Ok(())
}
