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
