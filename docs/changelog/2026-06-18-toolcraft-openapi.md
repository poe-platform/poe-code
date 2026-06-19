# 2026-06-18 Toolcraft OpenAPI Generation Updates

This entry summarizes the commits that landed on `main` during the 24-hour window ending 2026-06-19 00:45 UTC.

## Generated OpenAPI clients

- `toolcraft-openapi-generate` now writes a project-local skill at `.claude/skills/<skill-name>/SKILL.md`. The skill summarizes the generated CLI and MCP tools, includes quick-start commands, and infers the CLI binary name from `package.json` when possible.
- Generated clients expose a complete `src/generated/client.ts` entrypoint through `defineGeneratedClient(...)`, so consumers can configure auth/base URL once and use the full generated command tree without manually wiring every group.
- Generated operation files no longer stamp the spec SHA in their headers. Spec digest drift is tracked by `openapi.lock`, so metadata-only spec updates can update the lock without rewriting unchanged operation source.
- Generated command tuples are copied before CLI assembly, which keeps the generated CLI from mutating the shared command list used by other surfaces.

## Toolcraft CLI behavior

- Generated OpenAPI commands no longer include the old `dryRun` transport parameter; the QA help output now documents `--verbose` without advertising a dry-run mode for generated API calls.
- Toolcraft CLI help can render a machine-readable JSON help document when `controls.output` enables `--output json`, including group/command metadata, options, positionals, secrets, and examples. Unknown help targets now fail with suggestions and a pointer to the nearest valid help command.
- HTTP-style CLI failures now summarize common API error fields such as code, message, request id, retry-after, hint, and field errors before falling back to a response-body snippet. Use `--verbose` or `--debug` for full redacted request/response details.
- Startup and command-definition `UserError`s are classified separately from runtime user errors, so generated command definition bugs are reported as definition failures rather than argument mistakes.

## MCP server errors

- `tiny-stdio-mcp-server` `ToolError` now accepts optional structured `data` and forwards it in the JSON-RPC error response.
