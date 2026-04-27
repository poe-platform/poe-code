---
$schema: https://poe-platform.github.io/poe-code/schemas/plans/superintendent.schema.json
kind: superintendent
version: 1

builder:
  prompt: |
    Build the highest-priority open task from {{plan.path}}. Follow the spec quotes already pasted into the task body — do not re-derive them; reuse the same field names verbatim.

inspectors:
  spec-fidelity:
    prompt: |
      Verify changes match MCP 2025-06-18+ for `outputSchema` on `Tool` and `structuredContent` on `CallToolResult`. Flag drift in field names, casing, optionality, or fallback semantics (when a tool declares `outputSchema`, the server must also include a JSON-stringified `content[]` text block so legacy clients still see the result).
  shape-coverage:
    prompt: |
      Inventory every MCP server in this repo (`tiny-stdio-mcp-server`, `tiny-http-mcp-server`, `toolcraft/mcp.ts`, `superintendent/mcp.ts`, `markdown-reader/mcp`, `memory/mcp.ts`, `terminal-pilot-mcp`, `terminal-png-mcp`, `terminal-png-mcp`, `tiny-stdio-mcp-test-server`, `tiny-http-mcp-oauth-test-server`). For each: does it declare `outputSchema`? Does it return `structuredContent`? List the specific tools still returning ad-hoc `JSON.stringify(...)` text and the lines.
  consumer-impact:
    prompt: |
      Find every consumer of these tools' outputs. For superintendent: `extractSignals` and signal/result parsing in `run-superintendent.ts`. For toolcraft callers: `mcp-proxy.ts` and any agent-side parser. Flag every site that does `JSON.parse(text)` against a tool result — those should switch to reading `structuredContent` directly once typed.
  test-coverage:
    prompt: |
      Verify tests cover: (a) `outputSchema` appears in `tools/list`; (b) `structuredContent` appears in `tools/call` results when declared; (c) legacy `content[]` text fallback still present alongside `structuredContent`; (d) handler return values that fail the declared output schema raise a `ToolError`. Per CLAUDE.md, no real LLM, no real fs — use `memfs` and the existing tiny-mcp-client transport doubles.

superintendent:
  prompt: |
    Review builder + inspectors, update the Task Board in {{plan.path}}, request owner review when every MCP server in the repo declares typed outputs and no `JSON.stringify(result)` ad-hoc text remains.

    Builder summary:
    {{builder.summary}}

    Inspector summaries:

    ## Spec fidelity
    {{inspectors.spec-fidelity}}

    ## Shape coverage
    {{inspectors.shape-coverage}}

    ## Consumer impact
    {{inspectors.consumer-impact}}

    ## Test coverage
    {{inspectors.test-coverage}}

owner:
  agent: claude-code
  prompt: |
    Decide whether MCP outputs across the repo are now typed end-to-end (server declares `outputSchema`, returns `structuredContent`, consumers read structured fields instead of parsing text) with no `JSON.stringify` mess remaining. Approve or send back with feedback.

    Superintendent summary:
    {{superintendent.summary}}

max_rounds: 50

status:
  state: in_progress
  round: 0
  review_turn: 0
---

# MCP typed outputs

Tighten MCP tool outputs across the repo so every tool declares an `outputSchema` and returns `structuredContent`, instead of stuffing ad-hoc JSON-stringified payloads into a text block.

## 1. Problem

Today, every MCP server in this repo emits unstructured text:

- [`tiny-stdio-mcp-server/src/server.ts`](../../packages/tiny-stdio-mcp-server/src/server.ts) defines `server.tool(name, description, inputSchema, handler)` — no output schema, no way to declare one. Handler return values flow through [`toContentBlocks`](../../packages/tiny-stdio-mcp-server/src/content/convert.ts) which `JSON.stringify`s objects into a `text` block.
- [`toolcraft/src/mcp.ts:540`](../../packages/toolcraft/src/mcp.ts) (`toToolContent`) does the same: `JSON.stringify(result)` into a text block. `defineCommand` has no `result:` schema field, so even when the handler return type is known at compile time it's never surfaced to the wire.
- [`superintendent/src/mcp.ts`](../../packages/superintendent/src/mcp.ts) is the worst offender: handlers literally call `JSON.stringify(result)` and return the raw string. The agent on the other end then `JSON.parse`s the text out of `content[0].text` — every signal/result handoff is text-shaped.
- [`markdown-reader/src/mcp/tools.ts`](../../packages/markdown-reader/src/mcp/tools.ts) returns a typed `ReadMarkdownResult`; toolcraft loses the type at the wire boundary.
- [`memory/src/mcp.ts`](../../packages/memory/src/mcp.ts), [`terminal-pilot-mcp`](../../packages/terminal-pilot-mcp/src/index.ts) (via toolcraft), and the test servers are all in the same shape.

The MCP spec (2025-06-18 onward; this repo's `tiny-stdio-mcp-server` already advertises `protocolVersion: "2025-11-25"`) introduced two fields specifically for this:

- `Tool.outputSchema?: JSONSchema` — advertised in `tools/list`.
- `CallToolResult.structuredContent?: object` — returned in `tools/call`. When `outputSchema` is declared, the server SHOULD also include a JSON-serialized backstop in `content[]` so legacy clients still receive the result.

We use neither. Yes, MCP has a typed output format. We just don't declare it anywhere.

### Evidence this is worth doing now

- The superintendent agent's `inspector_run` and `builder_run` tools are the hottest example: the agent has to `JSON.parse` the response every call, and a malformed payload is invisible until the parse throws downstream. Typed outputs collapse that to property access.
- `toolcraft-openapi` already has "Emit MCP `outputSchema` from the declared 2xx JSON response schema" listed as Open in [`docs/plans/archive/cmdkit-openapi.md:569`](../../docs/plans/archive/cmdkit-openapi.md). Generated commands have a JSON response schema available — it's just not flowing through.
- Adding it once in `tiny-stdio-mcp-server` + `toolcraft/mcp.ts` covers every server in the repo through the existing `defineCommand` / `server.tool` plumbing.

### Out of scope

- Renaming any existing tool, changing `inputSchema` shapes, or breaking client compatibility — the `content[]` text backstop stays so older clients keep working.
- Adding a new schema library. `tiny-stdio-mcp-server` already has `defineSchema` / `TypedSchema`; `toolcraft-schema` already drives `inputSchema`. Use them.
- Streamed / partial outputs. This is about typed final results.
- Changing the MCP protocol version constant or capability negotiation; `outputSchema` is purely additive in the version we already advertise.
- Migrating every external CLI consumer to read `structuredContent` instead of text. We migrate this repo's consumers (the superintendent agent, `tiny-mcp-client` parsing helpers, internal toolcraft callers) and leave third-party clients on the text fallback.

## 2. User-facing shape

### `tiny-stdio-mcp-server` — new optional output schema

`server.tool` gains an optional 5th parameter:

```ts
server.tool<TIn, TOut>(
  name: string,
  description: string,
  inputSchema: TypedSchema<TIn>,
  handler: ToolHandler<TIn, TOut>,
  outputSchema?: TypedSchema<TOut>
)
```

When `outputSchema` is supplied:

- `tools/list` for that tool includes `outputSchema: <jsonSchema>`.
- `tools/call` returns `{ content, structuredContent, isError? }` where `content` is the JSON.stringified backstop and `structuredContent` is the validated handler return value.
- Handler returns are validated against the schema before the response is sent. Failures raise a `ToolError` (internal error) — this is a server bug, not a client bug.

When `outputSchema` is omitted, behavior is identical to today: `content[]`, no `structuredContent`, no validation.

### `toolcraft` — `result:` schema on `defineCommand`

`defineCommand` gains an optional `result` field that takes a `toolcraft-schema` schema:

```ts
defineCommand({
  name: "read",
  description: "Read the table of contents and frontmatter of a markdown file.",
  params: readParams,
  result: S.Object({
    file: S.String(),
    frontmatter: S.Record(S.String(), S.Json()),
    sections: S.Array(S.Object({
      depth: S.Number(),
      number: S.String({ nullable: true }),
      title: S.String()
    }))
  }),
  scope: ["mcp"],
  handler: async ({ params }) => readMarkdown(params)
});
```

`runMCP` / `createMCPServer` reads `command.result`, runs `toJsonSchema()` on it, applies the same casing transform `inputSchema` already gets, and passes the result to `server.tool(..., outputSchema)`. Handlers that omit `result:` keep today's text-only behavior.

### `superintendent` — typed signal results

The three superintendent-tools handlers in [`mcp.ts`](../../packages/superintendent/src/mcp.ts) — `workflow_transition`, `builder_run`, `inspector_run` — declare `outputSchema`:

- `workflow_transition`: `{ recorded: { action: string } }`.
- `builder_run`: the existing `BuilderResult` shape (`summary`, `log_path`, …).
- `inspector_run`: the existing `InspectorResult` shape.

Handlers stop returning `JSON.stringify(result)` and return the typed object directly. [`run-superintendent.ts`](../../packages/superintendent/src/runtime/run-superintendent.ts) `extractSignals` reads `tool_call.result.structuredContent` first, falls back to parsing `content[0].text` only if `structuredContent` is absent (covers older recorded transcripts).

### Wire shape

```jsonc
// tools/list — one tool entry
{
  "name": "inspector_run",
  "description": "...",
  "inputSchema": { "type": "object", "properties": { "name": {...}, "prompt": {...} }, "required": ["name"] },
  "outputSchema": {
    "type": "object",
    "properties": {
      "name": { "type": "string" },
      "summary": { "type": "string" },
      "log_path": { "type": "string" }
    },
    "required": ["name", "summary", "log_path"]
  }
}

// tools/call — result
{
  "content": [
    { "type": "text", "text": "{\"name\":\"code-quality\",\"summary\":\"...\",\"log_path\":\"...\"}" }
  ],
  "structuredContent": {
    "name": "code-quality",
    "summary": "...",
    "log_path": "..."
  }
}
```

Both fields present so a legacy client reading `content[0].text` keeps working while a typed client reads `structuredContent`.

### What clients see today vs. after

| Today | After |
| --- | --- |
| `tools/list` advertises `inputSchema` only | adds `outputSchema` for declared tools |
| `tools/call` returns one text block, payload buried in `JSON.stringify` | returns `structuredContent` + the same JSON in `content[]` |
| Agent does `JSON.parse(result.content[0].text)` | reads `result.structuredContent` directly |
| Schema drift is silent until a downstream parser throws | server validates against `outputSchema`; mismatch surfaces as `ToolError` at the source |

## Task Board

- [ ] Audit every MCP server in the repo and produce a baseline. List per server: tools, current return shape (literal type or "text-only"), and whether the call site of each handler returns a typed object today. Pin the result in this doc as a "Baseline" subsection so progress is measurable.
- [ ] Extend `tiny-stdio-mcp-server`: add optional 5th `outputSchema` parameter to `server.tool`; thread it into `Tool` (advertise in `tools/list`); thread it into `tools/call` (validate handler return, set `structuredContent`, also emit text backstop in `content[]`). Update `types.ts` (`Tool`, `CallToolResult`, `ToolDefinition`, `ToolHandler<TIn, TOut>`).
- [ ] Add output-schema tests to `tiny-stdio-mcp-server`: (a) `tools/list` carries `outputSchema`; (b) `tools/call` carries `structuredContent`; (c) `content[]` text backstop matches; (d) handler return that violates the schema raises a `ToolError`; (e) tools without `outputSchema` keep today's text-only shape verbatim.
- [ ] Extend `toolcraft`: add optional `result:` field to `defineCommand` (typed via `AnySchema`/`ObjectSchema`); read it in `mcp.ts` `enumerateTools`; convert via `toJsonSchema` + `applySchemaCasing`; pass to `server.tool`. Replace `toToolContent` with a path that returns `{ content: <text backstop>, structuredContent: <validated value> }` when `result:` is declared.
- [ ] Add toolcraft tests: `defineCommand` with `result:` produces `outputSchema` in MCP `tools/list`; handler return is surfaced as `structuredContent`; missing `result:` keeps today's behavior.
- [ ] Migrate `superintendent/src/mcp.ts`: declare `outputSchema` on `workflow_transition`, `builder_run`, `inspector_run`; stop calling `JSON.stringify(result)` in the handlers; return the typed object. Move the schemas to `agentic-tools.ts` next to the input schemas.
- [ ] Update `superintendent/src/runtime/run-superintendent.ts` `extractSignals` (and any sibling parser) to read `structuredContent` first, fall back to `JSON.parse(content[0].text)` only if absent. Add a test that asserts both paths.
- [ ] Migrate `markdown-reader/src/mcp/tools.ts`: add `result:` to `read` and `read-section` (use the existing `ReadMarkdownResult` / `ReadSectionResult` types translated to `toolcraft-schema`).
- [ ] Migrate `memory/src/mcp.ts`: declare typed outputs for every tool. Reuse the same shapes already returned by `listPages`, `readPage`, `searchMemory`, `statusOf`, `appendToPage`.
- [ ] Migrate `terminal-pilot-mcp` (via `toolcraft`'s `result:`) and confirm `terminal-png-mcp` is OK as-is (it returns an `Image` content block, not structured data — leave alone, document why).
- [ ] Audit `tiny-stdio-mcp-test-server` and `tiny-http-mcp-oauth-test-server`: declare typed outputs where the test fixture has a known shape; explicitly opt out (with a one-line comment) where the test deliberately exercises the un-typed path.
- [ ] Verify `tiny-mcp-client` exposes `structuredContent` in its result type. Update internal consumers (toolcraft proxy, superintendent signal extractor) to read it. Add a regression test that fails when a tool result has `structuredContent: undefined` and the consumer silently falls back.
- [ ] Add a CI check (lint rule, scan script, or runtime guard) that fails the build when a `defineCommand({ scope: ["mcp"], … })` is missing `result:` and when a `server.tool(...)` call in repo code omits `outputSchema`. Without that check, the cleanup decays.
- [ ] Run the full test suite. Confirm no regressions and that `JSON.stringify(result)` no longer appears in any MCP handler in the repo (`grep` should return zero hits in `packages/*/src/**/*.ts` outside of test backstop fixtures).
- [ ] Re-run `shape-coverage` inspector to confirm zero remaining un-typed MCP tool surfaces. Then request owner review.
