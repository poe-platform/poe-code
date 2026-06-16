# @poe-code/poe-acp-client

Client-side helpers for Agent Client Protocol sessions.

This package contains the JSON-RPC transport, ACP client, session-update
parsers, stream helpers, and run-report utilities used by agent integrations.

## Usage

```ts
import { AcpClient, AcpTransport, parseSessionUpdate } from "@poe-code/poe-acp-client";

const update = parseSessionUpdate({
  sessionUpdate: "agent_message_chunk",
  content: { type: "text", text: "done" }
});
```

## Public API

- `AcpClient`: high-level ACP client.
- `AcpTransport`: process or injected transport wrapper.
- `JsonRpcMessageLayer`: request/response/notification message layer.
- JSON-RPC helpers: `parseJsonRpcMessage`, `serializeJsonRpcMessage`, and `createJsonRpcErrorResponse`.
- Session-update helpers: `parseSessionUpdate` and `formatSessionUpdate`.
- Stream helpers for messages, usage, tool-call summaries, and legacy event mapping.
- Run-report helpers: `generateRunReportFromSessionUpdateStream`, `formatRunReportSummary`, and `saveRunReport`.
- ACP protocol types and error-code helpers.

## Config Options

This package does not load a config file. Runtime behavior is controlled by
constructor and function options such as transport process options, injected
transport hooks, request handlers, filesystem handlers, terminal handlers, and
run-report save options.

## Environment Variables

This package does not read or expose environment variables.
