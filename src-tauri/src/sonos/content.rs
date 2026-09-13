//! ContentDirectory: queue and favorites.

use super::didl::{self, DidlItem};
use super::error::Result;
use super::model::{Favorite, ItemKind, QueueItem, QueuePage};
use super::soap::{Service, SoapClient};

pub struct BrowseResult {
    pub items: Vec<DidlItem>,
    pub total: u32,
}

/// Sonos returns at most this many items per Browse.
const PAGE: u32 = 100;

/// Next (StartingIndex, RequestedCount) when `got` of `want` items starting at
/// `start` have arrived and the speaker reported `total` matches; None when done.
fn next_page(start: u32, want: u32, got: u32, total: Option<u32>) -> Option<(u32, u32)> {
    if got >= want {
        return None;
    }
    let index = start.checked_add(got)?;
    if total.is_some_and(|t| index >= t) {
        return None;
    }
    Some((index, (want - got).min(PAGE)))
}

/// Up to `count` children of `object_id` from `start`, fetched in pages.
pub async fn browse(soap: &SoapClient, ip: &str, object_id: &str, start: u32, count: u32) -> Result<BrowseResult> {
    let mut items = Vec::new();
    let mut total = None;
    while let Some((index, requested)) = next_page(start, count, items.len() as u32, total) {
        let (s, c) = (index.to_string(), requested.to_string());
        let r = soap
            .call(
                ip,
                Service::ContentDirectory,
                "Browse",
                &[("ObjectID", object_id), ("BrowseFlag", "BrowseDirectChildren"), ("Filter", "*"), ("StartingIndex", &s), ("RequestedCount", &c), ("SortCriteria", "")],
            )
            .await?;
        let page = didl::parse_items(r.get_or_empty("Result"));
        let n = page.len() as u32;
        // No TotalMatches: assume this reply held everything that's left.
        total = Some(r.get_u32("TotalMatches").unwrap_or(index.saturating_add(n)));
        items.extend(page);
        if n == 0 {
            break;
        }
    }
    Ok(BrowseResult { items, total: total.unwrap_or(0) })
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

#[cfg(test)]
mod tests {
    use super::next_page;

    #[test]
    fn paging_asks_in_hundreds_until_count_or_total() {
        assert_eq!(next_page(0, 200, 0, None), Some((0, 100)));
        assert_eq!(next_page(0, 200, 100, Some(250)), Some((100, 100)));
        assert_eq!(next_page(0, 200, 200, Some(250)), None, "count reached");
        assert_eq!(next_page(0, 500, 200, Some(250)), Some((200, 100)));
        assert_eq!(next_page(0, 500, 250, Some(250)), None, "total exhausted");
        assert_eq!(next_page(10, 30, 0, None), Some((10, 30)));
        assert_eq!(next_page(0, 200, 40, Some(40)), None);
        assert_eq!(next_page(0, 0, 0, None), None);
        assert_eq!(next_page(u32::MAX, 10, 1, None), None, "no overflow");
    }
}
