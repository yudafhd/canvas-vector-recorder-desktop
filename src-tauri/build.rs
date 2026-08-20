use std::{env, fs, path::{Path, PathBuf}};

const DOTENV_KEYS: [&str; 3] = ["LICENSE_PRODUCT_CODE", "LICENSE_PUBLIC_KEY", "APP_VERSION"];

fn dotenv_value(value: &str) -> String {
    let value = value.trim();
    if value.len() >= 2 {
        let bytes = value.as_bytes();
        if (bytes[0] == b'"' && bytes[value.len() - 1] == b'"')
            || (bytes[0] == b'\'' && bytes[value.len() - 1] == b'\'')
        {
            return value[1..value.len() - 1].to_owned();
        }
    }
    value.to_owned()
}

fn load_dotenv(path: &Path) {
    println!("cargo:rerun-if-changed={}", path.display());
    let Ok(contents) = fs::read_to_string(path) else {
        return;
    };

    for line in contents.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let line = line.strip_prefix("export ").unwrap_or(line);
        let Some((key, value)) = line.split_once('=') else {
            continue;
        };
        let key = key.trim();
        if DOTENV_KEYS.contains(&key) && env::var_os(key).is_none() {
            println!("cargo:rustc-env={key}={}", dotenv_value(value));
        }
    }
}

fn main() {
    println!("cargo:rerun-if-env-changed=LICENSE_PUBLIC_KEY");
    println!("cargo:rerun-if-env-changed=LICENSE_PRODUCT_CODE");
    println!("cargo:rerun-if-env-changed=APP_VERSION");
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    load_dotenv(&manifest_dir.join(".env"));
    if let Some(project_dir) = manifest_dir.parent() {
        load_dotenv(&project_dir.join(".env"));
    }
    tauri_build::build();
}
