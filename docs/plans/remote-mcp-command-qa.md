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
