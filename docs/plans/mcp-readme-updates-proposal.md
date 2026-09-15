# MCP README additions awaiting permission

The repository instruction forbids README additions without user permission. These concrete additions are prepared for review; no README text was added during this audit.

## tiny-mcp-client

The client tries MCP 2026-07-28 discovery by default and explicitly supports legacy 2025-03-26 initialization. Set McpClientOptions.protocolVersion to 2025-03-26 to choose legacy negotiation. Explicit 2026-07-28 discovery uses requestTimeoutMs (30 seconds by default); automatic compatibility discovery has a one-second deadline. Modern calls resolve multi-round-trip exchanges internally before returning complete results. Result metadata and cache fields are optional in public return types because legacy peers omit them. Client and server capabilities expose optional extensions maps whose identifiers require a valid metadata prefix.

McpClientOptions.maxConcurrentRequests limits active exchanges and defaults to 128; it must be a positive safe integer. HttpTransportOptions.maxResponseBytes bounds JSON responses and individual SSE frames and defaults to 16 MiB. Invalid UTF-8, malformed JSON-RPC envelopes, mismatched response IDs, malformed result metadata, and malformed URI/content fields fail admission.

HTTP requests, OAuth metadata, registration, token requests, and JWKS retrieval forbid automatic redirects. Injected fetch adapters must honor signals and report redirect behavior truthfully. OAuth metadata candidates share a ten-second fetch/read deadline; JSON bodies are bounded to 1 MiB. These controls do not implement DNS address-range policy.

The exported fetchMcpResponse helper applies the same redirect guard to injected adapters before wrappers can lose Response redirect flags. Failed or cancelled reads initiate body cancellation and release owned reader locks without awaiting an adapter's underlying cleanup promise.

## tiny-stdio-mcp-server

ServerOptions supports these bounded admission controls: maxConcurrentToolCalls (4), maxQueuedToolCalls (64; zero disables waiting), maxStdioOutputBytes (1 MiB), maxPendingStdioMessages (128), maxActiveRequests (128), and maxStdioLineBytes (1 MiB). Integer limits must be safe integers meeting their documented minimums. toolCallTimeoutMs is optional and must be a positive integer when supplied.

Input schemas require an object root. Output schemas may describe any JSON value, while the schema document itself must be an object. Modern scalar/array/null outputs retain structuredContent; incompatible output schema descriptors are omitted for legacy clients. Metadata keys follow the MCP prefix/name grammar, and resource identifiers must be valid URIs without raw whitespace, control characters, non-ASCII characters, forbidden URI punctuation, or malformed percent escapes. Percent-encode Unicode in resource URIs.

## tiny-http-mcp-server

Modern requests use stateless version/capability metadata and matching HTTP headers. Legacy sessions remain explicitly supported. maxResponseBytes defaults to 16 MiB; maxSessionsPerSubject defaults to 16; maxSessions defaults to 128. Stream buffering defaults to 1 MiB, retained SSE history defaults to 100 events, and legacy session TTL defaults to 15 minutes. Keep modern subscription POST streams distinct from legacy session GET streams.

## toolcraft-schema

The exact proposed formats paragraph is prepared in mcp-metadata-key-format-conformance.md. Explicitly registered custom string formats are assertions; unregistered formats remain annotations. Native JSON Schema assertions remain authoritative across SDK, CLI, and MCP projection, including conditional branches and local references.

## terminal MCP packages

Both CLIs accept --help, reject unsupported arguments with exit code 1, and keep help/errors on stderr. Default invocation starts silent stdio protocol service. No --http option is implemented by these terminal entry points. Package QA uses maintained packing and an isolated installation; external dependency installation requires registry access.

These changes add no environment variables. Do not treat this proposal as permission to edit README files.
