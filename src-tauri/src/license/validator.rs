use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use chrono::{DateTime, Utc};
use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use serde::{Deserialize, Serialize};

pub const PRODUCT: &str = "canvas-vector-recorder";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LicensePayload {
    pub product: String,
    pub email: String,
    pub license_id: String,
    pub issued_at: String,
    pub expires_at: String,
    pub max_devices: u32,
}

#[derive(Debug, Clone)]
pub struct VerifiedLicense {
    pub payload: LicensePayload,
}

pub fn decode_part(value: &str) -> Result<Vec<u8>, String> {
    URL_SAFE_NO_PAD
        .decode(value)
        .map_err(|_| "base64url tidak valid".into())
}
pub fn normalize_email(value: &str) -> String {
    value.trim().to_lowercase()
}

pub fn validate(code: &str, email: &str, now: DateTime<Utc>) -> Result<VerifiedLicense, String> {
    let key = option_env!("LICENSE_PUBLIC_KEY")
        .ok_or_else(|| "LICENSE_PUBLIC_KEY belum dikonfigurasi pada build aplikasi".to_string())?;
    validate_with_public_key(code, email, now, key)
}

pub fn validate_with_public_key(
    code: &str,
    email: &str,
    now: DateTime<Utc>,
    public_key: &str,
) -> Result<VerifiedLicense, String> {
    let mut parts = code.split('.');
    if parts.next() != Some("CVR1")
        || parts.next().is_none()
        || parts.next().is_none()
        || parts.next().is_some()
    {
        return Err("Format lisensi harus CVR1.<payload>.<signature>".into());
    }
    let payload_part = code.split('.').nth(1).unwrap_or_default();
    let signature_part = code.split('.').nth(2).unwrap_or_default();
    let payload_bytes = decode_part(payload_part)?;
    let signature_bytes = decode_part(signature_part)?;
    let payload: LicensePayload = serde_json::from_slice(&payload_bytes)
        .map_err(|_| "Payload lisensi tidak valid".to_string())?;
    if payload.product != PRODUCT {
        return Err("Product lisensi tidak cocok".into());
    }
    if normalize_email(&payload.email) != normalize_email(email) {
        return Err("Email lisensi berbeda dengan email input".into());
    }
    let issued = DateTime::parse_from_rfc3339(&payload.issued_at)
        .map_err(|_| "issued_at tidak valid".to_string())?
        .with_timezone(&Utc);
    let expires = DateTime::parse_from_rfc3339(&payload.expires_at)
        .map_err(|_| "expires_at tidak valid".to_string())?
        .with_timezone(&Utc);
    if expires <= issued {
        return Err("expires_at harus lebih besar dari issued_at".into());
    }
    if now < issued {
        return Err("Lisensi belum berlaku".into());
    }
    if now >= expires {
        return Err("Lisensi sudah kedaluwarsa".into());
    }
    let mut key_bytes = [0_u8; 32];
    let decoded_key = decode_part(public_key.trim())
        .map_err(|_| "LICENSE_PUBLIC_KEY harus berupa base64url 32-byte".to_string())?;
    if decoded_key.len() != 32 {
        return Err("LICENSE_PUBLIC_KEY harus 32 byte".into());
    }
    key_bytes.copy_from_slice(&decoded_key);
    let verifying_key =
        VerifyingKey::from_bytes(&key_bytes).map_err(|_| "Public key tidak valid".to_string())?;
    let signature = Signature::from_slice(&signature_bytes)
        .map_err(|_| String::from("Signature tidak valid"))?;
    verifying_key
        .verify(payload_part.as_bytes(), &signature)
        .map_err(|_| "Signature lisensi tidak valid".to_string())?;
    Ok(VerifiedLicense { payload })
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::{Signer, SigningKey};
    fn code(key: &SigningKey, issued: &str, expires: &str, email: &str) -> String {
        let payload = serde_json::json!({"product":PRODUCT,"email":email,"license_id":"test","issued_at":issued,"expires_at":expires,"max_devices":1});
        let raw = serde_json::to_vec(&payload).unwrap();
        let encoded = URL_SAFE_NO_PAD.encode(raw);
        let sig = URL_SAFE_NO_PAD.encode(key.sign(encoded.as_bytes()).to_bytes());
        format!("CVR1.{encoded}.{sig}")
    }
    fn key_string(key: &SigningKey) -> String {
        URL_SAFE_NO_PAD.encode(key.verifying_key().to_bytes())
    }
    #[test]
    fn valid_and_email_are_checked() {
        let key = SigningKey::from_bytes(&[7; 32]);
        let c = code(
            &key,
            "2026-01-01T00:00:00Z",
            "2026-02-01T00:00:00Z",
            "User@Example.com",
        );
        assert!(validate_with_public_key(
            &c,
            " user@example.com ",
            DateTime::parse_from_rfc3339("2026-01-15T00:00:00Z")
                .unwrap()
                .with_timezone(&Utc),
            &key_string(&key)
        )
        .is_ok());
        assert!(
            validate_with_public_key(&c, "other@example.com", Utc::now(), &key_string(&key))
                .is_err()
        );
    }
    #[test]
    fn expiry_and_not_yet_valid_boundaries_are_rejected() {
        let key = SigningKey::from_bytes(&[8; 32]);
        let c = code(
            &key,
            "2026-01-01T00:00:00Z",
            "2026-02-01T00:00:00Z",
            "a@b.test",
        );
        let at = |s| DateTime::parse_from_rfc3339(s).unwrap().with_timezone(&Utc);
        assert!(validate_with_public_key(
            &c,
            "a@b.test",
            at("2026-02-01T00:00:00Z"),
            &key_string(&key)
        )
        .is_err());
        assert!(validate_with_public_key(
            &c,
            "a@b.test",
            at("2025-12-31T23:59:59Z"),
            &key_string(&key)
        )
        .is_err());
    }
    #[test]
    fn modified_payload_or_signature_fails() {
        let key = SigningKey::from_bytes(&[9; 32]);
        let c = code(
            &key,
            "2026-01-01T00:00:00Z",
            "2026-02-01T00:00:00Z",
            "a@b.test",
        );
        let modified = c.replacen("a@b.test", "x@b.test", 1);
        assert!(
            validate_with_public_key(&modified, "a@b.test", Utc::now(), &key_string(&key)).is_err()
        );
    }
}
