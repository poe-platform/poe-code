---
$schema: https://poe-platform.github.io/poe-code/schemas/plans/plan.schema.json
kind: plan
version: 1
---

# tiny-mcp-server spec compliance

## Scope

Extend the existing shared core in `packages/tiny-stdio-mcp-server` so both stdio and `packages/tiny-http-mcp-server` implement the stable MCP `2025-11-25` server surface for tools, prompts, and resources. Keep optional utilities unadvertised unless implemented end-to-end.

## Protocol coverage matrix

| Area | Required behavior covered | Proof |
| --- | --- | --- |
| Lifecycle | `initialize`, capability negotiation, `notifications/initialized`, `ping`, initialized-only operation | Existing core tests plus official SDK connections |
| Tools | `tools/list`, `tools/call`, tool list-changed notification, typed argument validation/content | Existing tool suites remain green |
| Prompts | Capability declaration, `prompts/list`, `prompts/get`, list-changed notification, invalid name/arguments | New core tests and HTTP SDK interoperability tests |
| Resources | Capability declaration, `resources/list`, `resources/read`, `resources/templates/list`, subscriptions, list-changed and updated notifications | New core tests and HTTP SDK interoperability tests |
| stdio transport | UTF-8 newline JSON-RPC framing and notification delivery | Existing stream tests plus new in-memory SDK flow |
| Streamable HTTP | Same feature API over POST/GET sessions and official SDK client | New HTTP SDK tests; existing raw transport conformance remains green |
| Optional utilities | Do not advertise completion or logging without supported APIs | Initialization assertion |

## Implementation steps

1. Add resource and prompt public types plus registration handlers to the stdio core.
2. Advertise supported APIs and only the notification/subscription features available on the selected transport mode.
3. Implement prompt/resource requests, resource template lookup, subscriptions, and notifications.
4. Re-export the shared feature types through the HTTP package without transport duplication.
5. Add official SDK tests over in-memory stdio and Streamable HTTP transports.
6. Run package builds, unit suites, and relevant end-to-end validation; audit advertised capabilities against tested behavior.

## Deliberate non-features

- `completion/complete` and `logging/setLevel` are optional MCP capabilities and remain absent from `initialize.capabilities` until supported with their own APIs and coverage.
- Client-originated sampling, elicitation, roots, and tasks are not server feature declarations for this library request and are not exposed by the server.
