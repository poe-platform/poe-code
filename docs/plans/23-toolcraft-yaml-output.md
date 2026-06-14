---
$schema: https://poe-platform.github.io/poe-code/schemas/plans/plan.schema.json
kind: plan
version: 1
---

# Toolcraft YAML output

YAML as the default rendering for parsed JSON values in toolcraft, on top of the typed-MCP work already in flight.

## 1. What we're building

Three coupled changes:

1. **MCP return values** — every toolcraft-fronted MCP tool declares `outputSchema` and returns `structuredContent`. This extends [`docs/plans/09-mcp-typed-outputs.md`](09-mcp-typed-outputs.md) (owner review); this plan does **not** re-spec that work, it consumes it.

2. **Toolcraft respects typed results end to end** — `defineCommand` gains a `result:` schema (per the typed-outputs plan), and toolcraft's MCP runner propagates it to `Tool.outputSchema` + `CallToolResult.structuredContent`. The `result:` value also becomes the source of truth for CLI rendering.

3. **YAML for parsed JSON, by default** — toolcraft's CLI auto-renderer and the MCP text content backstop emit YAML for object/array results instead of single-line `JSON.stringify`. YAML is added as a first-class `--output yaml` mode alongside `rich | md | json`. `rich` keeps tables for flat objects and arrays-of-objects; YAML replaces the `JSON.stringify` fallback for non-tabular structured data.

### Non-goals

- Re-specifying typed MCP outputs (owned by `09-mcp-typed-outputs.md`).
- Changing or removing `rich` tables for flat objects / arrays-of-objects.
- Touching `design-system`, including its existing YAML frontmatter parser.
- Migrating third-party MCP clients beyond keeping the text backstop populated.
- Adding a new YAML library — uses the `yaml@^2.8.2` already installed at the repo root; adds it to `packages/toolcraft/package.json` as a direct dep.
- Streaming or partial outputs.

## 2. User-facing shape

_To be drafted next._

## 3. Implementation details and technical decisions

_To be drafted._

## 4. Interfaces and test plan

_To be drafted._

## 5. Code plan

_To be drafted._
