# JWKS verifier configuration validation

Eight red cases reproduced unsupported endpoint protocols/credentials, invalid cache/cooldown durations, unusable timeout values, and infinite/invalid clock skew accepted at construction. Restrict JWKS endpoints to HTTP/HTTPS without credentials even when insecure HTTP is explicitly allowed. Retain the existing HTTPS requirement for remote hosts unless allowInsecureJwks is set.

Validate non-negative safe integer cache/cooldown durations, a positive integer fetch deadline within the runtime timer range, and finite non-negative clock skew. Zero cache/cooldown/skew and finite fractional clock skew remain supported. Existing declared options/defaults remain unchanged.

The complete OAuth suite passes 144 cases across 14 files. Focused lint passed before this final change; run current lint and rebuilt consumer types/artifact QA. No README additions have been made.
