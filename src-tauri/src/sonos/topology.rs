//! ZoneGroupState → Groups.

use std::collections::HashMap;

use super::error::Result;
use super::model::{Group, Zone};
use super::xml;

fn ip_from_location(loc: &str) -> Option<String> {
    let rest = loc.strip_prefix("http://")?;
    rest.split(['/', ':']).next().map(|s| s.to_string())
}

/// Parse the (already entity-decoded) ZoneGroupState document.
/// `models` maps uuid → model name when known.
pub fn parse_groups(zgs: &str, models: &HashMap<String, String>) -> Result<Vec<Group>> {
    let doc = xml::parse(zgs)?;
    let mut groups = Vec::new();
    for zg in doc.descendants().filter(|n| n.is_element() && n.tag_name().name() == "ZoneGroup") {
        let coordinator = xml::attr(zg, "Coordinator").unwrap_or_default();
        let id = xml::attr(zg, "ID").unwrap_or_else(|| coordinator.clone());
        let mut members: Vec<Zone> = Vec::new();
        let mut coordinator_ip: Option<String> = None;
        let mut coordinator_name: Option<String> = None;
        for m in zg.children().filter(|n| n.is_element() && n.tag_name().name() == "ZoneGroupMember") {
            let uuid = xml::attr(m, "UUID").unwrap_or_default();
            let name = xml::attr(m, "ZoneName").unwrap_or_default();
            let ip = xml::attr(m, "Location").and_then(|l| ip_from_location(&l)).unwrap_or_default();
            let invisible = xml::attr(m, "Invisible").as_deref() == Some("1");
            if uuid == coordinator {
                coordinator_ip = Some(ip.clone());
                coordinator_name = Some(name.clone());
            }
            if ip.is_empty() || uuid.is_empty() {
                continue;
            }
            members.push(Zone { model: models.get(&uuid).cloned(), uuid, name, ip, invisible });
        }
        let visible: Vec<Zone> = members.iter().filter(|z| !z.invisible).cloned().collect();
        if visible.is_empty() {
            continue;
        }
        // Coordinator first.
        let mut ordered: Vec<Zone> = Vec::with_capacity(visible.len());
        if let Some(c) = visible.iter().find(|z| z.uuid == coordinator) {
            ordered.push(c.clone());
        }
        for z in visible.iter().filter(|z| z.uuid != coordinator) {
            ordered.push(z.clone());
        }
        let coordinator_ip = coordinator_ip.unwrap_or_else(|| ordered[0].ip.clone());
        let name = coordinator_name
            .filter(|n| !n.is_empty() && visible.iter().any(|z| z.uuid == coordinator))
            .unwrap_or_else(|| ordered[0].name.clone());
        groups.push(Group { id, coordinator_uuid: coordinator, coordinator_ip, name, members: ordered });
    }
    // Stable, human order: by display name.
    groups.sort_by_key(|g| g.name.to_lowercase());
    Ok(groups)
}

/// Every (uuid, ip) in the household, visible or not — handy for caching IPs.
pub fn all_member_ips(zgs: &str) -> Vec<(String, String)> {
    let mut out = Vec::new();
    if let Ok(doc) = xml::parse(zgs) {
        for m in doc.descendants().filter(|n| n.is_element() && n.tag_name().name() == "ZoneGroupMember") {
            if let (Some(uuid), Some(ip)) = (xml::attr(m, "UUID"), xml::attr(m, "Location").and_then(|l| ip_from_location(&l))) {
                out.push((uuid, ip));
            }
        }
    }
    out
}
