# License server API

## `POST /v1/activate`

Request: `{ "email": "customer@example.com", "license_code": "CVR1...", "device_id": "sha256...", "app_version": "1.0.0" }`

Success: `{ "ok": true, "activation_token": "signed-server-token", "expires_at": "2026-09-03T00:00:00Z", "next_check_at": "2026-08-10T00:00:00Z" }`.

The server must verify the license signature, normalize email, enforce `max_devices`, persist license/device records, check revocation and expiry, and rate-limit repeated activation attempts.

## `POST /v1/check`

Request: `{ "activation_token": "signed-server-token", "device_id": "sha256...", "app_version": "1.0.0" }`. Return `ok: false` for revoked, expired, or unknown tokens. The desktop adapter is intentionally small; integrate it with a real database and signed token service before production.
