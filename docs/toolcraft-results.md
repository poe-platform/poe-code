# Toolcraft command results

## Ordinary values

Return domain values directly from a command handler. The SDK returns the value unchanged. CLI JSON output preserves object fields, and custom rich, Markdown, and JSON renderers receive the actual handler return value, matching `Renderers<TResult>`.

Fields named `content`, `structuredContent`, `_meta`, or `isError` do not implicitly turn a domain object into an MCP response. For example, `{ content: [], isError: true }` is ordinary data, not a failed tool call.

## Explicit MCP interoperability

When a handler deliberately returns an MCP `CallToolResult`, mark it explicitly. Given a connected MCP `client`:

```ts
import { asMCPResult, defineCommand, S } from "toolcraft";

const command = defineCommand({
  name: "upstream",
  params: S.Object({}),
  handler: async () => asMCPResult(await client.callTool({ name: "upstream", arguments: {} }))
});
```

`asMCPResult` requires a `content` array. It returns a shallow copy with a non-enumerable marker; it does not mutate the source, clone its nested payloads, or add a JSON field. JSON serialization and object spreading do not carry this marker. Apply the helper again when deliberately accepting a serialized protocol envelope.

MCP proxy groups mark envelopes automatically. Successful proxies with an upstream `outputSchema` continue to return the structured domain payload directly; untyped successes and protocol errors retain their envelopes.

Automatic CLI rendering extracts a marked envelope's `structuredContent`, or joins its text blocks when structured content is absent. A structured object containing only `result` retains the single-value wrapper convention; sibling fields prevent that unwrapping. Marked errors print to stderr and set exit status 1. An empty error uses a failure message, not `Done.`.

Custom CLI renderers receive the actual marked envelope, not its extracted payload. Access `result.structuredContent` explicitly if that is the desired custom presentation. Error envelopes use the automatic error renderer instead of success callbacks.

## SDK and MCP failures

For a command declaring a successful result schema, a marked protocol error rejects the SDK call with `UserError`. Its message comes from upstream text, structured diagnostics, or a generic failure fallback. The original marked envelope is available as `error.cause`.

An untyped proxy SDK call retains its existing envelope-returning contract. Inspect `isError` on that result; it does not reject solely because the upstream returned a protocol error.

Re-exposed MCP tools forward marked errors without applying a successful result schema or `mcpResult` transform. Untyped marked successes are also forwarded as protocol envelopes. Typed marked successes still validate and serialize their structured content according to the output schema and configured casing. An explicit `mcpResult` transform receives the actual handler value. Envelope metadata and content are retained; the MCP server can supply JSON text when a typed successful envelope has empty content.

## Migration from implicit shape detection

Direct integrations that previously relied on a raw envelope-shaped object being automatically unwrapped should use `asMCPResult`. Ordinary domain handlers require no changes. Custom renderers for direct MCP integrations should consume the full envelope rather than expecting an automatically extracted payload. Configured proxy groups need no opt-in change.

## MCP proxy connection lifetime

`runCLI` closes its resolved root's MCP proxy connections before returning, including after tool failures. A close failure sets exit status 1 and prints a cleanup diagnostic to stderr without replacing an earlier result or error. If proxy resolution itself fails, the CLI leaves previously established connections alone.

SDK and MCP server integrations retain hot connections across calls. When the owner finishes using a root, explicitly dispose its proxy connections:

```ts
import { disposeMcpProxies, resolveMcpProxies } from "toolcraft/mcp-proxy";
import { createSDK } from "toolcraft/sdk";

await resolveMcpProxies(root);
const sdk = createSDK(root);
try {
  await sdk.upstream.echo({ message: "hello" });
} finally {
  await disposeMcpProxies(root);
}
```

The example assumes an `upstream.echo` proxy command on `root`. Disposal visits only that root's proxy groups, does not open unused clients, and waits for every close attempt. Multiple close failures are retained in an `AggregateError`. Concurrent disposal calls share each connection's pending close. Later calls can reconnect; disposal does not permanently disable commands.

Finish active calls before disposing. Disposal waits for pending connection establishment; it is not cancellation or a request-draining API. Use separate root instances for independently owned CLI, SDK, or MCP lifetimes. Sharing the same mutable root also shares its proxy connections; a CLI run or explicit disposal can close them for other users of that root.
