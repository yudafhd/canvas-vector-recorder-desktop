use crate::{commands::validate_tracing_svg, AppError};
use serde::Deserialize;
use std::collections::HashSet;

#[derive(Deserialize)]
pub struct BatchEntry {
    pub filename: String,
    pub svg: String,
    #[serde(default)]
    pub bytes: Option<Vec<u8>>,
    #[serde(default)]
    pub settings: Option<crate::recorder::validator::MicrostockSettings>,
}

fn crc32(bytes: &[u8]) -> u32 {
    let mut crc = !0u32;
    for byte in bytes {
        crc ^= *byte as u32;
        for _ in 0..8 {
            crc = (crc >> 1) ^ if crc & 1 == 1 { 0xedb88320 } else { 0 };
        }
    }
    !crc
}
fn u16le(out: &mut Vec<u8>, value: u16) {
    out.extend_from_slice(&value.to_le_bytes());
}
fn u32le(out: &mut Vec<u8>, value: u32) {
    out.extend_from_slice(&value.to_le_bytes());
}

/// Validate all SVGs before constructing a ZIP or touching the export directory.
pub fn make_zip(entries: &[BatchEntry]) -> Result<Vec<u8>, AppError> {
    if entries.is_empty()
        || entries.len() > 50
        || entries.iter().map(|entry| entry.svg.len()).sum::<usize>() > 100_000_000
    {
        return Err(AppError::PayloadTooLarge);
    }
    let mut names = HashSet::new();
    for entry in entries {
        let name = &entry.filename;
        let stem = name.strip_suffix(".svg").or_else(|| name.strip_suffix(".eps")).unwrap_or("").to_ascii_lowercase();
        let reserved = matches!(stem.as_str(), "con" | "prn" | "aux" | "nul")
            || (stem.len() == 4
                && (stem.starts_with("com") || stem.starts_with("lpt"))
                && matches!(stem.as_bytes()[3], b'1'..=b'9'));
        if stem.is_empty()
            || name.len() > 140
            || name.starts_with('.')
            || name.contains("..")
            || reserved
            || !name
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.'))
            || !names.insert(name.to_ascii_lowercase())
        {
            return Err(AppError::InvalidEvent(
                "Nama hasil batch tidak valid atau duplikat".into(),
            ));
        }
        if entry.svg.len() > 2_000_000 {
            return Err(AppError::PayloadTooLarge);
        }
        if !entry.filename.ends_with(".eps") {
            validate_tracing_svg(&entry.svg)?;
        }
    }
    let mut out = Vec::new();
    let mut central = Vec::new();
    for entry in entries {
        let name = entry.filename.as_bytes();
        let eps_buf;
        let svg_buf;
        let data: &[u8] = if let Some(b) = &entry.bytes {
            b.as_slice()
        } else if entry.filename.ends_with(".eps") {
            eps_buf = crate::recorder::eps::build_tracing_eps(&entry.svg, &entry.filename)?;
            eps_buf.as_slice()
        } else if let Some(settings) = &entry.settings {
            svg_buf = crate::commands::render_tracing_export(entry.svg.clone(), settings.clone(), "svg".into(), entry.filename.clone())?;
            svg_buf.as_bytes()
        } else {
            entry.svg.as_bytes()
        };
        if data.len() > 45_000_000 { return Err(AppError::PayloadTooLarge); }
        let crc = crc32(data);
        let offset = out.len() as u32;
        u32le(&mut out, 0x04034b50);
        for value in [20, 0x800, 0, 0, 33] {
            u16le(&mut out, value);
        }
        for value in [crc, data.len() as u32, data.len() as u32] {
            u32le(&mut out, value);
        }
        u16le(&mut out, name.len() as u16);
        u16le(&mut out, 0);
        out.extend_from_slice(name);
        out.extend_from_slice(data);
        u32le(&mut central, 0x02014b50);
        for value in [20, 20, 0x800, 0, 0, 33] {
            u16le(&mut central, value);
        }
        for value in [crc, data.len() as u32, data.len() as u32] {
            u32le(&mut central, value);
        }
        for value in [name.len() as u16, 0, 0, 0, 0] {
            u16le(&mut central, value);
        }
        u32le(&mut central, 0);
        u32le(&mut central, offset);
        central.extend_from_slice(name);
    }
    let central_offset = out.len() as u32;
    let central_length = central.len() as u32;
    out.extend_from_slice(&central);
    u32le(&mut out, 0x06054b50);
    for value in [0, 0, entries.len() as u16, entries.len() as u16] {
        u16le(&mut out, value);
    }
    u32le(&mut out, central_length);
    u32le(&mut out, central_offset);
    u16le(&mut out, 0);
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn entry(filename: &str) -> BatchEntry {
        BatchEntry {
            filename: filename.into(),
            svg: "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"8\" height=\"8\" viewBox=\"0 0 8 8\"><path fill=\"#000000\" fill-rule=\"evenodd\" d=\"M0 0L8 0L8 8Z\"/></svg>".into(),
            bytes: None,
            settings: None,
        }
    }
    #[test]
    fn zip_svg_uses_global_online_export_settings() {
        let mut entry = entry("global.svg");
        let mut settings = crate::recorder::validator::MicrostockSettings::default();
        settings.ratio = "4:5".into();
        settings.transparent_background = true;
        let (width, height, _) = crate::recorder::validator::artboard(8.0, 8.0, &settings);
        entry.settings = Some(settings);
        let zip = make_zip(&[entry]).unwrap();
        let content = String::from_utf8_lossy(&zip);
        assert!(content.contains(&format!("viewBox=\"0 0 {width} {height}\"")));
        assert!(content.contains("artwork-transform"));
        assert!(!content.contains("background-color"));
    }

    #[test]
    fn zip_crc_and_offsets_are_valid() {
        assert_eq!(crc32(b"123456789"), 0xcbf43926);
        let entries = [entry("a.svg"), entry("b.svg")];
        let zip = make_zip(&entries).unwrap();
        let read = |at: usize| u32::from_le_bytes(zip[at..at + 4].try_into().unwrap());
        assert_eq!(read(0), 0x04034b50);
        let second = 30 + 5 + entries[0].svg.len();
        assert_eq!(read(second), 0x04034b50);
        let end = zip.len() - 22;
        assert_eq!(read(end), 0x06054b50);
        let central = read(end + 16) as usize;
        assert_eq!(read(central), 0x02014b50);
        assert_eq!(read(central + 42), 0);
        assert_eq!(read(central + 51 + 42), second as u32);
        assert_eq!(&zip[35..second], entries[0].svg.as_bytes());
    }
    #[test]
    fn rejects_empty_unsafe_duplicate_and_active_svg_entries() {
        assert!(make_zip(&[]).is_err());
        for filename in ["../x.svg", "C:\\x.svg", "con.svg", "a/b.svg"] {
            assert!(make_zip(&[entry(filename)]).is_err());
        }
        assert!(make_zip(&[entry("a.svg"), entry("A.svg")]).is_err());
        let mut active = entry("a.svg");
        active.svg = "<svg xmlns=\"http://www.w3.org/2000/svg\"><script/></svg>".into();
        assert!(make_zip(&[active]).is_err());
        assert!(make_zip(
            &(0..51)
                .map(|i| entry(&format!("{i}.svg")))
                .collect::<Vec<_>>()
        )
        .is_err());
    }
}
