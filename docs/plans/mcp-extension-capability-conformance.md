# MCP extension capability conformance

Official 2026-07-28 ClientCapabilities and ServerCapabilities expose optional extensions maps. Extension identifiers follow metadata key grammar with a mandatory prefix; per-extension settings remain application JSON objects.

Two compile diagnostics reproduced missing public extension fields. Six protocol regressions reproduced acceptance of unprefixed/malformed identifiers in client and discovery capabilities. A client regression also reproduced writing malformed capabilities before discovery.

Expose extension maps in public client/server capability types. Add propertyNames format admission to only the two normative extension maps in the owned protocol schema clone. Preserve arbitrary settings keys and unknown reserved extension names without interpretation. Validate client capabilities before writing discovery and clean up rejected connection state through existing catch/disposal.

Evidence: /tmp/mcp-extension-capability-types-red.log, /tmp/mcp-extension-capability-keys-red.log, /tmp/mcp-extension-outbound-admission-red.log, and /tmp/mcp-extension-capability-admission-green.log. Include the compile contract, maintained client closure, full protocol/OAuth gate, and broad consumer verification after this final spec finding.
