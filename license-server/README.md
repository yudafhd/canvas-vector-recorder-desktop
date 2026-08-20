# Development license server

`node license-server/server.mjs` starts a deliberately small in-memory adapter on port 8787. It demonstrates a possible external activation contract; it is not production-ready and is not used by the current offline `guardian-core` integration.

Production must verify the Ed25519 license itself, persist license/device state, support revocation, authenticate operators, use TLS, and protect its private key in a secret manager.
