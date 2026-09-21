# Remote MCP command contract QA

Execute as an agent against built safe-bash-mcp and native client packages.
Use a synthetic local HTTP MCP endpoint and keep fixtures under
out/remote-mcp-output-qa. Purge only this directory after recording results.

1. Supply schemas for a large-result tool, an isError result, a JSON-RPC error,
   an echo tool and a tool whose literal name includes the configured server
   prefix and a dot. Make schema discovery fail if attempted.
2. Run generated commands in a real safe-bash Shell. For a response larger than
   two MB containing multibyte UTF-8 text, compare complete stdout bytes,
   redirected virtual-file bytes and a pipeline through the standard cat command.
   Preserve content, structuredContent and metadata without rewriting fields.
3. Start the same built host in a child process with stdout connected to a real
   native pipe. The host's output sink must await process.stdout.write callbacks.
   Delay consuming the pipe for 500 ms; after resuming, compare every UTF-8 byte
   with the expected serialized result. No forced process exit belongs in this
   library; native hosts own their process lifecycle and pipe policy.
4. Write a complete JSON argument object to the shell's virtual filesystem with
   a string over 140 KB containing newlines, quotes, Unicode and literal shell
   syntax. Invoke --raw - with input redirection and output redirection. Verify
   exact server-received and echoed values, bounded input and no shell expansion.
   The @path named-string convention is intentionally not interpreted; @literal
   must stay literal and host filesystem reads must never be introduced.
5. Verify unknown tool arguments return 2 before connecting, isError and protocol
   failures return 1, and actual shell &&/|| conditions select the recovery branch.
   Preserve the full tool error result and protocol diagnostic code/data.
6. Invoke both a plain tool and a literal server-prefixed dotted tool. Generate
   an artifact, recreate a Shell, load its public plugin and verify the exact
   dotted name reaches the endpoint without rediscovery or name splitting.
7. Supply integer, boolean, object and item-enum arrays. Verify actual HTTP calls
   retain arrays and their item types, while invalid integer/enum values return
   2 before network access. Check archived schemas keep all item constraints;
   this CLI exposes schema-derived flags rather than synthetic TypeScript
   signatures or generated examples.
8. Record observations in docs/plans/remote-mcp-safe-bash.md and remove only the
   QA-owned fixtures and generated evidence.

9. For result ownership, run a local synthetic HTTP endpoint with five tools:
   dual pre-stringified JSON text plus structuredContent; multiple JSON-text
   blocks plus a structured result array; an isError payload with literal json,
   data, status, summary, meta and trace fields; non-JSON text plus a plain
   structured object; and mixed text/resource-text/resource-blob content with
   metadata. Invoke each through both direct commands and a recreated artifact
   Shell. Compare stdout bytes with JSON.stringify of the complete expected
   result plus newline, verify isError returns 1, and require empty stderr and no
   tools/list. Native JSON-RPC handling unwraps the protocol envelope; the library
   must never guess that payload json/data/result fields are another envelope.
   Preserve blob bytes rather than replacing them with rendering placeholders.

10. Verify host transport compatibility using a local HTTP endpoint and an
    explicitly injected node:http-backed HttpTransportFetch. Require HTTP/1.1,
    bearer/API-key/tenant headers (including equals signs), canonical POST Accept
    despite a supplied text/plain value and JSON content type. Discover once,
    generate JSON/ESM artifacts, recreate a Shell with commands.fetch explicitly
    supplied, then call the archived tool and redirect its output to a virtual
    file. Require exact schema-declared string values, no new tools/list and no
    resolved credentials in artifact bytes. Injected adapters must honor redirect:
    error and cancellation; native tests reject already-redirected responses.
    Reject an overflowing requestTimeoutMs before network access and visually
    inspect the management-command error/exit-status screenshot. Do not infer
    vendor-specific transport modes from hostnames or retry authentication errors
    with legacy SSE.

    Also pin protocolVersion to 2026-07-28 against an endpoint that rejects modern
    discovery but supports legacy initialization. Direct commands and recreated
    artifacts must exit 1 after only server/discover, with no initialize, tool
    call or SSE attempt. Unknown caller pins fail before any network request.
    A host that omits the pin must retain automatic legacy negotiation and calls.

    With the official SDK server's JSON and SSE response modes on real HTTP, pin each legacy revision
    2025-03-26, 2025-06-18 and 2025-11-25. Discover once per endpoint, call through
    direct and recreated ESM commands, and read a resource. Require exact string
    IDs, only one tools/list, no modern discovery for legacy pins, selected-version
    headers on later POST/GET/DELETE, retired sessions and closed receive streams.
    Native standalone SSE posts must retain the same pinned revision. Automatic
    negotiation may accept any supported legacy revision selected by a server;
    an explicit pin rejects a different supported revision before initialized.
    Leave an initialization POST stream open after its final response; later
    tools/list must still send promptly, and that response reader must be canceled
    independently of any long-lived GET receive stream.

11. Generate a dependency-free ESM artifact with two tools sharing a dashed
    name prefix and one exact dotted name. Include a required field named schema,
    annotations and an output schema. Write the module, change the native host's
    working directory, import it and recreate a Shell. Inspect server/tool help
    and `<server> <exact-tool> --schema`; require complete selected Tool JSON,
    the distinct --schema-2 field flag, no network calls and exit 2 for a missing
    tool. Visually inspect help and schema output. Raw --schema must be rejected
    as invalid JSON rather than interpreted as inspection; inline field values
    such as --schema-2=--schema remain literal arguments.

12. For resource access, expose resources/list, resources/templates/list and
    resources/read on real synthetic HTTP and legacy SSE endpoints, with no
    tools capability. Through accessRemoteMcpResources and the management
    `mcp resource` command, preserve one complete list/template page, exact
    opaque cursors and read results containing both text and base64 blob data
    with metadata. Send file:///remote URIs to the endpoint and redirect output
    into the virtual filesystem; no host file reads or synthetic tools belong
    in this flow. Require no tools/list or tools/call, native connection cleanup,
    headless OAuth policy and nonzero protocol-failure diagnostics. Test bounded
    input, complete deadlines and pre-aborted host signals before credential
    binding. Inspect the resource help/result screenshot and purge own fixtures.
    Check `mcp resource --timeout-ms=100` against a stalled real resource read:
    the CLI override must replace a longer host deadline, retain exit 1 and
    close its session. Check `mcp generate --timeout-ms 100` against stalled
    tools/list with the same override and cleanup expectations. Generation's
    timeout applies per discovery request; resource timeout covers the complete
    operation. Supplied schemas remain offline with an explicit timeout. Inspect
    help and timeout diagnostics using the maintained screenshot renderer.

13. For server input, use actual modern HTTP input_required responses and legacy
    server-initiated elicitation/create requests over an HTTP receive stream.
    Advertise form and URL capabilities without sampling or roots. With no host
    handler, decline immediately and observe only a safe generic hint through
    onWarning; never follow an input URL or render untrusted prompt controls.
    Preserve the final complete server result. Recreate supplied-schema artifact
    hosts with explicit onElicitationRequest callbacks; require full typed form
    parameters, server identity, native signal, exact accept/decline/cancel values
    and retained requestState during modern continuations. Verify malformed input
    and host responses fail before a continuation, invalid discovery elicitation
    stays rejected by the modern protocol, and canceling a stalled hook preserves
    cancellation identity without another request. Keep the configured deadline
    active through stalled host callbacks and every modern continuation round;
    require hook-signal abortion, exit 1 and zero late continuation requests.
    Explicit native timeoutMs:null remains unlimited. Await real legacy stream close
    events, inspect result/hint screenshots, record observations and purge only
    this QA's synthetic fixtures under out.

14. Supply a draft-7 tool schema whose enabled field triggers a schema dependency
    declaring an integer retries field with minimum 0. Direct and recreated ESM
    artifact help must show --retries and its description without discovery.
    Named flags and raw JSON must both send enabled:true and retries:0 unchanged
    to an actual HTTP endpoint. A missing retries field and retries:-1 must return
    2 without network access; property dependency arrays must not create fields.
    Inspect both help/result screenshots and purge this QA's owned evidence.

23. Discovery and artifact policy overrides: serve two tools in separate pages
    through an actual local HTTP MCP endpoint. Generate with --max-pages=2,
    --max-tools 2 and --max-response-bytes=4096 over host limits of one. Verify
    both exact schemas and cursor order. Lower each limit independently and
    verify nonzero failure, empty artifact stdout and owned session retirement.
    With supplied schemas, exercise --max-configuration-bytes and
    --max-artifact-bytes without credential reads or requests. Inspect generation
    help and policy-failure screenshots. Purge only this QA's owned evidence.

24. Resource limits: configure host resource input/response limits of one byte.
    Against a real local HTTP endpoint, override with --max-input-bytes=100 and
    --max-response-bytes 4096 and verify complete text/blob/metadata output with
    no tools/list. Lower input to one byte and verify exit2 before initialization;
    lower response to one byte and verify exit1, empty result stdout and session
    retirement. Inspect resource help and byte-limit diagnostic screenshots and
    purge only this QA's owned fixtures.

25. Import policy overrides: against a real local OAuth metadata endpoint, import
    a virtual credential file with --max-import-bytes 4096 and
    --lock-timeout-ms=1000 over host values of one. Verify two metadata requests,
    exact original client/grant and timeoutMs=1000 at the atomic host hook. Lower
    the byte budget below the payload and verify no additional metadata/hook
    calls, nonzero status and credential-free diagnostics. Repeat via virtual
    stdin, inspect import help/summary/byte-failure screenshots and purge owned
    synthetic evidence. Existing native process-lock QA covers actual native locks.

26. Primary close reasons: return an oversized initialization body after assigning
    a session. Delay DELETE beyond 50 ms, then separately return DELETE HTTP 500.
    Native connect and generated tool execution must retain the response-byte
    failure. HttpTransport.closeReason must resolve before deletion completes;
    transport.closed must await cleanup and retain the DELETE failure separately.
    Inspect the CLI diagnostic screenshot, require empty result stdout and exit1,
    and verify every assigned session receives DELETE. Buffered initialization
    responses and generic transport state transitions remain covered by the
    maintained native transport tests. Purge only owned fixtures and screenshots.

27. Generated execution policies: use supplied tools with fields named timeoutMs,
    maxResponseBytes, maxInputBytes and maxOutputBytes, plus a tool literally named
    --timeout-ms. Override timeout/response settings before the selected tool and
    preserve all same-named field flags after it. Repeat through a written ESM
    artifact and recreated host without tools/list. Bound virtual UTF-8 stdin,
    complete output JSON and stalled native RPC calls; invalid/repeated settings
    fail before connecting, response failures retire assigned sessions and input/
    output settings cannot raise host ceilings. Require specific bounded output
    diagnostics with empty result stdout. Inspect help and failure screenshots.
    Serialize QA runs sharing a written artifact so each imports its own endpoint.
    Purge only owned fixture files and screenshots.

28. Authentication response policy: use a real bearer-protected local HTTP MCP
    endpoint whose initialization contains synthetic credential-looking metadata.
    Override a one-byte host response limit with separated/inline
    --max-response-bytes=4096, then lower it to eight. Require safe public success
    summaries, response-byte failure with empty stdout, no tool list/call and
    three distinct session deletions. Repeated values fail before network/binding.
    Inspect auth help and failure screenshots and purge only owned evidence.

29. Final-handshake precedence: hold a real HTTP GET until the initialized POST
    arrives, then answer GET403 and DELETE500 before finishing initialized202.
    Native connect must expose GET403 with notifications/initialized provenance;
    transport.closed retains DELETE500 separately. Generated command diagnostics
    must report GET403, empty result stdout, exit1 and zero tools/call, with both
    assigned sessions deleted. Inspect the failure screenshot and purge owned QA.

30. HTTP diagnostic provenance: initialize successfully, then deny the initialized
    POST with403. Generated stderr must retain status403, methodPOST and
    rpcMethod:notifications/initialized, with exit1, empty stdout, zero tool calls
    and session retirement. Inspect the diagnostic screenshot and purge owned QA.

31. Compiled parser ownership: compile through the built public SDK, then rename
    the caller's tool and separately replace its name with a throwing getter.
    Invalid input must identify the original tool without rereading metadata;
    valid numeric-looking strings must remain exact. Strictly compile a public
    external consumer using ToolArgumentParser, execution policies and optional
    McpTransport.closeReason without casts/deep imports. Inspect diagnostics and
    purge only owned synthetic consumer files and screenshots.

32. Schema input ownership: hold a real HTTP initialization response, then mutate
    the caller's name, URL, Headers and signal handle. Resolve with the original
    identity/headers/signal. In a second mixed-registry wave, mutate a later
    supplied entry's name/URL/tools/instructions and append another entry while
    the first connection waits. Require exactly the original two entries,
    authoritative original supplied tools/guidance and no replacement endpoint
    requests. Verify two tools/list operations and retired sessions, inspect the
    result screenshot and purge only owned synthetic fixtures/evidence.

33. Reconnect actual HTTP receive streams after a completed event ID, then after
    id-less notifications or keepalives. Require exact inherited headers through
    a third GET. In two other modes send empty id: and require no resume header,
    including when the initial configuration supplied a cursor. Hold the tool
    response until the third receive GET, then return complete SSE POST content/
    falsey structured values/nested metadata/exact005930. Require twelve GETs,
    four full calls/four distinct retired sessions and zero credential/consent
    traffic. Inspect safe summary screenshot and purge only owned evidence.

34. Send accented/Chinese/emoji completed event IDs over actual receive SSE.
    Hold each operation until a second GET and decode its server-observed raw
    Last-Event-ID bytes as UTF-8; require the exact original cursor. Cover native
    calls, generated virtual-shell calls and resource reads. Require eighteen
    receive GETs, six complete tool calls/three full text/blob reads with falsey
    values/Unicode metadata/exact005930 and nine distinct retired sessions.
    Require zero discovery/credential/consent traffic, inspect safe summary
    screenshot and purge only owned evidence.

35. Through actual HTTP and legacy SSE native tool calls, cover all three
    supported legacy revisions. Replace/remove borrowed progress options from a
    selected host OAuth callback; require the original outgoing token, complete
    content/falsey structured values/nested metadata/exact005930, active progress
    before result and no late progress after completion. Use a subsequent ordered
    log notification to prove the late event was consumed before assertions.
    Retain the original live signal when its borrowed handle is replaced. Require
    eighteen full calls/twelve active updates/eighteen ignored late updates,
    eighteen closed receive streams/nine retired HTTP sessions and zero metadata/
    token/tool-discovery/consent. Inspect summary screenshot and purge only owned
    synthetic evidence.

36. Reject a trailing empty fragment on registry URLs through thirteen SDK
    entry points: schema/registry/commands/plugin/init/parse/binding/artifact/
    resources/auth/reset/import/management. Require safe diagnostics before
    network/store factories/credential writes. Retain escaped hash data in
    resource path/query through schema/configuration/artifact and an actual
    virtual-shell call. Require complete content/falsey values/nested metadata/
    exact005930, offline help/supplied schemas and one retired session without
    discovery/consent. Inspect safe summary screenshot and purge owned evidence.

37. Announce named/empty endpoint fragments through actual legacy SSE. Cover
    native clients plus schema/generated-command/resource/management-auth routes,
    pinned SSE and automatic HTTP404 fallback. Require eighteen safe failures
    before any credential POST to those endpoints and every receive stream closed.
    Across all three supported legacy revisions retain percent-escaped hash
    endpoint path/query with twelve valid handshakes, six complete calls/three
    full text+blob resources/three complete tool listings and guidance/falsey
    values/nested metadata/exact005930. Require thirty closed receive streams/
    eight HTTP fallback failures and zero metadata/token/consent/credential writes.
    Inspect safe summary screenshot and purge only owned synthetic evidence.

38. Before native HTTP/SSE OAuth construction, reject original malformed/relative/
    non-HTTP/credential-bearing/named+empty-fragment targets with fourteen safe
    errors and zero host clocks/fetch calls. Through actual native/schema/generated/
    resource/management routes retain exact uppercase-scheme original target
    strings and escaped hash path/query data under all three legacy revisions.
    Require thirty handshakes/twelve complete calls/six full schemas/six text+blob
    resource reads, eighty-four credential POSTs/fifteen retired HTTP sessions/
    fifteen closed SSE receive streams, with full guidance/falsey metadata/
    exact005930 and zero OAuth metadata/token/consent. Inspect summary screenshot;
    purge only owned synthetic evidence.
