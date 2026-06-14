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
      Verify changes match MCP 2025-06-18+ / 2025-11-25 for `outputSchema` on `Tool` and `structuredContent` on `CallToolResult`. Flag drift in field names, casing, optionality, or fallback semantics. `outputSchema` must be root `type: "object"`; when a tool returns `structuredContent`, the server should also include a JSON-stringified `content[]` text block so legacy clients still see the result.
  shape-coverage:
    prompt: |
      Inventory every MCP server in this repo (`tiny-stdio-mcp-server`, `tiny-http-mcp-server`, `toolcraft/mcp.ts`, `superintendent/mcp.ts`, `markdown-reader/mcp`, `memory/mcp.ts`, `terminal-pilot-mcp`, `terminal-png-mcp`, `tiny-stdio-mcp-test-server`, `tiny-http-mcp-oauth-test-server`). For each structured-data tool: does it declare `outputSchema`? Does it return `structuredContent`? List the specific tools still returning ad-hoc `JSON.stringify(...)` text and the lines. Content-block tools should have an explicit opt-out note.
  consumer-impact:
    prompt: |
      Find every consumer of these tools' outputs. For superintendent: `extractSignals` and signal/result parsing in `run-superintendent.ts`. For toolcraft callers: `mcp-proxy.ts` and any agent-side parser. Flag every site that does `JSON.parse(text)` against a tool result — those should switch to reading `structuredContent` directly once typed.
  test-coverage:
    prompt: |
      Verify tests cover: (a) `outputSchema` appears in `tools/list`; (b) `structuredContent` appears in `tools/call` results when declared; (c) legacy `content[]` text fallback still present alongside `structuredContent`; (d) handler return values that fail the declared output schema raise an internal `ToolError` / JSON-RPC internal error, not a tool execution `isError` result. Per CLAUDE.md, no real LLM, no real fs — use `memfs` and the existing tiny-mcp-client transport doubles.

superintendent:
  prompt: |
    Review builder + inspectors, update the Task Board in {{plan.path}}, request owner review when every structured-data MCP tool in the repo declares typed outputs and no `JSON.stringify(result)` ad-hoc text remains. Content-block tools may explicitly opt out.

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
    Decide whether structured-data MCP outputs across the repo are now typed end-to-end (server declares root-object `outputSchema`, returns object `structuredContent`, consumers read structured fields instead of parsing text) with no `JSON.stringify` mess remaining. Approve or send back with feedback.

    Superintendent summary:
    {{superintendent.summary}}

max_rounds: 50

status:
  state: in_progress
  round: 0
  review_turn: 0
---

# MCP typed outputs

Tighten structured-data MCP tool outputs across the repo so they declare root-object `outputSchema` and return object `structuredContent`, instead of stuffing ad-hoc JSON-stringified payloads into a text block. Tools whose real output is text, image, audio, resource links, or embedded resources remain content-block tools with an explicit opt-out.

## 1. Problem

Today, structured-data tools in this repo emit unstructured text:

- [`tiny-stdio-mcp-server/src/server.ts`](../../packages/tiny-stdio-mcp-server/src/server.ts) defines `server.tool(name, description, inputSchema, handler)` — no output schema, no way to declare one. Handler return values flow through [`toContentBlocks`](../../packages/tiny-stdio-mcp-server/src/content/convert.ts) which `JSON.stringify`s objects into a `text` block.
- [`toolcraft/src/mcp.ts:540`](../../packages/toolcraft/src/mcp.ts) (`toToolContent`) does the same: `JSON.stringify(result)` into a text block. `defineCommand` has no `result:` schema field, so even when the handler return type is known at compile time it's never surfaced to the wire.
- [`superintendent/src/mcp.ts`](../../packages/superintendent/src/mcp.ts) is the worst offender: handlers literally call `JSON.stringify(result)` and return the raw string. The agent on the other end then `JSON.parse`s the text out of `content[0].text` — every signal/result handoff is text-shaped.
- [`markdown-reader/src/mcp/tools.ts`](../../packages/markdown-reader/src/mcp/tools.ts) returns a typed `ReadMarkdownResult`; toolcraft loses the type at the wire boundary.
- [`memory/src/mcp.ts`](../../packages/memory/src/mcp.ts), [`terminal-pilot-mcp`](../../packages/terminal-pilot-mcp/src/index.ts) (via toolcraft), and the test servers are all in the same shape.

The MCP spec (2025-06-18 onward; this repo's `tiny-stdio-mcp-server` already advertises `protocolVersion: "2025-11-25"`) has two fields specifically for this:

- `Tool.outputSchema?: JSONSchema` — advertised in `tools/list`. MCP currently restricts the root schema to `type: "object"`; nested properties may still be arrays, strings, numbers, booleans, enums, nullable values, and records according to the schema subset we support.
- `CallToolResult.structuredContent?: object` — returned in `tools/call`. When `outputSchema` is declared, the server MUST return structured content conforming to that schema. When a tool returns structured content, the server SHOULD also include a JSON-serialized backstop in `content[]` so legacy clients still receive the result.

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

## Baseline

Implemented baseline for this pass:

- `tiny-stdio-mcp-server`: supports typed structured-data tools. `server.tool(..., outputSchema)` and `registerTool({ outputSchema }, handler)` advertise `outputSchema`, validate typed handler returns, return `structuredContent`, and keep the JSON text fallback. Untyped/content-block tools keep legacy `content[]` behavior.
- `tiny-http-mcp-server`: mirrors the stdio `tool` signature and forwards the optional output schema into the wrapped stdio server. HTTP parity is covered in the streamable HTTP conformance suite.
- `toolcraft`: `defineCommand({ result })` is available for MCP output schemas. MCP result schemas and structured results are transformed with the same configured casing as inputs. Commands without `result` remain content-only.
- `toolcraft/mcp-proxy`: proxied tools that advertise `outputSchema` are exposed as typed toolcraft commands and read `structuredContent`; untyped upstream tools continue returning content blocks.
- `superintendent`: `workflow_transition`, `builder_run`, and `inspector_run` declare output schemas and return typed objects. Runtime transcript parsing reads typed `result.structuredContent` first and falls back to legacy arguments/text transcripts.
- `markdown-reader`: `read` and `read-section` declare `result` schemas.
- `memory`: `list_pages`, `read_page`, `search_memory`, `status`, and `append_to_page` declare output schemas.
- `terminal-pilot-mcp`: all MCP-exposed terminal-pilot commands are wrapped with result schemas. Void terminal actions return `{}` over MCP while CLI command handlers remain unchanged. `terminal-png-mcp` remains a content-block server because it returns image content.
- Test fixtures: `tiny-http-mcp-server`'s `get_user` fixture is typed; legacy array/text fixtures have explicit opt-out comments. `tiny-stdio-mcp-test-server` remains text-only with explicit opt-out comments for prose/string tools.
- Guard: `tests/integration/mcp-typed-outputs.test.ts` parses the migrated MCP source files with the TypeScript AST and fails if known structured `defineCommand`/`server.tool` registrations lose `result`/`outputSchema` wiring.
- Second-pass hardening: `tiny-stdio-mcp-server` now rejects unsupported output-schema containers such as tuple `items`, malformed `properties`, unsupported composition keywords, and malformed `oneOf` at registration time. Typed handler signatures no longer accept arbitrary legacy `ToolReturn` values once an output type is declared.
- Second-pass hardening: `toolcraft` now applies MCP casing through nested `oneOf` branches and schema-valued `additionalProperties`, serializes TypeScript-shaped `oneOf`/`union` result values into MCP wire casing before validation, and `mcp-proxy` rejects typed upstream tools that omit `structuredContent`.
- Second-pass hardening: `memory.search_memory` now exposes snake_case MCP output fields (`rel_path`, `line_number`) instead of leaking the internal camelCase `SearchHit` shape.
- End-to-end workflow coverage: `tests/integration/mcp-typed-outputs-workflow.test.ts` spawns real stdio MCP server processes from built package entrypoints and drives them through `tiny-mcp-client`. It verifies typed `tools/list`, successful `tools/call` `structuredContent`, JSON fallback text, malformed result envelopes, invalid typed output schema failures, nested `toolcraft` result casing, and invalid `toolcraft` handler result failures over the actual client/server boundary.

### Non-negotiables

- Do not break existing MCP clients. This is an additive wire change: typed tools return `structuredContent` and still return the JSON text backstop in `content[]`.
- Do not depart from MCP field names or shapes. Use `outputSchema` on `Tool` entries and `structuredContent` on `CallToolResult`; do not invent repo-local aliases.
- Keep declared output schemas spec-shaped: root `type: "object"` only. Use object wrappers for scalar or list results (for example `{ items: [...] }`) instead of declaring root arrays or primitives.
- Do not remove support for content-block tools. Tools whose real result is an image, audio, resource, or human-readable text may explicitly opt out of `outputSchema`; the opt-out must be visible to the cleanup check.
- Do not hide schema drift downstream. If a tool declares `outputSchema`, validate the handler result before responding and surface mismatches as an internal `ToolError` / JSON-RPC internal error. This is a server implementation bug, not a tool execution error for the model to recover from.

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
- `tools/call` returns `{ content, structuredContent, isError? }` where `content` is the JSON-stringified backstop and `structuredContent` is the validated handler return value.
- The `outputSchema` root is always `type: "object"` and the handler's wire result must be a JSON object. If a natural result is a list or scalar, wrap it in an object before exposing it over MCP.
- Handler returns are validated against the schema before the response is sent. Failures raise a `ToolError` with JSON-RPC internal error semantics — this is a server bug, not a client bug or a tool execution failure.

When `outputSchema` is omitted, behavior is identical to today: `content[]`, no `structuredContent`, no validation.

Validation uses the existing schema types; do not add a new schema library. Implement one shared validator for the JSON Schema subset already emitted by `defineSchema` / `toolcraft-schema`: root object schemas, plus nested object, array, string, number/integer, boolean, enum, nullable, optional/required fields, records/additionalProperties, and nested schemas. Unsupported schema features and non-object root output schemas must fail loudly at registration time, not silently skip validation.

### `tiny-http-mcp-server` — HTTP parity

`HttpServer.tool` mirrors the same optional output schema parameter and forwards it into the wrapped `tiny-stdio-mcp-server` registration:

```ts
httpServer.tool<TIn, TOut>(
  name: string,
  description: string,
  inputSchema: TypedSchema<TIn>,
  handler: HttpToolHandler<TIn, TOut>,
  outputSchema?: TypedSchema<TOut>
)
```

HTTP behavior must match stdio behavior exactly: `tools/list` advertises `outputSchema`, `tools/call` returns `structuredContent` plus the JSON text backstop, and invalid handler results become internal `ToolError`s.

`tiny-http-mcp-server` must not reimplement typed-output serialization or validation. It only mirrors the public `tool(...)` signature and forwards `outputSchema` to the underlying `tiny-stdio-mcp-server` registration so stdio and HTTP stay behaviorally identical.

### `toolcraft` — `result:` schema on `defineCommand`

`defineCommand` gains an optional `result` field that takes a root-object `toolcraft-schema` schema:

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

`runMCP` / `createMCPServer` reads `command.result`, runs `toJsonSchema()` on it, rejects non-object root schemas, applies the same casing transform `inputSchema` already gets, and passes the result to `server.tool(..., outputSchema)`. Handlers that omit `result:` keep today's text-only behavior until the cleanup migration reaches them.

Result casing must be explicit and tested. If MCP casing transforms result schemas to snake_case, the returned `structuredContent` and fallback JSON text must be transformed to the same wire casing before validation. Native handler results stay in TypeScript shape inside the handler; only the MCP wire result is transformed.

Toolcraft must preserve MCP content-block behavior. A command whose handler returns a content block and has no `result:` remains content-only. A command with `result:` returns object `structuredContent` and a single JSON text backstop; it does not wrap that typed result in an extra `content` object.

### `superintendent` — typed signal results

The three superintendent-tools handlers in [`mcp.ts`](../../packages/superintendent/src/mcp.ts) — `workflow_transition`, `builder_run`, `inspector_run` — declare `outputSchema`:

- `workflow_transition`: `{ recorded: { action: string } }`.
- `builder_run`: the existing `BuilderResult` shape (`summary`, `log_path`, …).
- `inspector_run`: the existing `InspectorResult` shape.

Handlers stop returning `JSON.stringify(result)` and return the typed object directly. [`run-superintendent.ts`](../../packages/superintendent/src/runtime/run-superintendent.ts) `extractSignals` and [`run-owner-review.ts`](../../packages/superintendent/src/runtime/run-owner-review.ts) read `tool_call.result.structuredContent` first, falling back to parsing `content[0].text` only if `structuredContent` is absent (covers older recorded transcripts).

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

Both fields are present because MCP recommends serialized JSON in `content[]` as a backwards-compatible text fallback while typed clients read `structuredContent`.

### What clients see today vs. after

| Today | After |
| --- | --- |
| `tools/list` advertises `inputSchema` only | adds `outputSchema` for declared tools |
| `tools/call` returns one text block, payload buried in `JSON.stringify` | returns `structuredContent` + the same JSON in `content[]` |
| Agent does `JSON.parse(result.content[0].text)` | reads `result.structuredContent` directly |
| Schema drift is silent until a downstream parser throws | server validates against `outputSchema`; mismatch surfaces as `ToolError` at the source |

## Task Board

- [x] Audit every MCP server in the repo and produce a baseline. List per server: tools, current return shape (structured-data, content-block, or "text-only"), whether the call site of each handler returns a typed object today, and whether content-block tools have an explicit typed-output opt-out. Pin the result in this doc as a "Baseline" subsection so progress is measurable.
- [x] Extend `tiny-stdio-mcp-server`: add optional 5th `outputSchema` parameter to `server.tool`; thread it into `Tool` (advertise in `tools/list`); thread it into `tools/call` (validate handler return, set `structuredContent`, also emit text backstop in `content[]`). Update `types.ts` (`Tool`, `CallToolResult`, `ToolDefinition`, `ToolHandler<TIn, TOut>`).
- [x] Add one shared output validator in `tiny-stdio-mcp-server` for the supported schema subset (root object schemas, plus nested object, array, string, number/integer, boolean, enum, nullable, optional/required fields, records/additionalProperties, nested schemas). Unsupported schema features and non-object root output schemas fail at registration time; invalid handler values raise an internal `ToolError`.
- [x] Add output-schema tests to `tiny-stdio-mcp-server`: (a) `tools/list` carries `outputSchema`; (b) `tools/call` carries `structuredContent`; (c) `content[]` text backstop matches; (d) handler return that violates the schema raises a `ToolError` / JSON-RPC internal error, not `isError`; (e) tools without `outputSchema` keep today's text-only shape verbatim; (f) nested arrays/objects and additionalProperties are validated.
- [x] Extend `tiny-http-mcp-server`: mirror the optional `outputSchema` parameter on `HttpServer.tool`, forward it through the wrapper, and add an HTTP-level test proving parity with stdio for `tools/list`, `structuredContent`, fallback text, and invalid output handling. Do not duplicate serialization or validation logic in HTTP.
- [x] Extend `toolcraft`: add optional root-object `result:` field to `defineCommand` (typed via `ObjectSchema` or an equivalent object-only schema type); read it in `mcp.ts` `enumerateTools`; convert via `toJsonSchema` + `applySchemaCasing`; pass to `server.tool`. Replace `toToolContent` with a path that returns `{ content: <text backstop>, structuredContent: <validated object> }` when `result:` is declared.
- [x] Add toolcraft tests: `defineCommand` with `result:` produces `outputSchema` in MCP `tools/list`; handler return is surfaced as `structuredContent`; missing `result:` keeps today's behavior; `casing: "snake"` transforms both `outputSchema` and `structuredContent`/fallback JSON consistently.
- [x] Migrate `superintendent/src/mcp.ts`: declare `outputSchema` on `workflow_transition`, `builder_run`, `inspector_run`; stop calling `JSON.stringify(result)` in the handlers; return the typed object. Move the schemas to `agentic-tools.ts` next to the input schemas.
- [x] Update `superintendent/src/runtime/run-superintendent.ts` `extractSignals` and `superintendent/src/runtime/run-owner-review.ts` to read `structuredContent` first, fall back to `JSON.parse(content[0].text)` only if absent. Add tests that assert both paths.
- [x] Migrate `markdown-reader/src/mcp/tools.ts`: add `result:` to `read` and `read-section` (use the existing `ReadMarkdownResult` / `ReadSectionResult` types translated to `toolcraft-schema`).
- [x] Migrate `memory/src/mcp.ts`: declare typed outputs for every tool. Reuse the same shapes already returned by `listPages`, `readPage`, `searchMemory`, `statusOf`, `appendToPage`.
- [x] Migrate `terminal-pilot-mcp` (via `toolcraft`'s `result:`) and confirm `terminal-png-mcp` is OK as-is (it returns an `Image` content block, not structured data — leave alone, document why).
- [x] Audit `tiny-stdio-mcp-test-server` and `tiny-http-mcp-oauth-test-server`: declare typed outputs where the test fixture has a known shape; explicitly opt out (with a one-line comment) where the test deliberately exercises the un-typed path.
- [x] Verify `tiny-mcp-client` exposes `Tool.outputSchema` and `CallToolResult.structuredContent` in its public result types. Update internal consumers (toolcraft proxy, superintendent signal extractor) to read it. Add a regression test that fails when a typed tool result has `structuredContent: undefined` and the consumer silently falls back.
- [x] Add a cleanup check (lint rule, scan script, or runtime guard) that fails the build when a `defineCommand({ scope: ["mcp"], … })` is missing `result:` or an in-repo `server.tool(...)` call omits `outputSchema`, unless the call has an explicit typed-output opt-out for content-block or deliberately untyped fixture behavior. Without that check, the cleanup decays.
- [x] Run the full test suite. Confirm no regressions and that `JSON.stringify(result)` no longer appears in any MCP handler in the repo (`grep` should return zero hits in `packages/*/src/**/*.ts` outside of test backstop fixtures). Verified with `npm test` (744 files / 12,708 tests) and source grep; remaining stringification is scoped to explicit legacy/content text backstops.
- [x] Re-run `shape-coverage` inspector to confirm zero remaining un-typed structured-data MCP tool surfaces and explicit opt-outs for content-block tools. Then request owner review. Re-audited after docs/export pass; structured-data MCP surfaces are typed, content-block tools retain explicit opt-outs, and this plan remains in owner-review pending state until owner approval.
