mod art;
mod commands;
pub mod sonos;
pub mod store;

use std::sync::Arc;

use tauri::http::{Response, StatusCode};
use tauri::Manager;

use art::ArtCache;
use sonos::system::SonosSystem;
use store::Store;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let _ = env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("phaedrus=info")).try_init();
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let path = app.path().app_data_dir().ok().map(|d| d.join("phaedrus.json"));
            let system = Arc::new(SonosSystem::new(Store::load(path)));
            app.manage(system);
            let cache_dir = app
                .path()
                .app_cache_dir()
                .unwrap_or_else(|_| std::env::temp_dir().join("phaedrus"))
                .join("art");
            app.manage(Arc::new(ArtCache::new(cache_dir)));
            Ok(())
        })
        // art://localhost/?u=<encoded image url> → cached bytes, CORS-open.
        .register_asynchronous_uri_scheme_protocol("art", |ctx, request, responder| {
            let app = ctx.app_handle().clone();
            let uri = request.uri().to_string();
            tauri::async_runtime::spawn(async move {
                let target = url::Url::parse(&uri)
                    .ok()
                    .and_then(|u| u.query_pairs().find(|(k, _)| k == "u").map(|(_, v)| v.into_owned()))
                    .filter(|u| u.starts_with("http://") || u.starts_with("https://"));
                let Some(target) = target else {
                    responder.respond(Response::builder().status(StatusCode::BAD_REQUEST).body(Vec::new()).unwrap());
                    return;
                };
                let cache = app.state::<Arc<ArtCache>>();
                match cache.get(&target).await {
                    Ok(bytes) => {
                        let ct = art::content_type(&bytes);
                        let body: Vec<u8> = (*bytes).clone();
                        responder.respond(
                            Response::builder()
                                .status(StatusCode::OK)
                                .header("Content-Type", ct)
                                .header("Cache-Control", "public, max-age=31536000, immutable")
                                .header("Access-Control-Allow-Origin", "*")
                                .body(body)
                                .unwrap(),
                        );
                    }
                    Err(e) => {
                        log::warn!("art fetch failed for {target}: {e}");
                        responder.respond(
                            Response::builder()
                                .status(StatusCode::BAD_GATEWAY)
                                .header("Access-Control-Allow-Origin", "*")
                                .body(Vec::new())
                                .unwrap(),
                        );
                    }
                }
            });
        })
        .invoke_handler(tauri::generate_handler![
            commands::discover,
            commands::get_topology,
            commands::get_group_state,
            commands::play,
            commands::pause,
            commands::stop,
            commands::next_track,
            commands::previous_track,
            commands::seek,
            commands::play_queue_index,
            commands::set_play_mode,
            commands::set_crossfade,
            commands::set_group_volume,
            commands::set_group_mute,
            commands::set_volume,
            commands::set_mute,
            commands::get_queue,
            commands::remove_from_queue,
            commands::clear_queue,
            commands::reorder_queue,
            commands::get_favorites,
            commands::play_favorite,
            commands::join_group,
            commands::leave_group,
            commands::get_services,
            commands::search,
            commands::artist_albums,
            commands::play_item,
            commands::link_begin,
            commands::link_poll,
            commands::unlink,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Phaedrus");
}
