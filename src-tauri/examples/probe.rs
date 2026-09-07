//! Read-mostly smoke test against whatever Sonos system is on the LAN.
//! cargo run --example probe -- [search term]
use std::time::Instant;

use phaedrus_lib::sonos::model::{MemberRef, ServiceId};
use phaedrus_lib::sonos::system::SonosSystem;
use phaedrus_lib::store::Store;

#[tokio::main]
async fn main() {
    let _ = env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info")).try_init();
    let term = std::env::args().nth(1).unwrap_or_else(|| "steely dan".into());
    let tmp = std::env::temp_dir().join("phaedrus-probe.json");
    let sys = SonosSystem::new(Store::load(Some(tmp)));

    let t = Instant::now();
    let topo = match sys.discover().await {
        Ok(t) => t,
        Err(e) => {
            eprintln!("discover failed: {e}");
            return;
        }
    };
    println!("DISCOVER {:?} household={} groups={}", t.elapsed(), topo.household_id, topo.groups.len());
    for g in &topo.groups {
        println!("  GROUP {} coord={} ({}) members={:?}", g.name, g.coordinator_ip, g.coordinator_uuid, g.members.iter().map(|m| format!("{}@{} {}", m.name, m.ip, m.model.clone().unwrap_or_default())).collect::<Vec<_>>());
    }
    let t = Instant::now();
    let topo2 = sys.topology().await.expect("topology");
    println!("TOPOLOGY (cached path) {:?} groups={}", t.elapsed(), topo2.groups.len());

    // Pick the group with the most members (likely the one playing).
    let g = topo.groups.iter().max_by_key(|g| g.members.len()).unwrap();
    let members: Vec<MemberRef> = g.members.iter().map(|m| MemberRef { uuid: m.uuid.clone(), name: m.name.clone(), ip: m.ip.clone() }).collect();
    let t = Instant::now();
    let st = sys.group_state(&g.coordinator_ip, &members).await.expect("group state");
    println!("STATE {:?} state={} src={} radio={} pos={}/{} q={:?}/{:?} mode={} xf={} vol={} mute={}", t.elapsed(), st.state, st.source, st.is_radio, st.position_secs, st.duration_secs, st.queue_index, st.queue_length, st.play_mode, st.crossfade, st.volume, st.muted);
    println!("  TRACK {:?}", st.track);
    for m in &st.members {
        println!("  MEMBER {} vol={} mute={}", m.name, m.volume, m.muted);
    }
    let t = Instant::now();
    let q = sys.queue(&g.coordinator_ip, 0, 200).await.expect("queue");
    println!("QUEUE {:?} total={} first={:?}", t.elapsed(), q.total, q.items.first().map(|i| (&i.index, &i.title, &i.art)));
    let t = Instant::now();
    let favs = sys.favorites(&g.coordinator_ip).await.expect("favorites");
    println!("FAVORITES {:?} n={}", t.elapsed(), favs.len());
    for f in favs.iter().take(30) {
        println!("  FAV {:?} playable={} svc={:?} {} | {}", f.kind, f.playable, f.service, f.title, f.art.clone().unwrap_or_default().chars().take(60).collect::<String>());
    }
    let svcs = sys.services(&g.coordinator_ip).await.expect("services");
    println!("SERVICES {:?}", svcs.iter().map(|s| format!("{}:{}", s.name, if s.linked { "linked" } else { "needs link" })).collect::<Vec<_>>());
    let t = Instant::now();
    let res = sys.search(&g.coordinator_ip, &term).await.expect("search");
    println!("SEARCH '{}' {:?} tracks={} albums={} artists={} playlists={} stations={} errors={:?}", term, t.elapsed(), res.tracks.len(), res.albums.len(), res.artists.len(), res.playlists.len(), res.stations.len(), res.errors);
    for it in res.tracks.iter().take(4) { println!("  TRACK {:?} {} — {:?} id={} art={}", it.service, it.title, it.subtitle, it.id, it.art.is_some()); }
    for it in res.albums.iter().take(3) { println!("  ALBUM {:?} {} — {:?} id={} {:?}", it.service, it.title, it.subtitle, it.id, it.year); }
    for it in res.artists.iter().take(2) { println!("  ARTIST {:?} {} id={}", it.service, it.title, it.id); }
    for it in res.stations.iter().take(3) { println!("  STATION {} — {:?} id={} art={:?}", it.title, it.subtitle, it.id, it.art); }
    if let Some(a) = res.artists.iter().find(|a| a.service == ServiceId::Apple) {
        let albums = sys.artist_albums(&g.coordinator_ip, a).await.expect("artist albums");
        println!("ARTIST ALBUMS for {} → {} e.g. {:?}", a.title, albums.len(), albums.iter().take(3).map(|x| format!("{} ({:?})", x.title, x.year)).collect::<Vec<_>>());
    }
    match sys.link_begin(&g.coordinator_ip, ServiceId::Spotify).await {
        Ok(s) => println!("SPOTIFY LINK url={} code={}", s.url, s.link_code),
        Err(e) => println!("SPOTIFY LINK ERR {e}"),
    }
}
