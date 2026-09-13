//! Parser tests against XML captured from a real Sonos S2 household, anonymised
//! (uuids, addresses, room names and favorites replaced; structure kept).
use std::collections::HashMap;

use phaedrus_lib::sonos::didl;
use phaedrus_lib::sonos::items::{self, Accounts};
use phaedrus_lib::sonos::model::*;
use phaedrus_lib::sonos::soap::{format_hms, parse_hms};
use phaedrus_lib::sonos::topology;

fn fixture(name: &str) -> String {
    std::fs::read_to_string(format!("{}/tests/fixtures/{}", env!("CARGO_MANIFEST_DIR"), name)).unwrap()
}

#[test]
fn hms_round_trips() {
    assert_eq!(parse_hms("0:03:40"), Some(220));
    assert_eq!(parse_hms("1:02:03.500"), Some(3723));
    assert_eq!(parse_hms("NOT_IMPLEMENTED"), None);
    assert_eq!(parse_hms(""), None);
    assert_eq!(format_hms(3723), "1:02:03");
}

#[test]
fn hms_overflow_is_none_not_a_panic() {
    assert_eq!(parse_hms("4294967295:00:00"), None);
    assert_eq!(parse_hms("1193046:28:15"), Some(u32::MAX));
    assert_eq!(parse_hms("1193046:28:16"), None, "one past u32::MAX seconds");
}

#[test]
fn topology_collapses_stereo_pairs_and_orders_coordinator_first() {
    let zgs = fixture("zone_group_state.xml");
    let models: HashMap<String, String> = HashMap::new();
    let groups = topology::parse_groups(&zgs, &models).unwrap();
    // Capture had everything grouped under Study: 7 players, 5 visible rooms.
    let all: Vec<&Zone> = groups.iter().flat_map(|g| g.members.iter()).collect();
    assert_eq!(all.len(), 5, "hidden halves of stereo pairs must be dropped: {:?}", all.iter().map(|z| &z.name).collect::<Vec<_>>());
    let names: Vec<&str> = all.iter().map(|z| z.name.as_str()).collect();
    assert_eq!(names.iter().filter(|n| **n == "Kitchen").count(), 1);
    assert_eq!(names.iter().filter(|n| **n == "Living Room").count(), 1);
    let g = groups.iter().find(|g| g.name == "Study").expect("group named after coordinator");
    assert_eq!(g.members[0].uuid, g.coordinator_uuid);
    assert_eq!(g.coordinator_ip, "10.0.0.12");
    assert!(names.contains(&"Guest’s Room"), "unicode room names survive");
    assert_eq!(topology::all_member_ips(&zgs).len(), 7);
}

#[test]
fn favorites_classify_by_kind_and_service() {
    let items = didl::parse_items(&fixture("favorites.xml"));
    assert_eq!(items.len(), 5);
    let by_title = |t: &str| items.iter().find(|i| i.title == t).unwrap();

    let track = by_title("Rain on a Tin Roof");
    assert_eq!(didl::kind_of(track), ItemKind::Track);
    assert_eq!(didl::uri_sid(track.res_uri.as_ref().unwrap()), Some(12));
    assert_eq!(didl::uri_sn(track.res_uri.as_ref().unwrap()), Some(3));
    assert!(track.res_md.as_ref().unwrap().contains("SA_RINCON3079_X_#Svc3079-0-Token"), "nested resMD is decoded once");

    let album = by_title("Sunday's Record");
    assert_eq!(didl::kind_of(album), ItemKind::Album);
    assert_eq!(didl::service_label(didl::uri_sid(album.res_uri.as_ref().unwrap()).unwrap()), Some("spotify"));

    assert_eq!(didl::kind_of(by_title("Station One")), ItemKind::Station);
    assert_eq!(didl::kind_of(by_title("Jane Example")), ItemKind::Artist);
    assert!(by_title("Jane Example").res_uri.is_none());

    let apple = by_title("Late Album");
    assert_eq!(didl::kind_of(apple), ItemKind::Album);
    assert_eq!(didl::uri_sid(apple.res_uri.as_ref().unwrap()), Some(204));
}

#[test]
fn art_uris_become_absolute() {
    assert_eq!(didl::absolutize_art("/getaa?s=1&u=x", "10.0.0.5"), "http://10.0.0.5:1400/getaa?s=1&u=x");
    assert_eq!(didl::absolutize_art("https://i.scdn.co/a.jpg", "10.0.0.5"), "https://i.scdn.co/a.jpg");
}

fn item(service: ServiceId, kind: ItemKind, id: &str, title: &str) -> MediaItem {
    MediaItem { service, kind, id: id.into(), title: title.into(), subtitle: None, art: None, duration_secs: None, explicit: None, year: None, track_count: None }
}

#[test]
fn built_uris_match_what_sonos_itself_writes() {
    let acc = Accounts { spotify_sid: 12, spotify_sn: 3, apple_sn: 1 };

    let p = items::build(&item(ServiceId::Spotify, ItemKind::Track, "spotify:track:0ExampleTrack000000001", "Rain on a Tin Roof"), &acc).unwrap();
    assert_eq!(p.uri, "x-sonos-spotify:spotify%3atrack%3a0ExampleTrack000000001?sid=12&flags=8224&sn=3");
    assert!(p.metadata.contains("id=\"10032020spotify%3atrack%3a0ExampleTrack000000001\""));
    assert!(p.metadata.contains("SA_RINCON3079_X_#Svc3079-0-Token"));
    assert!(!p.is_stream);

    let p = items::build(&item(ServiceId::Spotify, ItemKind::Album, "spotify:album:0ExampleAlbum000000002", "Sunday's Record"), &acc).unwrap();
    assert_eq!(p.uri, "x-rincon-cpcontainer:1004206cspotify%3aalbum%3a0ExampleAlbum000000002?sid=12&flags=8300&sn=3");
    assert!(p.metadata.contains("object.container.album.musicAlbum"));
    assert!(p.metadata.contains("Sunday&apos;s Record"), "titles are XML-escaped");

    let p = items::build(&item(ServiceId::Spotify, ItemKind::Playlist, "spotify:playlist:0ExamplePlaylist000004", "Example Mix"), &acc).unwrap();
    assert_eq!(p.uri, "x-rincon-cpcontainer:1006206cspotify%3aplaylist%3a0ExamplePlaylist000004?sid=12&flags=8300&sn=3");

    let p = items::build(&item(ServiceId::Spotify, ItemKind::Artist, "spotify:artist:0ExampleArtist00000005", "Jane Example"), &acc).unwrap();
    assert_eq!(p.uri, "x-sonosapi-radio:spotify%3aartistRadio%3a0ExampleArtist00000005?sid=12&flags=8300&sn=3");
    assert!(p.is_stream);

    let p = items::build(&item(ServiceId::Apple, ItemKind::Track, "100000001", "Example Song"), &acc).unwrap();
    assert_eq!(p.uri, "x-sonos-http:song%3a100000001.mp4?sid=204&flags=8232&sn=1");
    assert!(p.metadata.contains("SA_RINCON52231_X_#Svc52231-0-Token"));

    let p = items::build(&item(ServiceId::Apple, ItemKind::Album, "100000002", "Late Album"), &acc).unwrap();
    assert_eq!(p.uri, "x-rincon-cpcontainer:1004206calbum%3a100000002?sid=204&flags=8300&sn=1");

    assert!(items::build(&item(ServiceId::Apple, ItemKind::Artist, "100000003", "Jane Example"), &acc).is_err());

    let p = items::build(&item(ServiceId::Tunein, ItemKind::Station, "s10001", "Station One"), &acc).unwrap();
    assert_eq!(p.uri, "x-sonosapi-stream:s10001?sid=254&flags=8224&sn=0");
    assert!(p.is_stream);
}

#[test]
fn favorite_playables_carry_metadata_through() {
    let items = didl::parse_items(&fixture("favorites.xml"));
    let station = items.iter().find(|i| i.title == "Station One").unwrap();
    let fav = Favorite {
        id: station.id.clone(),
        title: station.title.clone(),
        description: None,
        art: None,
        kind: didl::kind_of(station),
        playable: true,
        service: None,
        uri: station.res_uri.clone(),
        metadata: station.res_md.clone(),
    };
    let p = items::from_favorite(&fav).unwrap();
    assert!(p.is_stream);
    assert!(p.metadata.contains("audioBroadcast"));
}

#[test]
fn topology_coordinator_without_location_falls_back_to_a_member() {
    let zgs = r#"<ZoneGroupState><ZoneGroups><ZoneGroup Coordinator="RINCON_000E58A0000801400" ID="RINCON_000E58A0000801400:1">
        <ZoneGroupMember UUID="RINCON_000E58A0000801400" Location="" ZoneName="Porch"/>
        <ZoneGroupMember UUID="RINCON_000E58A0000901400" Location="http://10.0.0.90:1400/xml/device_description.xml" ZoneName="Office"/>
    </ZoneGroup><ZoneGroup Coordinator="RINCON_000E58A0001001400" ID="RINCON_000E58A0001001400:2">
        <ZoneGroupMember UUID="RINCON_000E58A0001001400" ZoneName="Kitchen"/>
    </ZoneGroup></ZoneGroups></ZoneGroupState>"#;
    let groups = topology::parse_groups(zgs, &HashMap::new()).unwrap();
    assert_eq!(groups.len(), 1, "a group with no reachable member is dropped");
    let g = &groups[0];
    assert_eq!(g.coordinator_ip, "10.0.0.90", "never an empty coordinator ip");
    assert_eq!(g.members.len(), 1);
}
