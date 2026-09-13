//! AVTransport: playback, queue mutation, and the aggregated group snapshot.

use super::didl;
use super::error::Result;
use super::model::{GroupState, MemberRef, MemberVolume, Track, now_ms};
use super::rendering;
use super::soap::{format_hms, parse_hms, Service, SoapClient};

const AVT: Service = Service::AVTransport;

pub async fn play(soap: &SoapClient, ip: &str) -> Result<()> {
    soap.call(ip, AVT, "Play", &[("InstanceID", "0"), ("Speed", "1")]).await?;
    Ok(())
}
pub async fn pause(soap: &SoapClient, ip: &str) -> Result<()> {
    soap.call(ip, AVT, "Pause", &[("InstanceID", "0")]).await?;
    Ok(())
}
pub async fn stop(soap: &SoapClient, ip: &str) -> Result<()> {
    soap.call(ip, AVT, "Stop", &[("InstanceID", "0")]).await?;
    Ok(())
}
pub async fn next(soap: &SoapClient, ip: &str) -> Result<()> {
    soap.call(ip, AVT, "Next", &[("InstanceID", "0")]).await?;
    Ok(())
}
pub async fn previous(soap: &SoapClient, ip: &str) -> Result<()> {
    soap.call(ip, AVT, "Previous", &[("InstanceID", "0")]).await?;
    Ok(())
}
pub async fn seek_time(soap: &SoapClient, ip: &str, secs: u32) -> Result<()> {
    let t = format_hms(secs);
    soap.call(ip, AVT, "Seek", &[("InstanceID", "0"), ("Unit", "REL_TIME"), ("Target", &t)]).await?;
    Ok(())
}
pub async fn seek_track(soap: &SoapClient, ip: &str, index: u32) -> Result<()> {
    let t = index.to_string();
    soap.call(ip, AVT, "Seek", &[("InstanceID", "0"), ("Unit", "TRACK_NR"), ("Target", &t)]).await?;
    Ok(())
}
pub async fn set_play_mode(soap: &SoapClient, ip: &str, mode: &str) -> Result<()> {
    soap.call(ip, AVT, "SetPlayMode", &[("InstanceID", "0"), ("NewPlayMode", mode)]).await?;
    Ok(())
}
pub async fn set_crossfade(soap: &SoapClient, ip: &str, on: bool) -> Result<()> {
    soap.call(ip, AVT, "SetCrossfadeMode", &[("InstanceID", "0"), ("CrossfadeMode", if on { "1" } else { "0" })]).await?;
    Ok(())
}
pub async fn set_av_transport_uri(soap: &SoapClient, ip: &str, uri: &str, metadata: &str) -> Result<()> {
    soap.call(ip, AVT, "SetAVTransportURI", &[("InstanceID", "0"), ("CurrentURI", uri), ("CurrentURIMetaData", metadata)]).await?;
    Ok(())
}
/// Returns the 1-based queue position of the first enqueued track.
pub async fn add_uri_to_queue(soap: &SoapClient, ip: &str, uri: &str, metadata: &str, desired_first: u32, as_next: bool) -> Result<u32> {
    let df = desired_first.to_string();
    let r = soap
        .call(
            ip,
            AVT,
            "AddURIToQueue",
            &[
                ("InstanceID", "0"),
                ("EnqueuedURI", uri),
                ("EnqueuedURIMetaData", metadata),
                ("DesiredFirstTrackNumberEnqueued", &df),
                ("EnqueueAsNext", if as_next { "1" } else { "0" }),
            ],
        )
        .await?;
    Ok(r.get_u32("FirstTrackNumberEnqueued").unwrap_or(1))
}
pub async fn remove_all_tracks(soap: &SoapClient, ip: &str) -> Result<()> {
    soap.call(ip, AVT, "RemoveAllTracksFromQueue", &[("InstanceID", "0")]).await?;
    Ok(())
}
pub async fn remove_track(soap: &SoapClient, ip: &str, index: u32) -> Result<()> {
    let oid = format!("Q:0/{}", index);
    soap.call(ip, AVT, "RemoveTrackFromQueue", &[("InstanceID", "0"), ("ObjectID", &oid), ("UpdateID", "0")]).await?;
    Ok(())
}
/// Move the track at `from` so that it ends up at `to` (both 1-based).
pub async fn reorder(soap: &SoapClient, ip: &str, from: u32, to: u32) -> Result<()> {
    if from == to {
        return Ok(());
    }
    let insert_before = if to > from { to + 1 } else { to };
    let (f, ib) = (from.to_string(), insert_before.to_string());
    soap.call(
        ip,
        AVT,
        "ReorderTracksInQueue",
        &[("InstanceID", "0"), ("StartingIndex", &f), ("NumberOfTracks", "1"), ("InsertBefore", &ib), ("UpdateID", "0")],
    )
    .await?;
    Ok(())
}
pub async fn become_standalone(soap: &SoapClient, ip: &str) -> Result<()> {
    soap.call(ip, AVT, "BecomeCoordinatorOfStandaloneGroup", &[("InstanceID", "0")]).await?;
    Ok(())
}
pub async fn join(soap: &SoapClient, ip: &str, coordinator_uuid: &str) -> Result<()> {
    let uri = format!("x-rincon:{}", coordinator_uuid);
    set_av_transport_uri(soap, ip, &uri, "").await
}

/// Current 1-based track number (0 when nothing is queued).
pub async fn current_track_number(soap: &SoapClient, ip: &str) -> Result<u32> {
    let r = soap.call(ip, AVT, "GetPositionInfo", &[("InstanceID", "0")]).await?;
    Ok(r.get_u32("Track").unwrap_or(0))
}

pub async fn current_uri(soap: &SoapClient, ip: &str) -> Result<String> {
    let r = soap.call(ip, AVT, "GetMediaInfo", &[("InstanceID", "0")]).await?;
    Ok(r.get_or_empty("CurrentURI").to_string())
}

fn classify_source(uri: &str) -> (&'static str, bool) {
    if uri.starts_with("x-rincon-queue:") {
        ("queue", false)
    } else if uri.starts_with("x-rincon-stream:") {
        ("linein", false)
    } else if uri.starts_with("x-sonos-htastream:") {
        ("tv", false)
    } else if uri.starts_with("x-sonos-vli:") {
        if uri.contains("airplay") {
            ("airplay", false)
        } else if uri.contains("spotify") {
            ("spotify-connect", false)
        } else {
            ("linein", false)
        }
    } else if uri.starts_with("x-sonosapi-stream:")
        || uri.starts_with("x-sonosapi-radio:")
        || uri.starts_with("x-rincon-mp3radio:")
        || uri.starts_with("x-sonosapi-hls")
        || uri.starts_with("hls-radio:")
        || uri.starts_with("aac:")
        || uri.starts_with("http")
    {
        ("radio", true)
    } else if uri.starts_with("x-rincon:") {
        ("member", false)
    } else if uri.is_empty() {
        ("none", false)
    } else {
        ("unknown", false)
    }
}

/// One-round-trip snapshot of everything the Now Playing screen needs.
pub async fn group_state(soap: &SoapClient, coordinator_ip: &str, members: &[MemberRef]) -> Result<GroupState> {
    let ip = coordinator_ip;
    let transport = soap.call(ip, AVT, "GetTransportInfo", &[("InstanceID", "0")]);
    let position = soap.call(ip, AVT, "GetPositionInfo", &[("InstanceID", "0")]);
    let media = soap.call(ip, AVT, "GetMediaInfo", &[("InstanceID", "0")]);
    let settings = soap.call(ip, AVT, "GetTransportSettings", &[("InstanceID", "0")]);
    let crossfade = soap.call(ip, AVT, "GetCrossfadeMode", &[("InstanceID", "0")]);
    let gvol = rendering::group_volume(soap, ip);
    let gmute = rendering::group_mute(soap, ip);
    // A member whose reads fail is left out rather than shown at volume 0, which
    // a fader drag would then turn into a real jump.
    let member_vols = futures::future::join_all(members.iter().map(|m| async move {
        match futures::join!(rendering::volume(soap, &m.ip), rendering::mute(soap, &m.ip)) {
            (Ok(volume), Ok(muted)) => Some(MemberVolume { uuid: m.uuid.clone(), name: m.name.clone(), ip: m.ip.clone(), volume, muted }),
            (v, mu) => {
                if let Some(e) = v.err().or(mu.err()) {
                    log::warn!("volume read failed for {}: {e}", m.name);
                }
                None
            }
        }
    }));

    let (transport, position, media, settings, crossfade, gvol, gmute, member_vols) =
        futures::join!(transport, position, media, settings, crossfade, gvol, gmute, member_vols);

    let transport = transport?;
    let position = position?;
    // Same reasoning as members: no snapshot beats a made-up group volume.
    let volume = gvol?;
    let muted = gmute?;
    let media = media.unwrap_or_default();
    let settings = settings.unwrap_or_default();

    let state = transport.get_or_empty("CurrentTransportState").to_string();
    let media_uri = media.get_or_empty("CurrentURI").to_string();
    let (source, is_radio) = classify_source(&media_uri);

    let track_meta = position.get_or_empty("TrackMetaData");
    let mut track: Option<Track> = didl::parse_items(track_meta).first().map(|i| didl::to_track(i, ip));
    if let Some(t) = track.as_mut() {
        if t.uri.is_none() {
            t.uri = Some(position.get_or_empty("TrackURI").to_string());
        }
    }

    // Station name lives in the media (not track) metadata for streams.
    let media_meta = media.get_or_empty("CurrentURIMetaData");
    let station_name = didl::parse_items(media_meta).first().map(|i| i.title.clone()).filter(|s| !s.is_empty());

    if is_radio {
        // For radio the "title" is often a URL; prefer the live stream text.
        if let Some(t) = track.as_mut() {
            let looks_like_url = t.title.contains("://") || t.title.ends_with(".mp3") || t.title.is_empty();
            if let Some(sc) = t.stream_content.clone().filter(|s| !s.trim().is_empty()) {
                if looks_like_url || t.title == station_name.clone().unwrap_or_default() {
                    t.title = sc;
                }
            } else if looks_like_url {
                t.title = station_name.clone().unwrap_or_else(|| "Radio".into());
            }
            if t.art.is_none() {
                t.art = didl::parse_items(media_meta).first().and_then(|i| i.art.clone()).map(|a| didl::absolutize_art(&a, ip));
            }
        }
    }
    if source == "tv" && track.is_none() {
        track = Some(Track { title: "TV".into(), ..Default::default() });
    }
    if source == "linein" && track.is_none() {
        track = Some(Track { title: "Line In".into(), ..Default::default() });
    }

    let duration = parse_hms(position.get_or_empty("TrackDuration")).unwrap_or(0);
    let pos = parse_hms(position.get_or_empty("RelTime")).unwrap_or(0);
    let queue_index = position.get_u32("Track").filter(|n| *n > 0 && source == "queue");
    let queue_length = media.get_u32("NrTracks").filter(|_| source == "queue");

    Ok(GroupState {
        state,
        track,
        position_secs: pos,
        duration_secs: duration,
        queue_index,
        queue_length,
        play_mode: settings.get("PlayMode").unwrap_or("NORMAL").to_string(),
        crossfade: crossfade.ok().and_then(|c| c.get_u32("CrossfadeMode")).unwrap_or(0) == 1,
        is_radio,
        station_name,
        source: source.to_string(),
        volume,
        muted,
        members: member_vols.into_iter().flatten().collect(),
        fetched_at: now_ms(),
    })
}
