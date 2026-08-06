fn main() {
    println!("cargo:rerun-if-env-changed=LICENSE_PUBLIC_KEY");
    println!("cargo:rerun-if-env-changed=APP_VERSION");
    tauri_build::build();
}
