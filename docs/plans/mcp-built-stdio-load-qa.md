# Built stdio load QA

Execute as an agent using a one-off Node invocation; do not add a repository QA script.

1. Copy the final bundled client into the task-owned isolated core installation. Keep this artifact stable while the maintained root test route builds workspaces.
2. Spawn the offline-installed core with the public StdioTransport and connect through McpClient. Register a declarative echo tool whose object output includes an integer ID and string payload. Use no LLM calls or destructive tools.
3. Exercise modern and legacy connections separately. Run bounded concurrent batches with 64 KiB payloads, checking every returned ID/payload and declared schemas. Await each batch before scheduling the next so the QA driver does not itself create an unbounded queue.
4. Include pre-aborted tool calls and caller edits of capabilities/identity snapshots. Require those edits not to corrupt connection metadata or subsequent requests.
5. Record completed calls, bytes, elapsed time, and memory observations. Memory observations are local qualification evidence, not a cross-platform leak proof. Confirm every child closes after transport disposal and every request has settled.
6. Run maintained fast lifecycle/capacity regressions separately; this load observation does not replace them or HTTP/socket QA.

## Execution evidence

The first overload probe reproduced an unhandled client EPIPE after server output admission exceeded its default 1 MiB queue budget. Five maintained regressions and their fix are recorded in mcp-client-output-stream-failures.md. Rebuilt overload QA then settled all 32 requests as failures, reported child exit code 1, and kept the host alive without added QA error handlers: /tmp/mcp-final-built-stdio-overload-qa.log.

Successful load QA used four concurrent calls per batch, each with 65,536 bytes of multibyte payload, remaining inside the default queue budget. Both modern 2026-07-28 and legacy 2025-03-26 connections completed 16,000 calls: 32,000 total. Every ID and payload matched; pre-aborted calls rejected; capability and identity snapshot mutation did not affect the connection; both child closures were awaited. Maximum sampled host RSS was 147 MiB and later samples stayed around 130–144 MiB. Evidence: /tmp/mcp-final-built-stdio-load-qa.log. This is a local bounded load observation, not a cross-platform memory guarantee.

The final combined protocol/OAuth gate including stream failure and transport error precedence passes 2,309 tests across 108 files: /tmp/mcp-final-complete-protocol-oauth-gate.log.
