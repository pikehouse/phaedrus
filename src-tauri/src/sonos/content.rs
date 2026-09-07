//! ContentDirectory: queue and favorites.

use super::didl::{self, DidlItem};
use super::error::Result;
use super::model::{Favorite, ItemKind, QueueItem, QueuePage};
use super::soap::{Service, SoapClient};

pub struct BrowseResult {
    pub items: Vec<DidlItem>,
    pub total: u32,
}

pub async fn browse(soap: &SoapClient, ip: &str, object_id: &str, start: u32, count: u32) -> Result<BrowseResult> {
    let (s, c) = (start.to_string(), count.to_string());
    let r = soap
        .call(
            ip,
            Service::ContentDirectory,
            "Browse",
            &[("ObjectID", object_id), ("BrowseFlag", "BrowseDirectChildren"), ("Filter", "*"), ("StartingIndex", &s), ("RequestedCount", &c), ("SortCriteria", "")],
        )
        .await?;
    let items = didl::parse_items(r.get_or_empty("Result"));
    let total = r.get_u32("TotalMatches").unwrap_or(items.len() as u32);
    Ok(BrowseResult { items, total })
}

pub async fn queue(soap: &SoapClient, ip: &str, start: u32, count: u32) -> Result<QueuePage> {
    let br = browse(soap, ip, "Q:0", start, count).await?;
    let items = br
        .items
        .iter()
        .enumerate()
        .map(|(i, it)| {
            let index = it.id.rsplit('/').next().and_then(|n| n.parse::<u32>().ok()).unwrap_or(start + i as u32 + 1);
            QueueItem {
                index,
                title: it.title.clone(),
                artist: it.creator.clone(),
                album: it.album.clone(),
                art: it.art.as_deref().map(|a| didl::absolutize_art(a, ip)),
                duration_secs: it.duration_secs,
                uri: it.res_uri.clone().unwrap_or_default(),
            }
        })
        .collect();
    Ok(QueuePage { items, total: br.total })
}

pub async fn favorites(soap: &SoapClient, ip: &str) -> Result<Vec<Favorite>> {
    let br = browse(soap, ip, "FV:2", 0, 200).await?;
    let mut out: Vec<Favorite> = br
        .items
        .iter()
        .map(|it| {
            let kind = didl::kind_of(it);
            let uri = it.res_uri.clone();
            let playable = uri.as_deref().map(|u| !u.is_empty()).unwrap_or(false) && kind != ItemKind::Artist;
            let service = uri.as_deref().and_then(didl::uri_sid).and_then(didl::service_label).map(|s| s.to_string()).or_else(|| {
                it.description.as_deref().map(|d| d.to_lowercase()).and_then(|d| {
                    if d.contains("spotify") {
                        Some("spotify".to_string())
                    } else if d.contains("apple") {
                        Some("apple".to_string())
                    } else if d.contains("tunein") || d.contains("radio") {
                        Some("sonos-radio".to_string())
                    } else {
                        None
                    }
                })
            });
            Favorite {
                id: it.id.clone(),
                title: it.title.clone(),
                description: it.description.clone(),
                art: it.art.as_deref().map(|a| didl::absolutize_art(a, ip)),
                kind,
                playable,
                service,
                uri,
                metadata: it.res_md.clone(),
            }
        })
        .collect();
    out.sort_by_key(|f| f.title.to_lowercase());
    Ok(out)
}
