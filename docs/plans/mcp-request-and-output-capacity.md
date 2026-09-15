# MCP exchange and response capacity

Reproduced unbounded outstanding client exchanges. Enforce a configurable maxConcurrentRequests default of 128 across whole exchanges, including MRTR callback waits. Six invalid-limit cases reject; capacity recovers after cancellation and successful retries.

Reproduced missing callback cancellation signal and a suspended MRTR callback wait retaining exchange capacity. Each exchange owns a cancellation controller; caller abort and disposal reject the wait, cancel pending round requests, notify cooperative callbacks and release capacity. Export callback request context to roots, sampling and elicitation callbacks. Do not mutate caller signals on disposal.

HTTP queue limits allow immediate writes even at zero. Preserve that behavior; add a separate maxResponseBytes limit, default 16 MiB, for JSON bodies and full SSE frames. Reproduced oversized modern SSE acknowledgements, modern JSON responses, and legacy SSE tool responses. Reject output before headers/writes and retain request cancellation cleanup. Forward the limit through the HTTP CLI and Toolcraft API.

Validation: 470 client tests / 27 files pass; 439 HTTP server tests / 21 files pass after historical session fixtures select legacy explicitly. The selected Toolcraft closure build and client lint pass. CLI hardening flag forwarding regression reproduced and passes. Remaining work: legacy notification/replay-history size retention, callback cancellation of legacy server requests, output observability, screenshot verification and approved README configuration rows.

HTTP help screenshot generated with the maintained renderer and visually inspected: /tmp/mcp-http-help-response-size.png. The npm screenshot-poe-code route fails on sandbox tsx IPC creation; invoking the same renderer via Node's tsx loader succeeds without IPC. Response-size flag aligns with existing two-line capacity options. Queue and keepalive descriptions now apply to all SSE streams, including modern POST streams; final refreshed screenshot pending.
