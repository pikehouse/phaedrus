//! Gentle write-path test: no audible change. Sets a volume to its current
//! value, appends a track to the end of the queue and removes it again.
use phaedrus_lib::sonos::items;
use phaedrus_lib::sonos::model::*;
use phaedrus_lib::sonos::system::SonosSystem;
use phaedrus_lib::store::Store;

#[tokio::main]
async fn main() {
    let tmp = std::env::temp_dir().join("phaedrus-probe.json");
    let sys = SonosSystem::new(Store::load(Some(tmp)));
    let topo = sys.discover().await.expect("discover");
    let g = topo.groups.iter().max_by_key(|g| g.members.len()).unwrap();
    let ip = g.coordinator_ip.clone();
    let uuid = g.coordinator_uuid.clone();
    let members: Vec<MemberRef> = g.members.iter().map(|m| MemberRef { uuid: m.uuid.clone(), name: m.name.clone(), ip: m.ip.clone() }).collect();

    let st = sys.group_state(&ip, &members).await.expect("state");
    let m = &st.members[0];
    sys.set_volume(&m.ip, m.volume).await.expect("set_volume same value");
    println!("SET_VOLUME ok ({} stays {})", m.name, m.volume);
    sys.set_play_mode(&ip, &st.play_mode).await.expect("set_play_mode same");
    println!("SET_PLAY_MODE ok ({})", st.play_mode);

    let before = sys.queue(&ip, 0, 500).await.expect("queue").total;
    // Real catalog ids come from a live search rather than anyone's library.
    let found = sys.search(&ip, "steely dan").await.expect("search");
    let items_to_try: Vec<MediaItem> =
        [ServiceId::Apple, ServiceId::Spotify].into_iter().filter_map(|svc| found.tracks.iter().find(|t| t.service == svc).cloned()).collect();
    for item in items_to_try {
        match sys.play_item(&ip, &uuid, &item, PlayAction::Later).await {
            Ok(()) => {
                let q = sys.queue(&ip, 0, 500).await.expect("queue");
                let last = q.items.last().cloned();
                println!("ADD LATER {:?} ok: total {} -> {} last={:?} uri={}", item.service, before, q.total, last.as_ref().map(|l| (&l.index, &l.title, &l.artist)), last.as_ref().map(|l| l.uri.as_str()).unwrap_or(""));
                if q.total > before {
                    sys.remove_from_queue(&ip, q.total).await.expect("remove");
                    let after = sys.queue(&ip, 0, 500).await.expect("queue").total;
                    println!("REMOVE ok: total now {}", after);
                }
            }
            Err(e) => println!("ADD LATER {:?} FAILED: {}", item.service, e),
        }
    }
    // Just print what we'd send for a station and an album (no play).
    let acc = items::Accounts::default();
    for it in [found.stations.first(), found.albums.first()].into_iter().flatten() {
        match items::build(it, &acc) {
            Ok(p) => println!("{:?} uri={} meta={}", it.kind, p.uri, p.metadata),
            Err(e) => println!("{:?} build failed: {e}", it.kind),
        }
    }
}
