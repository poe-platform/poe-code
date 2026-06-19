---
$schema: https://poe-platform.github.io/poe-code/schemas/plans/plan.schema.json
kind: plan
version: 1
---

# Toolcraft Runtime Diagnostics

Make generated OpenAPI CLIs expose transport diagnostics through Toolcraft runtime controls instead of adding a repeated generated `verbose` parameter to every operation.

## 1. What we're building

Generated `toolcraft-openapi` command schemas should contain API inputs and command-specific output controls only. Transport diagnostics belong to Toolcraft's CLI/SDK/MCP runtime layer, so generated commands should receive a `diagnostics` logger from `HandlerContext` and pass it to the HTTP runtime.

The CLI should continue to render concise, actionable HTTP error summaries by default. FastAPI-style `{ "detail": "..." }` response bodies must be surfaced in that summary. Full redacted request/response details remain available through Toolcraft's verbose path.

## 2. User-facing behavior

Default HTTP failure output stays concise:

```text
Request:  POST https://example.com/api/bots/demo/actions/set-owner
Status:   403 Forbidden

Message:  bot creator_uid=123 is not in the allow-list for /api/internal_agent
Hint:     Check the configured API credentials and permissions.
Re-run with --verbose to see headers and full body.
```

Verbose is a Toolcraft global control:

```text
internal-agent -v bots set-owner demo --new-owner-handle target --yes
internal-agent bots set-owner demo --new-owner-handle target --verbose --yes
```

Generated leaf help lists `-v, --verbose` when the embedding CLI enables the verbose control. A real OpenAPI parameter named `verbose` remains a business parameter and is not treated as transport diagnostics unless the embedding CLI also enables Toolcraft's verbose control.

## 3. Implementation

- Remove the generated OpenAPI transport `verbose` parameter from `packages/toolcraft-openapi/src/generate.ts`.
- Keep the binary `output` transport parameter for binary response operations.
- Add Toolcraft runtime diagnostics types in `packages/toolcraft/src/runtime-logging.ts`.
- Add `diagnostics` to `HandlerContext`, SDK, MCP, and CLI command contexts.
- Add Toolcraft runtime options `logLevel` and `logger` for CLI, SDK, and MCP entry points.
- Normalize CLI `-v` to `--verbose` when the verbose control is enabled, so global `-v` works before command paths.
- Map the built-in verbose control to trace diagnostics for CLI command execution.
- Emit OpenAPI HTTP request-line diagnostics at `debug` and redacted successful transcripts at `trace`.
- Preserve default HTTP error summary rendering through `summarizeHttpError`.

## 4. Test Plan

- `packages/toolcraft-openapi/src/generate.test.ts`
  - Generated command files do not contain generated `verbose` params.
  - Generated request calls pass `diagnostics`, not `verbose: params.verbose`.
  - API-defined `verbose` parameters still generate as normal business params.

- `packages/toolcraft-openapi/src/runtime.test.ts`
  - `-v` works as a global verbose flag before generated command paths.
  - API-defined `verbose` query params remain business params.
  - Successful generated commands stay quiet by default.

- `packages/toolcraft-openapi/src/http.test.ts`
  - Diagnostic events are gated by log level.
  - Redacted successful transcripts emit at trace.
  - Failed responses still throw structured `HttpError` data.

- `packages/toolcraft/src/cli.test.ts`
  - Default HTTP errors show concise summaries and FastAPI-style details.
  - `--verbose` shows full redacted HTTP request/response details.
  - Generated/custom help surfaces the built-in verbose control.

- `packages/toolcraft/src/sdk-runtime-options.test.ts` and `packages/toolcraft/src/mcp-runtime-options.test.ts`
  - Runtime log options are accepted outside command params.
  - SDK and MCP command schemas do not gain log-level or verbose arguments.

## 5. Validation

- `npm run test --workspace toolcraft -- cli runtime-logging mcp-runtime-options sdk-runtime-options error-ux.contract api-error-summary`
- `npm run test --workspace toolcraft-openapi -- runtime http generate bearer-token-auth`
- `npm run lint:types`
- `npx eslint packages/toolcraft/src packages/toolcraft-openapi/src --ext ts`
- `npm run screenshot-poe-code -- --help`
