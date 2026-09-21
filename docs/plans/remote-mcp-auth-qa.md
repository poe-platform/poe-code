# Remote MCP credential configuration QA

Execute these steps as an agent using the built selected safe-bash-mcp closure.
Use only synthetic credentials and a local token endpoint. Temporary host
fixtures and screenshots belong in out/remote-mcp-auth-qa and are purged after
inspection.

For OAuth HTTP content negotiation, run separate local protected-resource and
authorization-server origins. Configure MCP Accept, tenant and custom User-Agent
headers. Authenticate dynamically through an actual loopback callback, then
advance the host clock and silently refresh the persisted grant. All OAuth
metadata, DCR and token requests must carry Accept: application/json without
MCP tenant, protocol or bearer headers. Native default fetch must send a nonempty
User-Agent, while the configured MCP User-Agent stays intact. Verify exactly one
consent/DCR, one code exchange and one refresh, with no tool listing/calling.

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

6. For relative-lifetime imports, render and inspect init env and management help.
   Check optional empty EXPIRES_IN/ISSUED_AT entries and seconds/milliseconds
   guidance. Bind fresh remaining lifetime, delayed original issuance and an
   authoritative absolute expiry using the built SDK; advance the host clock
   after binding and verify expiry does not move. Authorization must not redeem
   a fresh grant. Generate a supplied-schema artifact and check credentials do
   not appear in JSON/module/configuration output.

7. Exercise native registration callback identity against a local synthetic DCR
   endpoint returning portless localhost metadata. Complete authorization through
   an actual loopback HTTP callback with state, then code exchange; verify one
   registration and identical submitted listener URLs throughout. Recreate a
   headless provider with its expired persisted session and verify silent refresh
   retains the original client without binding another listener. Reject the next
   refresh with invalid_grant, permit interaction, and prove exactly one obsolete
   registration replacement followed by a successful callback/code exchange.

8. With built declarative SDK packages, a local synthetic DCR/token endpoint and
   a native encrypted file store under this QA's out directory, recreate the
   host in separate processes for each operation. Authenticate URL A, retain its
   unchanged grant, and prove a different configured name at A has no grant.
   Change the original name to B, then return to A; neither may use retired
   credentials. Authenticate B under the same issuer and prove a second DCR
   registration was required. In a separate profile, import a synthetic grant,
   change its URL and revert it; the old environment grant must stay withheld.
   Inspect native files for absence of plaintext synthetic credentials and purge
   only the QA-owned directory.

9. With built native client packages and a real local HTTP MCP endpoint, connect
   using the legacy protocol and immediately close. Prove the endpoint received
   initialize then notifications/initialized before connect returned. Reject the
   initialized POST with HTTP 403 and verify connect rejects with that status
   and rpcMethod provenance. The same 404/405 completion failure must not select
   another transport. Stalled completion must respect caller cancellation and
   the configured request deadline.

10. With built packages, register mcp management in a real safe-bash Shell and
    authenticate a supplied-schema OAuth server against a local synthetic
    protected resource. Deliver its full authorization URL before waiting,
    complete an actual loopback callback, verify state/PKCE/exact redirect and
    one token redemption, and prohibit tools/list and tools/call. In JSON mode,
    URL records belong to stdout and the public connection summary to stderr.
    Recreate the host using the saved native encrypted store: cached access must
    produce a summary without another URL or redemption. Repeat against a
    resource with public initialization and verify explicit consent still occurs
    followed by a fresh authenticated connection. Render and inspect auth text
    output and auth help. Test an explicit host browser selection, canceled
    consent and a failed output sink without production credentials.

11. Use a built native named credential store with synthetic files under out.
    Corrupt its encrypted document and recreate a management Shell with no
    credential environment values. Run mcp reset catalog --json and prove it
    succeeds without a network request. Recreate the host again and bind the
    original environment access token: it must stay withheld by the reset marker.
    Repeat with an authenticated document whose decrypted session is invalid.
    Inspect reset/help screenshots. Exercise mcp auth --reset through a host-owned
    durable reset hook, including cancellation while waiting for the native lock.
    Do not reset production credentials; purge only this QA's synthetic evidence.

12. In a built safe-bash Shell, write only synthetic raw OAuth tokens and full DCR
    metadata to its virtual filesystem. Run mcp import catalog --file /credentials.json
    --json against real local protected-resource/issuer metadata endpoints. Verify
    the public summary, no MCP initialization/list/call during import, complete
    registration metadata and encrypted native persistence. Recreate the host in
    another process, authenticate its supplied-schema server and prove the cached
    grant initializes without registration or token redemption. Repeat with input
    redirection, malformed JSON, invalid UTF-8 and bounded virtual input. Render
    and inspect focused import help and public JSON output. Purge only synthetic
    fixtures and generated evidence after review.

13. Run a local rotating-token issuer and HTTP MCP endpoint with a built native
    encrypted store. Import a fresh synthetic G1 grant through the public SDK.
    Start two independent hosts and hold both G1 resource requests until both
    arrive, then return 401 to each. Exactly one refresh redemption must occur;
    both hosts must initialize with persisted G2 and no replay. Explicitly import
    expired G2, start six independent hosts, and verify one further redemption,
    convergence on G3, and retained rotated refresh credentials. Recreate all
    stores independently, prohibit browser interaction, recursively inspect native
    files for absence of plaintext synthetic credentials, and purge only the
    concurrency fixture directory under out after recording results.

14. Configure an explicit read offline_access scope through init, generate a
    supplied-schema artifact, and authenticate against a real local HTTP issuer
    advertising read/write/admin/offline_access. Return an initial 401 with an
    insufficient_scope challenge advertising read/write/admin. The authorization
    URL must request exactly offline_access read, with verified state, S256 PKCE
    and identical loopback redirect throughout callback/code exchange. Recreate
    native encrypted stores for headless cached access, advance the host clock
    past expiry and verify one silent rotating refresh retains the requested
    scope even when token responses omit scope. Repeat with an explicit scope
    environment override of read: consent requests only read and the issuer may
    correctly withhold a refresh token. Check init env/config screenshots and
    unchanged generated configuration, prohibit tools/list and tools/call, inspect
    native files for plaintext synthetic credentials, and purge the QA-owned out
    directory after recording results. Absent explicit scope stays omitted; the
    native provider does not infer consent permissions from advertised scopes.

15. Configure dynamic OAuth with a generic public auth.clientName, supplied
    tools:[] and no fixed callback. Generate an artifact without connecting,
    then authenticate against a local HTTP issuer whose registration endpoint
    requires that exact client_name. Complete the actual native loopback callback
    through HTTP; verify state, S256 PKCE and the same callback URL throughout
    DCR/authorization/redemption. Recreate the provider/store from the artifact
    and repeat explicit auth. Require one registration, one consent, one code
    exchange and two authenticated initialization sequences, no tools/list/call
    and no plaintext synthetic grants in the encrypted store. Check mcp init
    --format config visually retains clientName while the dotenv template keeps
    its values empty. Caller-supplied registration metadata must remain generic;
    do not add provider names or implicit allowlist impersonation. Record the
    outcome and purge only the QA-owned out directory.

16. Use a real local legacy SSE server whose receive GET initially returns401
    with OAuth resource metadata. Configure transport:sse and a static app with
    client_secret_post; advertise that method and no DCR endpoint. Complete the
    actual native state/S256/loopback callback and verify the original app ID/
    secret appear only in the token form, with no Basic header. The authenticated
    GET must accept text/event-stream, then announce a same-origin /messages
    endpoint; POST must accept application/json, text/event-stream and send
    initialized notification. Recreate a host against the same grant and verify
    one consent/exchange, two initialized receive streams, and both streams
    eventually closed. Await actual server close events instead of assuming
    remote closure happens within one scheduler tick. No tools/list/call or
    provider-specific endpoint rewrites. Record results and purge QA-owned out.
