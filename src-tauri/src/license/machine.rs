use sha2::{Digest, Sha256};
#[cfg(target_os = "linux")]
use std::fs;
use std::process::Command;

fn platform_identifier() -> Option<String> {
    #[cfg(target_os = "macos")]
    {
        let output = Command::new("/usr/sbin/ioreg")
            .args(["-rd1", "-c", "IOPlatformExpertDevice"])
            .output()
            .ok()?;
        return output_value(&String::from_utf8_lossy(&output.stdout), "IOPlatformUUID");
    }
    #[cfg(target_os = "windows")]
    {
        let output = Command::new("reg")
            .args([
                "query",
                "HKLM\\SOFTWARE\\Microsoft\\Cryptography",
                "/v",
                "MachineGuid",
            ])
            .output()
            .ok()?;
        return String::from_utf8_lossy(&output.stdout)
            .lines()
            .find(|line| line.contains("MachineGuid"))
            .and_then(|line| line.split_whitespace().last())
            .map(str::to_owned);
    }
    #[cfg(target_os = "linux")]
    {
        return ["/etc/machine-id", "/var/lib/dbus/machine-id"]
            .iter()
            .find_map(|path| fs::read_to_string(path).ok())
            .map(|value| value.trim().to_owned())
            .filter(|value| !value.is_empty());
    }
    #[allow(unreachable_code)]
    None
}

fn output_value(output: &str, key: &str) -> Option<String> {
    output
        .lines()
        .find(|line| line.contains(&format!("\"{key}\"")))
        .and_then(|line| line.split_once('='))
        .map(|(_, value)| value.trim().trim_matches('"').to_owned())
        .filter(|value| !value.is_empty())
}

fn fallback_identifier() -> String {
    format!(
        "{}|{}|{}|{}",
        std::env::var("USER").unwrap_or_default(),
        std::env::var("HOSTNAME").unwrap_or_default(),
        std::env::consts::OS,
        std::env::consts::ARCH
    )
}

fn hash_identifier(material: &str) -> String {
    let digest = Sha256::digest(material.as_bytes());
    digest.iter().map(|byte| format!("{byte:02x}")).collect()
}

pub fn legacy_device_id() -> String {
    hash_identifier(&fallback_identifier())
}

pub fn device_id() -> String {
    hash_identifier(&format!(
        "canvas-vector-recorder/device-v2|{}",
        platform_identifier().unwrap_or_else(fallback_identifier)
    ))
}

#[cfg(test)]
mod tests {
    use super::output_value;

    #[test]
    fn parses_macos_platform_uuid() {
        let output = r#"    "IOPlatformUUID" = "ABC-123""#;
        assert_eq!(
            output_value(output, "IOPlatformUUID"),
            Some("ABC-123".into())
        );
    }
}
