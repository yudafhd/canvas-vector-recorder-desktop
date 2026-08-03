use sha2::{Digest, Sha256};

pub fn device_id() -> String {
    let material = format!(
        "{}|{}|{}|{}",
        std::env::var("USER").unwrap_or_default(),
        std::env::var("HOSTNAME").unwrap_or_default(),
        std::env::consts::OS,
        std::env::consts::ARCH
    );
    let digest = Sha256::digest(material.as_bytes());
    digest.iter().map(|byte| format!("{byte:02x}")).collect()
}
