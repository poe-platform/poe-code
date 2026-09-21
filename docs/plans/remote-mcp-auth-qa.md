# Remote MCP credential configuration QA

Execute these steps as an agent using the built selected safe-bash-mcp closure.
Use only synthetic credentials and a local token endpoint. Temporary host
fixtures and screenshots belong in out/remote-mcp-auth-qa and are purged after
inspection.

1. Prepare a static OAuth registry with client_secret_basic authentication,
   explicit client credential environment references and supplied tool schemas.
   Register the management command in a real safe-bash Shell. Render and inspect
   mcp init --format config: the public method and credential references must be
   readable, with no actual credential values.
2. Start a local synthetic HTTP token endpoint. Bind the initialization through
   the public SDK with special-character credentials and a host-owned expired
   session. Authorize through the native provider using a real fetch. Verify
   individually form-encoded Basic credentials, no duplicated form client ID
   or secret, preserved resource, one refresh redemption and persisted rotation.
3. Repeat with explicit none authentication while a secret exists in the stored
   client. Verify no authentication header or form secret is transmitted.
4. Parse a full external DCR response through the built public parser. Verify
   arrays, timestamps, JWK/provider metadata and optional nulls survive an owned
   snapshot. No live external server or production secret store is contacted.
5. Record results in the authoritative remote MCP progress ledger. Remove only
   this QA's evidence directory.
