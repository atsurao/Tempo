const COMMANDS: &[&str] = &[
    "pick_folder",
    "forget_folder",
    "list_folders",
    "get_folder_info",
    "read_dir",
    "stat",
    "exists",
    "read_file",
    "write_file",
    "read_text_file",
    "read_text_file_lines",
    "write_text_file",
    "append_file",
    "mkdir",
    "remove_file",
    "remove_dir",
    "copy",
    "mv",
    "rename",
    "truncate",
];

fn main() {
    tauri_plugin::Builder::new(COMMANDS)
        .android_path("android")
        .ios_path("ios")
        .build();
}
