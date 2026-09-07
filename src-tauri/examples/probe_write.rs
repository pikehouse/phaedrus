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
    let items_to_try = vec![
        MediaItem { service: ServiceId::Apple, kind: ItemKind::Track, id: "1650885304".into(), title: "Reelin' In The Years".into(), subtitle: None, art: None, duration_secs: None, explicit: None, year: None, track_count: None },
        MediaItem { service: ServiceId::Spotify, kind: ItemKind::Track, id: "spotify:track:04boE4u1AupbrGlI62WvoO".into(), title: "White Noise 3 Hour Long".into(), subtitle: None, art: None, duration_secs: None, explicit: None, year: None, track_count: None },
    ];
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
    let acc = items::Accounts { spotify_sid: 12, spotify_sn: 3, apple_sn: 1 };
    let station = MediaItem { service: ServiceId::Tunein, kind: ItemKind::Station, id: "s32537".into(), title: "KEXP".into(), subtitle: None, art: None, duration_secs: None, explicit: None, year: None, track_count: None };
    let p = items::build(&station, &acc).unwrap();
    println!("STATION uri={} meta={}", p.uri, p.metadata);
    let album = MediaItem { service: ServiceId::Spotify, kind: ItemKind::Album, id: "spotify:album:6QuJH3SudxdgzH8Bl4b7o8".into(), title: "Dylan's Gospel".into(), subtitle: None, art: None, duration_secs: None, explicit: None, year: None, track_count: None };
    let p = items::build(&album, &acc).unwrap();
    println!("ALBUM uri={} meta={}", p.uri, p.metadata);
}
