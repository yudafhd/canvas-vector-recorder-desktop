# Development license server

`node license-server/server.mjs` starts a deliberately small in-memory adapter on port 8787. It demonstrates device counting and the `/v1/activate` and `/v1/check` contract; it is not production-ready and is never used by a release build unless `LICENSE_SERVER_URL` is explicitly configured.

Production must verify the Ed25519 license itself, persist license/device state, support revocation, authenticate operators, use TLS, and protect its private key in a secret manager.
