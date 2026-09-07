//! Tauri command surface — thin wrappers over SonosSystem. Names and argument
//! keys match src/api/tauri.ts (camelCase on the JS side).

use std::sync::Arc;

use tauri::State;

use crate::sonos::model::*;
use crate::sonos::system::SonosSystem;

type Sys<'a> = State<'a, Arc<SonosSystem>>;
type R<T> = std::result::Result<T, String>;

#[tauri::command]
pub async fn discover(sys: Sys<'_>) -> R<Topology> { sys.discover().await.map_err(Into::into) }
#[tauri::command]
pub async fn get_topology(sys: Sys<'_>) -> R<Topology> { sys.topology().await.map_err(Into::into) }
#[tauri::command]
pub async fn get_group_state(sys: Sys<'_>, coordinator_ip: String, members: Vec<MemberRef>) -> R<GroupState> {
    sys.group_state(&coordinator_ip, &members).await.map_err(Into::into)
}
#[tauri::command]
pub async fn play(sys: Sys<'_>, ip: String) -> R<()> { sys.play(&ip).await.map_err(Into::into) }
#[tauri::command]
pub async fn pause(sys: Sys<'_>, ip: String) -> R<()> { sys.pause(&ip).await.map_err(Into::into) }
#[tauri::command]
pub async fn stop(sys: Sys<'_>, ip: String) -> R<()> { sys.stop(&ip).await.map_err(Into::into) }
#[tauri::command]
pub async fn next_track(sys: Sys<'_>, ip: String) -> R<()> { sys.next(&ip).await.map_err(Into::into) }
#[tauri::command]
pub async fn previous_track(sys: Sys<'_>, ip: String) -> R<()> { sys.previous(&ip).await.map_err(Into::into) }
#[tauri::command]
pub async fn seek(sys: Sys<'_>, ip: String, secs: u32) -> R<()> { sys.seek(&ip, secs).await.map_err(Into::into) }
#[tauri::command]
pub async fn play_queue_index(sys: Sys<'_>, ip: String, index: u32) -> R<()> { sys.play_queue_index(&ip, index).await.map_err(Into::into) }
#[tauri::command]
pub async fn set_play_mode(sys: Sys<'_>, ip: String, mode: String) -> R<()> { sys.set_play_mode(&ip, &mode).await.map_err(Into::into) }
#[tauri::command]
pub async fn set_crossfade(sys: Sys<'_>, ip: String, on: bool) -> R<()> { sys.set_crossfade(&ip, on).await.map_err(Into::into) }
#[tauri::command]
pub async fn set_group_volume(sys: Sys<'_>, ip: String, volume: u32) -> R<()> { sys.set_group_volume(&ip, volume).await.map_err(Into::into) }
#[tauri::command]
pub async fn set_group_mute(sys: Sys<'_>, ip: String, muted: bool) -> R<()> { sys.set_group_mute(&ip, muted).await.map_err(Into::into) }
#[tauri::command]
pub async fn set_volume(sys: Sys<'_>, ip: String, volume: u32) -> R<()> { sys.set_volume(&ip, volume).await.map_err(Into::into) }
#[tauri::command]
pub async fn set_mute(sys: Sys<'_>, ip: String, muted: bool) -> R<()> { sys.set_mute(&ip, muted).await.map_err(Into::into) }
#[tauri::command]
pub async fn get_queue(sys: Sys<'_>, ip: String, start: Option<u32>, count: Option<u32>) -> R<QueuePage> {
    sys.queue(&ip, start.unwrap_or(0), count.unwrap_or(200)).await.map_err(Into::into)
}
#[tauri::command]
pub async fn remove_from_queue(sys: Sys<'_>, ip: String, index: u32) -> R<()> { sys.remove_from_queue(&ip, index).await.map_err(Into::into) }
#[tauri::command]
pub async fn clear_queue(sys: Sys<'_>, ip: String) -> R<()> { sys.clear_queue(&ip).await.map_err(Into::into) }
#[tauri::command]
pub async fn reorder_queue(sys: Sys<'_>, ip: String, from: u32, to: u32) -> R<()> { sys.reorder_queue(&ip, from, to).await.map_err(Into::into) }
#[tauri::command]
pub async fn get_favorites(sys: Sys<'_>, ip: String) -> R<Vec<Favorite>> { sys.favorites(&ip).await.map_err(Into::into) }
#[tauri::command]
pub async fn play_favorite(sys: Sys<'_>, ip: String, coordinator_uuid: String, favorite: Favorite, action: PlayAction) -> R<()> {
    sys.play_favorite(&ip, &coordinator_uuid, &favorite, action).await.map_err(Into::into)
}
#[tauri::command]
pub async fn join_group(sys: Sys<'_>, ip: String, coordinator_uuid: String) -> R<()> { sys.join_group(&ip, &coordinator_uuid).await.map_err(Into::into) }
#[tauri::command]
pub async fn leave_group(sys: Sys<'_>, ip: String) -> R<()> { sys.leave_group(&ip).await.map_err(Into::into) }
#[tauri::command]
pub async fn get_services(sys: Sys<'_>, ip: String) -> R<Vec<MusicService>> { sys.services(&ip).await.map_err(Into::into) }
#[tauri::command]
pub async fn search(sys: Sys<'_>, ip: String, query: String) -> R<SearchResults> { sys.search(&ip, &query).await.map_err(Into::into) }
#[tauri::command]
pub async fn artist_albums(sys: Sys<'_>, ip: String, item: MediaItem) -> R<Vec<MediaItem>> { sys.artist_albums(&ip, &item).await.map_err(Into::into) }
#[tauri::command]
pub async fn play_item(sys: Sys<'_>, ip: String, coordinator_uuid: String, item: MediaItem, action: PlayAction) -> R<()> {
    sys.play_item(&ip, &coordinator_uuid, &item, action).await.map_err(Into::into)
}
#[tauri::command]
pub async fn link_begin(sys: Sys<'_>, ip: String, service: ServiceId) -> R<LinkSession> { sys.link_begin(&ip, service).await.map_err(Into::into) }
#[tauri::command]
pub async fn link_poll(sys: Sys<'_>, ip: String, session: LinkSession) -> R<LinkStatus> { sys.link_poll(&ip, &session).await.map_err(Into::into) }
#[tauri::command]
pub async fn unlink(sys: Sys<'_>, _ip: String, service: ServiceId) -> R<()> {
    sys.unlink(service);
    Ok(())
}
