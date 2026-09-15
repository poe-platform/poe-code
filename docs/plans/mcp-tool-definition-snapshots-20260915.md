# Isolate MCP tool definitions from caller mutation

The production-readiness audit reproduced three defects: both registration routes retained caller schema objects, and tool-list results exposed nested private definitions. Mutating either input or output schemas changed live compiled validation; mutating returned descriptors also altered nested icons and metadata.

Deep-copy tool definitions before compiling validators, retain those independent snapshots internally, and return independent copies from tools/list. Keep handler functions outside copied descriptors. Caller-owned objects remain mutable. The change introduces no new configuration, dependencies, or README additions.

The three regressions failed before the fix. Their transport-independent behavior is now verified through legacy SDK calls; all three pass in approximately 9 ms. Snapshot/envelope/protocol suites pass 46 tests; the maintained selected HTTP build closure passes seven builds; focused ESLint and repository type contracts pass. Current combined core/HTTP/client suites pass 1,839 tests before a subsequent SDK capacity fix.

This atomic fix can be committed separately from the unfinished 2026-07-28 migration by staging only snapshot changes to server.ts. Modern per-request lifecycle, output-schema widening, header descriptors, and subscription work remain in the worktree. No unrelated source or plans are staged. No push or release is performed.
