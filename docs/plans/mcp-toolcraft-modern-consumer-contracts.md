# Modern Toolcraft consumer result contracts

The modern client defaults to MCP 2026 discovery. Successful tool results include `resultType: complete` and server identity metadata. Existing runtime, approval and proxy assertions expected legacy exact shapes and failed despite preserving content and behavior.

Update exact result expectations to include modern fields, preserving exact content checks. Direct upstream proxy calls identify the upstream server; calls through the Toolcraft MCP server identify Toolcraft. Retain existing legacy session tests for compatibility.

Focused runtime, core Toolcraft and approval tests pass after updating nine assertions. Proxy tests additionally cover cached calls, reconnects, rename maps and the upstream versus wrapper identity distinction.
