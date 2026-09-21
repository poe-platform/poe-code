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

17. Generate a supplied-schema dynamic-OAuth artifact with an explicit client-ID
    environment reference. Use three separate built hosts and a synthetic native
    encrypted store: import a fresh grant for the original app; recreate with a
    different app ID and no initial token; recreate with the original ID. Require
    the changed-app command to fail before any MCP/issuer network request without
    altering the saved grant, while the original app still completes its tool
    call. Also verify changed/omitted explicit secrets, expired grants and pending
    refresh outcomes in focused native regressions. Dynamic registration without
    an explicit app must still reuse its saved native client. Inspect the safe CLI
    diagnostic screenshot, check encrypted files for plaintext synthetic tokens,
    record results and purge only this QA's fixture directory under out.

18. Create native default providers with dynamic and static apps against a real
    local OAuth issuer. After creation, change the caller's client mode,
    interactive policy, lock deadline, callback URI, browser opener, signal,
    authorization deadline and nested landing-page strings. Complete an actual
    HTTP state/S256/loopback callback using the selected original opener and
    require the original page text. Dynamic mode must register once; static mode
    must never register and must exchange using its original app ID. Reuse the
    grant silently without further network or browser requests. Separately prove
    a headless provider cannot be enabled by caller mutation and the originally
    selected AbortSignal still cancels after its option handle is replaced. Use
    explicit in-memory session stores; inspect safe summary output visually and
    purge only this QA's synthetic directory and screenshot after recording.

19. Establish an offline_access grant against a real local issuer using native
    encrypted session persistence. Expire the stored grant, recreate a headless
    provider, and hold its rotating refresh request. During redemption, mutate
    the original fileStore path and encryption salt. Inspect the original record
    for durable pending intent and require the original lock claim to remain.
    Start an independently recreated follower against the original settings,
    release redemption, and require exactly one refresh and identical winning
    Authorization headers. The original record must retain the rotated grant,
    the replacement directory must remain absent, released lock claims must be
    empty, and encrypted files must contain none of the synthetic tokens. Purge
    only this QA's data before a visual rerun, then record results and purge its
    entire owned out directory and screenshot.

20. Select native encrypted persistence through an explicit host backend
    environment variable, then through a task-owned ambient variable. After
    creating each session store and acquiring its file lock, change the variable
    to Keychain or an invalid value and save/load a pending-intent record. Require
    the originally selected encrypted record and lock throughout, no Keychain
    command invocation and no unrelated environment getter access. Restore the
    task-owned process variable in finally. Verify explicit backend selection
    short-circuits environment reads, compile a strict external TypeScript
    consumer of resolveSecretStoreBackend and native factories through public
    built exports, inspect safe summary output and purge the owned evidence.

21. Hold the first initialization in a two-server real HTTP registry discovery.
    Replace the later entry's OAuth provider wrapper, then update the originally
    selected custom provider implementation and release initialization. Require
    the original selected object with its live implementation on every later
    request. Generate a second custom-provider command offline, replace only its
    wrapper and invoke successfully. Generate a supplied-schema default-OAuth
    command with an original app, registration, scoped literal grant and native
    persistence path. Before invoking, mutate app/scope/grant/callback/path and
    install a throwing getter on caller registration. Require original
    Authorization headers, no caller registration reread, original lock path,
    no replacement directory, complete JSON output and exact005930 arguments.
    Generation must perform neither network nor persistence access. Require two
    tools/list operations, two calls and four distinct retired HTTP sessions.
    Inspect safe summary output, record results and purge owned evidence.

22. Gate real local HTTP protected-resource metadata during credential import.
    Select host-owned persistence and replace/remove its importSession hook while
    discovery waits. Also remove that hook from the selected host now callback
    during lifetime normalization. Require exactly one invocation of the original
    hook with its original receiver and live state, no replacement invocation,
    no session-factory query and no native fallback. Separately select native
    file persistence, then mutate its path and backend environment during gated
    discovery. Require the imported full app registration and grant at the
    original encrypted record, anchored relative expiry, no replacement directory
    and no plaintext tokens. All four imports use only eight metadata GETs,
    without initialization or tool calls. Native construction may resolve its
    path early but must not write anything until validated discovery. Inspect the
    final safe summary screenshot and purge owned evidence.

23. Use public HTTP MCP initialization followed by actual local static-app OAuth
    consent. Gate its host reset hook, replace caller fetch and browser signal,
    then release reset. Require the selected original fetch/browser policy,
    exactly one state/S256/actual-loopback code exchange and a second initialized
    connection verifying the grant. Repeat with original browser cancellation
    during gated reset while replacing its option handle with a fresh signal;
    require original failure identity, no second consent/exchange and session
    retirement. Separately gate standalone host resets, replace signal handles
    with an aborted signal or abort the original then replace it with a fresh
    one. Hook policy and final status must retain the original signal. Require
    three distinct retired sessions and no tool list/call. Inspect safe summary
    output, record results and purge only owned evidence.

24. Gate the initial modern HTTP initialization POST, then return405 to negotiate
    legacy SSE for a direct resource read. While it waits, replace the custom
    OAuth provider wrapper or mutate the default imported access grant. Run the
    two modes sequentially against actual node:http sockets. Require original
    Authorization on all five requests, an exact resource URI, complete text,
    base64 blob and nested metadata, and only initialize, initialized notification
    and resources/read RPCs. Await the server-observed receive-stream close in
    each mode; replacement providers must never run. Inspect the safe summary
    screenshot, record results and purge only the owned synthetic evidence.

25. Bind two supplied-schema OAuth servers using a host session factory that
    replaces or removes its own caller option on the first invocation. Bind a
    third case with a relative imported lifetime and a clock that removes the
    factory before provider construction. Require the original factory for all
    five providers, live reads of all selected stores and no replacement/native
    fallback. Generate commands without any HTTP work, then invoke them against
    an actual node:http MCP, verifying original per-server grants, complete
    results and exact005930. Require five retired sessions and zero tools/list.
    Keep a stable session ID on each fixture connection and answer unsupported
    receive-stream GET with405. Inspect safe summary output and purge owned data.

26. Use built native providers with a host store over an actual local token
    endpoint. Gate the first session read, backend-lock callback, refresh-intent
    write or rejected-request provenance read; cancel with an identifiable
    original reason. Require caller settlement before releasing the callback.
    For transaction-owned work, start a follower and require its read/redemption
    to remain blocked. After release, read/lock followers may refresh exactly
    once each; the intent-write follower must reject retained pending intent
    without redemption. Provenance cancellation must never continue afterward.
    Separately gate lazy explicit discovery and require prompt cancellation with
    no consent/token traffic. An already canceled rejection must not read any
    credentials. Run explicit library authentication with a50ms operation
    deadline and gated persistence; require TimeoutError before callback release
    and no MCP traffic. Record two safe follower refreshes and zero canceled
    redemption/replay, inspect the corrected safe summary screenshot and purge
    only owned evidence. A backend-lock gate must have zero session reads until
    the lock callback resumes.

27. Gate initialization during actual HTTP artifact discovery and replace its
    caller signal handle with an unrelated aborted signal. Repeat with an
    original two-tool configuration ceiling changed to one, then an original
    one-tool ceiling changed to two. The first two generations must retain their
    original policy, validate complete artifacts, import the dependency-free ESM
    module and recreate offline command help. The third must reject its original
    one-tool ceiling after discovery. Require three tools/list requests, no
    tools/call and three distinct retired sessions. Inspect safe summary output,
    record results and purge owned synthetic evidence.

28. Discover schemas over actual HTTP using an OAuth imported grant and an
    explicit API-key header. During binding, replace the caller environment
    object, mutate its key value from the clock, or mutate it from the selected
    store factory. Require the original header on every request, while the
    server echoes that original credential in its initialization identity and
    an annotation property name. All three generations must reject with a safe
    credential-reflection diagnostic and emit no artifact. An unrelated
    nonenumerable environment accessor must remain unread. Require three
    listings, three distinct retired sessions and no tool, consent or token
    traffic. Inspect safe summary output and purge owned synthetic evidence.

29. Bind a supplied-schema OAuth server with a relative imported lifetime,
    followed by a bearer-authenticated server or a server with an API-key header.
    Let the first server's host clock mutate the environment reference used by
    the second. Require original registry values to have been captured before
    that callback, using a128-byte combined credential budget and no unrelated
    accessor reads. Generate commands offline, then invoke all four commands
    across the two modes against actual HTTP. Require original grants/headers,
    complete results/exact005930, four distinct retired sessions, no tools/list
    and no consent/token traffic. Inspect safe summary output and purge owned
    synthetic evidence.

30. Bind native OAuth with a relative imported grant, original browser opener,
    nested landing page and encrypted file path. Let the clock mutate all three
    caller settings during binding. Expire the grant and complete actual local
    static-app state/S256/loopback consent with the original opener/page. Require
    one consent and code exchange, original app/redirect/verifier, original
    encrypted record/anchored new expiry, no replacement directory and no
    plaintext synthetic grants. Recreate a headless host at the original path
    without initial tokens and require silent reuse. Read a complete remote
    text/blob/metadata resource through actual HTTP, retire its one session and
    require no tools/list or tools/call. Await actual page-body delivery before
    inspecting the safe summary screenshot; record results and purge only
    owned synthetic evidence.

31. Create a native provider with an imported relative grant whose own lifetime
    field is nonenumerable. Let its clock mutate caller access/refresh/scope
    values while anchoring expiry. Require original values, exact61000ms expiry
    and original Authorization through actual HTTP schema discovery. Separately
    parse a raw grant with a clock that replaces validated expiry options with
    Infinity. Require the original finite expiry, successful HTTP authorization
    using the parsed result and rejection when a new parse explicitly receives
    those now-invalid options. Creating a new provider may capture the caller's
    newly selected token values. Require two listings/two distinct retired
    sessions, no tool/consent/token traffic, inspect safe summary output and purge
    owned synthetic evidence. Preserve existing own timing-field reads; do not
    infer that nonenumerable access credentials were previously accepted.

32. Import a relative raw grant through a host atomic hook and actual local
    OAuth metadata. In the host clock, replace its caller signal with an
    unrelated aborted handle, abort the original and replace its handle with a
    fresh signal, or replace its fetch with a failing dependency. The first and
    third modes must import the original full app/grant and anchored expiry
    using the selected original signal/fetch, exactly two metadata GETs each.
    The second must retain original cancellation identity before any metadata
    request or persistence. Require two atomic imports, zero host session
    factory/replacement-fetch queries, zero native fallback and no
    initialization/tool/token traffic. Inspect safe summary output and purge
    only owned synthetic evidence.
