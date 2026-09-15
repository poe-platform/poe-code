# MCP client stream failure ownership

Built stdio load QA exceeded the server's bounded output queue. Child termination then emitted an unhandled stdin EPIPE, crashing the host client. Five fast in-memory regressions separately reproduced unhandled child stdin/stdout/stderr errors, unhandled JSON-RPC output errors, and requests remaining pending after output closure.

Own all child stream error events in StdioTransport, dispose the child, and retain the stream failure as the closure reason. Resolve closed with the actual child exit status, preserving existing process-status behavior. JsonRpcMessageLayer also owns output error/close events and settles pending requests and incoming exchanges through existing disposal.

Keep late error listeners alive after disposal to avoid a delayed pipe error becoming an unhandled event. Listeners are attached once to each stream; no polling or extra timers are introduced.

Red evidence: /tmp/mcp-output-all-stream-failure-red.log. The first fix exposed an existing real-process status assertion; preserve process exit status before declaring green. Final focused evidence: /tmp/mcp-output-stream-failure-green2.log. Rebuild the client and rerun both queue-overload failure QA and load below the bounded queue budget.
