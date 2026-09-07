//! DIDL-Lite parsing and construction.

use super::model::{ItemKind, Track};
use super::soap::parse_hms;
use super::xml;

#[derive(Debug, Clone, Default)]
pub struct DidlItem {
    pub id: String,
    pub parent_id: String,
    pub title: String,
    pub creator: Option<String>,
    pub album: Option<String>,
    pub art: Option<String>,
    pub class: String,
    pub res_uri: Option<String>,
    pub protocol_info: Option<String>,
    pub duration_secs: Option<u32>,
    /// r:resMD — nested, escaped DIDL used when playing favorites
    pub res_md: Option<String>,
    pub description: Option<String>,
    pub r_type: Option<String>,
    pub stream_content: Option<String>,
    pub is_container: bool,
}

pub fn parse_items(didl: &str) -> Vec<DidlItem> {
    let mut out = Vec::new();
    let doc = match xml::parse(didl) {
        Ok(d) => d,
        Err(_) => return out,
    };
    for node in doc.descendants().filter(|n| n.is_element() && matches!(n.tag_name().name(), "item" | "container")) {
        let mut item = DidlItem {
            id: xml::attr(node, "id").unwrap_or_default(),
            parent_id: xml::attr(node, "parentID").unwrap_or_default(),
            is_container: node.tag_name().name() == "container",
            ..Default::default()
        };
        for c in node.children().filter(|c| c.is_element()) {
            let text = c.text().map(|s| s.to_string());
            match c.tag_name().name() {
                "title" => item.title = text.unwrap_or_default(),
                "creator" => item.creator = xml::non_empty(text),
                "album" => item.album = xml::non_empty(text),
                "albumArtURI" => {
                    if item.art.is_none() {
                        item.art = xml::non_empty(text)
                    }
                }
                "class" => item.class = text.unwrap_or_default(),
                "res" => {
                    if item.res_uri.is_none() {
                        item.res_uri = xml::non_empty(text);
                        item.protocol_info = xml::attr(c, "protocolInfo");
                        item.duration_secs = xml::attr(c, "duration").and_then(|d| parse_hms(&d));
                    }
                }
                "resMD" => item.res_md = xml::non_empty(text),
                "description" => item.description = xml::non_empty(text),
                "type" => item.r_type = xml::non_empty(text),
                "streamContent" => item.stream_content = xml::non_empty(text),
                _ => {}
            }
        }
        out.push(item);
    }
    out
}

/// Sonos art URIs are often relative ("/getaa?s=1&u=...") — make them loadable.
pub fn absolutize_art(art: &str, ip: &str) -> String {
    if art.starts_with("http://") || art.starts_with("https://") {
        art.to_string()
    } else if art.starts_with('/') {
        format!("http://{}:1400{}", ip, art)
    } else {
        format!("http://{}:1400/{}", ip, art)
    }
}

pub fn to_track(item: &DidlItem, ip: &str) -> Track {
    Track {
        title: item.title.clone(),
        artist: item.creator.clone(),
        album: item.album.clone(),
        art: item.art.as_deref().map(|a| absolutize_art(a, ip)),
        uri: item.res_uri.clone(),
        duration_secs: item.duration_secs,
        stream_content: item.stream_content.clone(),
    }
}

/// Classify a favorite / browse item by its URI and class.
pub fn kind_of(item: &DidlItem) -> ItemKind {
    let uri = item.res_uri.as_deref().unwrap_or("");
    let inner_class = item
        .res_md
        .as_deref()
        .and_then(|md| parse_items(md).into_iter().next())
        .map(|i| i.class)
        .unwrap_or_default();
    let class = if inner_class.is_empty() { item.class.as_str() } else { inner_class.as_str() };
    if uri.starts_with("x-sonosapi-stream:")
        || uri.starts_with("x-sonosapi-radio:")
        || uri.starts_with("x-rincon-mp3radio:")
        || uri.starts_with("x-sonosapi-hls")
        || uri.starts_with("hls-radio:")
        || uri.starts_with("aac:")
        || class.contains("audioBroadcast")
    {
        return ItemKind::Station;
    }
    if class.contains("musicArtist") || class.contains("person") {
        return ItemKind::Artist;
    }
    if class.contains("playlistContainer") {
        return ItemKind::Playlist;
    }
    if class.contains("album") || uri.contains("album%3a") || uri.contains("album%3A") {
        return ItemKind::Album;
    }
    if class.contains("musicTrack") || uri.starts_with("x-sonos-spotify:") || uri.starts_with("x-sonos-http:") {
        return ItemKind::Track;
    }
    if uri.starts_with("x-rincon-cpcontainer:") {
        return ItemKind::Playlist;
    }
    ItemKind::Other
}

/// Extract `sid` from a Sonos URI query string.
pub fn uri_sid(uri: &str) -> Option<u32> {
    uri_param(uri, "sid")
}
pub fn uri_sn(uri: &str) -> Option<u32> {
    uri_param(uri, "sn")
}
fn uri_param(uri: &str, key: &str) -> Option<u32> {
    let q = uri.split('?').nth(1)?;
    for pair in q.split('&') {
        let mut kv = pair.splitn(2, '=');
        if kv.next()? == key {
            return kv.next()?.parse().ok();
        }
    }
    None
}

/// Human-ish service label from a sid.
pub fn service_label(sid: u32) -> Option<&'static str> {
    Some(match sid {
        9 | 12 => "spotify",
        204 => "apple",
        254 => "tunein",
        303 | 333 => "sonos-radio",
        201 => "amazon",
        236 => "pandora",
        284 => "youtube",
        _ => return None,
    })
}

/// Metadata DIDL for SetAVTransportURI / AddURIToQueue.
pub fn build_metadata(item_id: &str, parent_id: &str, title: &str, upnp_class: &str, desc: &str) -> String {
    format!(
        "<DIDL-Lite xmlns:dc=\"http://purl.org/dc/elements/1.1/\" \
         xmlns:upnp=\"urn:schemas-upnp-org:metadata-1-0/upnp/\" \
         xmlns:r=\"urn:schemas-rinconnetworks-com:metadata-1-0/\" \
         xmlns=\"urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/\">\
         <item id=\"{id}\" parentID=\"{parent}\" restricted=\"true\">\
         <dc:title>{title}</dc:title><upnp:class>{class}</upnp:class>\
         <desc id=\"cdudn\" nameSpace=\"urn:schemas-rinconnetworks-com:metadata-1-0/\">{desc}</desc>\
         </item></DIDL-Lite>",
        id = xml::escape(item_id),
        parent = xml::escape(parent_id),
        title = xml::escape(title),
        class = xml::escape(upnp_class),
        desc = xml::escape(desc),
    )
}
