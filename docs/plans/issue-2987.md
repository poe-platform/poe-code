# Issue 2987: diff streams and optional resource limits

Implement and verify the complete issue against current main, including its
additional audit comments. Preserve caller-configured finite quotas and reject
invalid quota values; omitted quotas and explicit positive Infinity mean no cap.

1. Add failing diff regressions for `/dev/null`, readable top-level character and
   FIFO inputs, descriptor inputs, and creation/deletion patches. Keep recursive
   directory comparisons and regular-file retained-read checks intact.
2. Audit each named command, extracted command workspace, engine and MCP path.
   Add behavior regressions for remaining default caps and Infinity validation,
   then fix validated gaps and update existing usage documentation.
3. Verify focused tests, configured finite quotas, cancellation and GNU output
   parity. Run the maintained full unit and lint routes for the cross-workspace
   change, plus a CLI screenshot for the changed visible behavior.
4. Commit atomic improvements, push to main, verify the delivered commit and
   complete requirement coverage, then close issue 2987. Release completion is
   not a prerequisite under the user's explicit delivery instruction.
