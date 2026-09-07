mod commands;
pub mod sonos;
pub mod store;

use std::sync::Arc;

use tauri::Manager;

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
            Ok(())
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
