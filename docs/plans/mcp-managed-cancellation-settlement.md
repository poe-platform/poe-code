# Managed HTTP reader cancellation settlement

Two fast managed MCP tests reproduced retained upstream reader locks when adapter cancellation never settled: aborted reads and buffered invalid UTF-8 bodies. The buffered case requires multiple source chunks to avoid a pending read independently triggering release.

SafeJS's response wrapper now initiates reader cancellation and releases lock ownership, timers and abort listeners immediately, rather than waiting for underlying cancellation completion. Eventual cancellation rejection remains handled. The transport keeps its existing request and close deadlines.

Red evidence: /tmp/mcp-managed-cancellation-settlement-red2.log (two failures). Green evidence: /tmp/mcp-managed-cancellation-settlement-green.log. Final maintained consumer/build gates must follow the change.
