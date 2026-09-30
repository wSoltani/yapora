fn main() {
  // tauri-build embeds the icons but only asks to rerun when the config
  // changes, so regenerated icons would otherwise keep the old ones in the
  // binary until something else forced a rebuild.
  println!("cargo:rerun-if-changed=icons");
  tauri_build::build()
}
