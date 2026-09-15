# MCP HTTP tool schema filtering

Part of the nine-hour MCP production-readiness goal. MCP 2026-07-28 requires HTTP clients to exclude invalid x-mcp-header definitions without losing valid tools, mirror exact static primitive paths, and encode mirrored values safely.

## Implementation and evidence

Two initial tests reproduced invalid header definitions being retained and nested annotations not being mirrored. The client now validates/filter tools through an optional transport hook, snapshots annotation descriptors, and emits encoded primitive parameter mirrors from those descriptors. An optional onWarning callback reports the rejected tool name and reason. Cursor pages retain previous descriptors; a new first page and transport disposal reset the cache.

Additional regressions reproduced malformed tool-list items causing untyped errors or being accepted, and configured template headers being emitted when the matching argument was absent. Tool lists now validate basic item envelopes before filtering, and known template parameter headers are cleared before deriving actual argument mirrors.

Six focused client tests pass. Core/client/HTTP verification passes 1742 tests across 53 files. Selected tiny-http-mcp-server build closure and focused ESLint pass. No README additions are made without permission.

## Remaining work

Default modern negotiation, cache capacity/lifetime limits, notification invalidation and stale-schema retries, stream ownership/cancellation, and client MRTR processing remain incomplete. The modern shared-core/HTTP migration remains under development; do not claim production readiness from this atomic filtering work. No push or release is performed.
