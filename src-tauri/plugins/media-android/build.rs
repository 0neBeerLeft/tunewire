// The page subscribes to the lock screen / notification buttons with
// addPluginListener, which calls these two: without permissions for them the
// subscription was refused (silently) and the buttons did nothing.
const COMMANDS: &[&str] = &["register_listener", "remove_listener"];

fn main() {
    tauri_plugin::Builder::new(COMMANDS).android_path("android").build();
}
