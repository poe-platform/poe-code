# Spawned modern scalar output contract

The broad maintained gate reproduced a stale integration expectation: an undeclared output envelope containing scalar structuredContent was treated as invalid. Modern MCP permits scalar JSON output. Rename the fixture to scalar_envelope and assert the actual legal result. Retain the separate declared-schema invalid output check asserting -32603 and its validation data.

Validate through the existing real stdio subprocess route after the broad gate completes. That route currently creates temporary server source files; convert it to Node's inline module argument in a separate test simplification before final verification.
