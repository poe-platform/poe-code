# Pipeline MCP Frontmatter

Add `mcp` as a top-level key in pipeline plan YAML files, using the same `Record<string, { command, args?, env? }>` shape as spawn's `McpSpawnConfig`. The value is passed through to each `runAgent` call as `mcpServers`.

## Scope

- `packages/pipeline/src/types.ts` — add `McpSpawnServer`, `McpSpawnConfig`, add `mcp?` to `PipelinePlan`, add `mcpServers?` to `AgentRunInput`
- `packages/pipeline/src/plan/parser.ts` — parse and validate the top-level `mcp` field
- `packages/pipeline/src/run/pipeline.ts` — pass `plan.mcp` as `mcpServers` in the `runAgent` call
- `src/sdk/pipeline.ts` — forward `input.mcpServers` to `sdkSpawn`
- `packages/pipeline/src/plan/parser.test.ts` — test parsing with and without `mcp`

## Plan YAML shape

```yaml
mcp:
  my-server:
    command: npx
    args: [my-server]
    env:
      FOO: bar

tasks:
  - id: do-thing
    title: Do a thing
    prompt: |
      Do a thing
    status: open
```

## Types to add (inline, no new dependency)

```ts
export interface McpSpawnServer {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export type McpSpawnConfig = Record<string, McpSpawnServer>;
```

Add `mcp?: McpSpawnConfig` to `PipelinePlan`.
Add `mcpServers?: McpSpawnConfig` to `AgentRunInput`.

## Parsing

`parsePlan` already reads `document.tasks`. It should now also read `document.mcp`:
- If absent: `mcp` is `undefined` (omitted from returned plan)
- If present: validate it is a record of objects each having a non-empty `command` string; `args` (optional string array), `env` (optional string record). Throw a clear error on invalid shape.

Return `{ tasks, ...(mcp ? { mcp } : {}) }`.

## Pipeline runner

In `pipeline.ts`, when calling `runAgent`, spread `mcpServers` if present:

```ts
result = await runAgent({
  agent,
  prompt,
  mode,
  cwd: options.cwd,
  logDir: options.logDir,
  ...(model ? { model } : {}),
  ...(plan.mcp ? { mcpServers: plan.mcp } : {}),
  ...(options.signal ? { signal: options.signal } : {})
});
```

## SDK wiring

In `src/sdk/pipeline.ts`, forward `mcpServers` to `sdkSpawn`:

```ts
const { events, result } = sdkSpawn(input.agent, {
  prompt: input.prompt,
  cwd: input.cwd,
  logDir: input.logDir,
  model: input.model,
  mode: input.mode,
  ...(input.mcpServers ? { mcpServers: input.mcpServers } : {})
});
```

## Tests

In `parser.test.ts`:
- Parse plan with no `mcp` field → `plan.mcp` is `undefined`
- Parse plan with valid `mcp` block → `plan.mcp` equals expected record
- Parse plan with invalid `mcp` (non-object value) → throws
- Parse plan with invalid server entry (missing `command`) → throws
