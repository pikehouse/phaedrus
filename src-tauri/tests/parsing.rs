//! Parser tests against XML captured from a real Sonos S2 household.
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
fn topology_collapses_stereo_pairs_and_orders_coordinator_first() {
    let zgs = fixture("zone_group_state.xml");
    let models: HashMap<String, String> = HashMap::new();
    let groups = topology::parse_groups(&zgs, &models).unwrap();
    // Capture had everything grouped under one room: 7 players, 5 visible rooms.
    let all: Vec<&Zone> = groups.iter().flat_map(|g| g.members.iter()).collect();
    assert_eq!(all.len(), 5, "hidden halves of stereo pairs must be dropped: {:?}", all.iter().map(|z| &z.name).collect::<Vec<_>>());
    let names: Vec<&str> = all.iter().map(|z| z.name.as_str()).collect();
    assert_eq!(names.iter().filter(|n| **n == "Kitchen").count(), 1);
    assert_eq!(names.iter().filter(|n| **n == "Living Room").count(), 1);
    let g = groups.iter().find(|g| g.name == "Dining Room").expect("group named after coordinator");
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

    let track = by_title("White Noise 3 Hour Long");
    assert_eq!(didl::kind_of(track), ItemKind::Track);
    assert_eq!(didl::uri_sid(track.res_uri.as_ref().unwrap()), Some(12));
    assert_eq!(didl::uri_sn(track.res_uri.as_ref().unwrap()), Some(3));
    assert!(track.res_md.as_ref().unwrap().contains("SA_RINCON3079_X_#Svc3079-0-Token"), "nested resMD is decoded once");

    let album = by_title("Dylan's Gospel");
    assert_eq!(didl::kind_of(album), ItemKind::Album);
    assert_eq!(didl::service_label(didl::uri_sid(album.res_uri.as_ref().unwrap()).unwrap()), Some("spotify"));

    assert_eq!(didl::kind_of(by_title("KEXP")), ItemKind::Station);
    assert_eq!(didl::kind_of(by_title("Nick Drake")), ItemKind::Artist);
    assert!(by_title("Nick Drake").res_uri.is_none());

    let apple = by_title("Night Owl");
    assert_eq!(didl::kind_of(apple), ItemKind::Album);
    assert_eq!(didl::uri_sid(apple.res_uri.as_ref().unwrap()), Some(204));
}

#[test]
fn art_uris_become_absolute() {
    assert_eq!(didl::absolutize_art("/getaa?s=1&u=x", "192.168.1.5"), "http://192.168.1.5:1400/getaa?s=1&u=x");
    assert_eq!(didl::absolutize_art("https://i.scdn.co/a.jpg", "192.168.1.5"), "https://i.scdn.co/a.jpg");
}

fn item(service: ServiceId, kind: ItemKind, id: &str, title: &str) -> MediaItem {
    MediaItem { service, kind, id: id.into(), title: title.into(), subtitle: None, art: None, duration_secs: None, explicit: None, year: None, track_count: None }
}

#[test]
fn built_uris_match_what_sonos_itself_writes() {
    let acc = Accounts { spotify_sid: 12, spotify_sn: 3, apple_sn: 1 };

    let p = items::build(&item(ServiceId::Spotify, ItemKind::Track, "spotify:track:04boE4u1AupbrGlI62WvoO", "White Noise"), &acc).unwrap();
    assert_eq!(p.uri, "x-sonos-spotify:spotify%3atrack%3a04boE4u1AupbrGlI62WvoO?sid=12&flags=8224&sn=3");
    assert!(p.metadata.contains("id=\"10032020spotify%3atrack%3a04boE4u1AupbrGlI62WvoO\""));
    assert!(p.metadata.contains("SA_RINCON3079_X_#Svc3079-0-Token"));
    assert!(!p.is_stream);

    let p = items::build(&item(ServiceId::Spotify, ItemKind::Album, "spotify:album:6QuJH3SudxdgzH8Bl4b7o8", "Dylan's Gospel"), &acc).unwrap();
    assert_eq!(p.uri, "x-rincon-cpcontainer:1004206cspotify%3aalbum%3a6QuJH3SudxdgzH8Bl4b7o8?sid=12&flags=8300&sn=3");
    assert!(p.metadata.contains("object.container.album.musicAlbum"));
    assert!(p.metadata.contains("Dylan&apos;s Gospel"), "titles are XML-escaped");

    let p = items::build(&item(ServiceId::Spotify, ItemKind::Playlist, "spotify:playlist:37i9dQZF1EIhKhPuz9X9RP", "Soul Jazz Mix"), &acc).unwrap();
    assert_eq!(p.uri, "x-rincon-cpcontainer:1006206cspotify%3aplaylist%3a37i9dQZF1EIhKhPuz9X9RP?sid=12&flags=8300&sn=3");

    let p = items::build(&item(ServiceId::Spotify, ItemKind::Artist, "spotify:artist:0BqALs1lInR9TTOulUADH7", "Ahmad Jamal Trio"), &acc).unwrap();
    assert_eq!(p.uri, "x-sonosapi-radio:spotify%3aartistRadio%3a0BqALs1lInR9TTOulUADH7?sid=12&flags=8300&sn=3");
    assert!(p.is_stream);

    let p = items::build(&item(ServiceId::Apple, ItemKind::Track, "1434916256", "With a Little Help"), &acc).unwrap();
    assert_eq!(p.uri, "x-sonos-http:song%3a1434916256.mp4?sid=204&flags=8232&sn=1");
    assert!(p.metadata.contains("SA_RINCON52231_X_#Svc52231-0-Token"));

    let p = items::build(&item(ServiceId::Apple, ItemKind::Album, "693605213", "Night Owl"), &acc).unwrap();
    assert_eq!(p.uri, "x-rincon-cpcontainer:1004206calbum%3a693605213?sid=204&flags=8300&sn=1");

    assert!(items::build(&item(ServiceId::Apple, ItemKind::Artist, "1285818", "Nick Drake"), &acc).is_err());

    let p = items::build(&item(ServiceId::Tunein, ItemKind::Station, "s32537", "KEXP"), &acc).unwrap();
    assert_eq!(p.uri, "x-sonosapi-stream:s32537?sid=254&flags=8224&sn=0");
    assert!(p.is_stream);
}

#[test]
fn favorite_playables_carry_metadata_through() {
    let items = didl::parse_items(&fixture("favorites.xml"));
    let kexp = items.iter().find(|i| i.title == "KEXP").unwrap();
    let fav = Favorite {
        id: kexp.id.clone(),
        title: kexp.title.clone(),
        description: None,
        art: None,
        kind: didl::kind_of(kexp),
        playable: true,
        service: None,
        uri: kexp.res_uri.clone(),
        metadata: kexp.res_md.clone(),
    };
    let p = items::from_favorite(&fav).unwrap();
    assert!(p.is_stream);
    assert!(p.metadata.contains("audioBroadcast"));
}
