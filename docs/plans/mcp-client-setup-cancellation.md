# MCP setup cancellation

Four fast in-memory red tests reproduced discovery, initialization, initial subscription acknowledgement, and tools/list remaining pending after caller abort. Accept an optional signal at client connect/listTools boundaries, pass it into existing request cancellation, and forward it into initial subscription acknowledgement. Preserve abort reasons and do not fall back to legacy initialization after discovery cancellation. Failed connections retain existing transport disposal and disconnected-state cleanup.

The four regressions and maintained subscription suite pass 13 cases; the earlier discovery/initialization/listing regressions and negotiation suite passed 16 cases. Full client verification follows the selected maintained Toolcraft dependency build closure.

A separate Poe-agent red test reproduced constructing a transport/client when setup was already aborted. Move the abort check before construction. Its maintained setup suite passed 16 cases. The maintained pagination setup contract additionally reproduced missing signal propagation; forward the run signal through connection and every tools page. Verify its suite and built consumer types.

No README additions, commits, pushes, or release claims are made by these checks.

Ten red requests reproduced cancellation gaps across resource listing/templates/reads, prompt listing/reads, completion, logging, ping, and legacy resource subscription changes. Forward optional signals through their existing message-layer cancellation; canceled operations preserve the original reason and retain ready client state.

Two more red checks reproduced modern resource subscription setup and duplicate-waiter cancellation gaps. Setup cancellation controls the subscription's owned controller only until acknowledgement. Duplicate-waiter cancellation stops that wait without canceling the original subscription setup. Detach signal listeners after settlement. The complete setup and maintained modern subscription matrix passes 25 cases in /tmp/mcp-client-modern-resource-cancellation-green.log. Full client and consumer type gates follow.
