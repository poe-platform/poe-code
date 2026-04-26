---
$schema: https://poe-platform.github.io/poe-code/schemas/plans/pipeline.schema.json
kind: pipeline
version: 1

tasks:
  - id: schema-kinds-oneof-union-record-json
    title: Add OneOf, Union, Record, Json schema kinds to toolcraft-schema
    prompt: |
      Extend the `toolcraft-schema` package with four new schema kinds. Existing
      kinds live in `packages/toolcraft-schema/src/` (object, string, number,
      boolean, array, enum, optional). Match their pattern: one file per kind
      plus a sibling `*.compile-check.ts` for type-level smoke tests.

      Add:

      1. `oneof.ts` — discriminated union.
         ```ts
         export interface OneOfSchema<TBranches extends Record<string, ObjectSchema<any>>> {
           kind: "oneOf";
           discriminator: string;
           branches: TBranches;
         }
         export function OneOf<TBranches extends Record<string, ObjectSchema<any>>>(
           config: { discriminator: string; branches: TBranches }
         ): OneOfSchema<TBranches>;
         ```
         Branch chosen by a literal-string discriminator field.

      2. `union.ts` — auto-discriminated union.
         ```ts
         export interface UnionSchema<TBranches extends ObjectSchema<any>[]> {
           kind: "union";
           branches: TBranches;
         }
         export function Union<TBranches extends ObjectSchema<any>[]>(
           branches: TBranches
         ): UnionSchema<TBranches>;
         ```
         Discriminator is synthesized at conversion time from each branch's
         required-key fingerprint.

      3. `record.ts` — homogeneous-value record (for `additionalProperties`).
         ```ts
         export interface RecordSchema<TValue extends AnySchema> {
           kind: "record";
           value: TValue;
         }
         export function Record<TValue extends AnySchema>(value: TValue): RecordSchema<TValue>;
         ```

      4. `json.ts` — opaque JSON value, used as the recursive-`$ref` escape hatch.
         ```ts
         export interface JsonValueSchema { kind: "json"; }
         export function Json(): JsonValueSchema;
         ```

      Wire all four into `packages/toolcraft-schema/src/index.ts`:
      - Add to the `S` namespace export.
      - Extend the `AnySchema` union type.
      - Extend `toJsonSchema` to emit a faithful JSON Schema for each
        (`oneOf` for `OneOf`/`Union`, `additionalProperties` for `Record`,
        `{}` permissive for `Json`).
      - Extend the `Static<>` type extraction.

      Add a compile-check file per kind asserting `Static<typeof schema>`
      types match expectations. No consumer code uses these yet — the rest of
      the codebase must continue to compile and pass tests.

      Project rule: tests use memfs, must be fast, no real LLM calls. Run
      `npm run test --workspace toolcraft-schema` before committing.
    status:
      implement: done
      test: done
      commit: done

  - id: json-schema-converter
    title: Implement JSON Schema → toolcraft-schema converter in toolcraft
    prompt: |
      Create `packages/toolcraft/src/json-schema-converter.ts` exporting:

      ```ts
      export function convertJsonSchema(schema: JsonSchema): AnySchema;
      ```

      The function takes an upstream MCP tool's `inputSchema` (standard JSON
      Schema) and returns an `AnySchema` from `toolcraft-schema`. It is pure
      and synchronous.

      Conversion rules — one branch per JSON Schema feature:

      - `type: "object"` with `properties` → `S.Object({...})`.
      - `type: "string"` → `S.String()`. Honor `pattern` (validated client-side later).
      - `type: "number" | "integer"` → `S.Number()`.
      - `type: "boolean"` → `S.Boolean()`.
      - `type: "array"` with `items` → `S.Array(convertJsonSchema(items))`.
      - `enum` of primitives → `S.Enum([...])`.
      - `enum` of objects → `S.Json()` with descriptive metadata in help text.
      - `oneOf`/`anyOf` of object branches WITH a string-literal discriminator
        field present in every branch → `S.OneOf({ discriminator, branches })`.
      - `oneOf`/`anyOf` of object branches WITHOUT a discriminator → synthesize
        one from each branch's required-key set fingerprint, emit `S.Union`.
      - `additionalProperties` schema with empty `properties` → `S.Record(value)`.
      - `nullable: true` (or `type: ["string","null"]` style) → wrap with
        nullable handling so the value `null` round-trips as JSON `null`, not
        the string `"null"`.
      - `const` → emit a schema kind (or wrap as `S.Enum([value])`) that the CLI
        layer renders as a no-flag injected default.
      - Any field with a self-referencing `$ref` (or descendant containing one)
        → entire input collapses to `S.Json()`. This is the only fallback.

      Add `packages/toolcraft/src/json-schema-converter.test.ts` with one test
      per rule above. Tests use memfs; do not hit network or spawn processes.

      Run `npm run test --workspace toolcraft -- json-schema-converter` before
      committing. The new module must not be imported anywhere else yet — the
      rest of the codebase keeps building.
    status:
      implement: done
      test: done
      commit: done

  - id: group-type-mcp-fields
    title: Add `mcp`, `tools`, and `rename` optional fields to defineGroup config
    prompt: |
      Extend the `Group` config type in `packages/toolcraft/src/index.ts`
      with three new optional fields. All are accepted by `defineGroup`:

      - `mcp?: McpServerConfig` — imported from `@poe-code/agent-mcp-config`.
        That package exports `McpServerConfig = McpStdioServer | McpHttpServer`
        with shapes:
        - `{ transport: "stdio", command, args?, env? }`
        - `{ transport: "http", url, headers? }`
      - `tools?: string[]` — optional allowlist of upstream tool names.
      - `rename?: Record<string, string>` — optional map from upstream tool
        name to a dotted toolcraft path. Final segment is the command name;
        preceding segments become nested groups (auto-created on demand).
        Example: `{ create_issue: "issues.create" }` puts a `create` command
        under an `issues` subgroup of the current group. Tools not present in
        the map keep their upstream name verbatim and sit directly under the
        group.

      Validate `rename` values eagerly at `defineGroup` time:
      - Reject empty segments (leading/trailing dot, double dot).
      - Reject duplicate target paths (two upstream keys mapped to the same
        dotted path) with both upstream names in the error.

      Other validations — unknown upstream key in `rename`, target collision
      with a native sibling command, etc. — happen later at `resolveMcpProxies`
      time (they require the cache contents).

      Add `@poe-code/agent-mcp-config` and `tiny-mcp-client` to
      `packages/toolcraft/package.json` `dependencies` (workspace versions).

      No runtime behavior wired yet for `mcp`/`tools`/`rename`. The fields are
      accepted (and `rename` shape-validated) but the existing `defineGroup`
      impl treats them as no-ops at runtime. Existing tests must still pass.

      Add a compile-check or unit test asserting:
      - `defineGroup({ name: "x", mcp: { transport: "stdio", command: "..." } })`
        type-checks.
      - `defineGroup({ name: "x", tools: ["a"] })` type-checks.
      - `defineGroup({ name: "x", rename: { a: "b.c" } })` type-checks.
      - `defineGroup({ name: "x", rename: { a: "" } })` throws at definition.
      - `defineGroup({ name: "x", rename: { a: "b.c", d: "b.c" } })` throws at
        definition (duplicate target).
      - `defineGroup({ name: "x" })` (no new fields) still type-checks.

      Run `npm run test --workspace toolcraft` before committing.
    status:
      implement: open
      test: open
      commit: open

  - id: mcp-proxy-runtime-core
    title: Implement mcp-proxy runtime in toolcraft (no entry-point wiring yet)
    prompt: |
      Create `packages/toolcraft/src/mcp-proxy.ts` with the runtime adapter for
      `mcp`-backed groups. Do NOT yet call it from `runCLI`/`runMCP`/SDK — that
      wiring is a separate task.

      Public exports:

      ```ts
      export function resolveMcpProxies(root: Group<any>): Promise<void>;
      export function resolveCachePath(name: string, projectRoot?: string): string;
      export function parseRefreshEnv(value: string | undefined): "all" | Set<string> | undefined;
      export function dialUpstream(name: string, config: McpServerConfig): Promise<McpClient>;
      ```

      Behavior:

      1. `resolveCachePath(name)` — walk upward from `process.cwd()` until a
         directory containing `package.json` is found; cache path is
         `<projectRoot>/.toolcraft/mcp/<name>.json`. Throw a clear error if
         no `package.json` is found.
      2. `parseRefreshEnv` — reads `TOOLCRAFT_MCP_REFRESH`. Empty/unset →
         `undefined`. `1` or `true` → `"all"`. Comma-separated → `Set<string>`
         of names (trimmed).
      3. `dialUpstream` — picks `StdioTransport` or `HttpTransport` from
         `tiny-mcp-client` based on `config.transport`. Returns a connected
         `McpClient`. Caller manages lifecycle.
      4. `resolveMcpProxies(root)`:
         - Walk the group tree, collect every group with an `mcp` field.
         - For each such group, in parallel:
           - Compute cache path. If present and not in the refresh set → read
             the JSON. Apply the `tools?` allowlist against upstream names.
             Apply the `rename?` map (see below). Convert each remaining
             tool's `inputSchema` via the converter from the previous task.
             Populate `group.children` with the resulting tree of nested
             groups + commands. No output.
           - If absent or in the refresh set → emit progress to **stderr** via
             `@poe-code/design-system` (connecting / listing tools / found N /
             wrote path). Connect, page through `tools/list` until exhausted,
             write `<projectRoot>/.toolcraft/mcp/<name>.json` atomically (write
             to sibling `.json.tmp` then rename), then proceed with the same
             allowlist/rename/convert/populate path as above.
             The cache JSON has the shape:
             ```json
             {
               "$schema": "https://poe-platform.github.io/poe-code/schemas/toolcraft/mcp-proxy.schema.json",
               "version": 1,
               "upstream": { "name": "...", "version": "..." },
               "fetchedAt": "<ISO>",
               "tools": [ /* upstream Tool shape verbatim */ ]
             }
             ```
         - Each upstream tool becomes a `Command` whose handler dials/uses the
           hot upstream client and forwards the call (call still uses the
           **upstream** tool name — only the toolcraft-side path/name changes).
         - On any failure: reject with a clear `couldn't discover MCP <name>`
           error message.

      Rename expansion rules:
      - Default placement (no entry in `rename`): tool sits at
        `group.children[<upstream-name>]` as a leaf `Command`.
      - With entry `{ <upstream>: "a.b.c" }`: ensure a chain of nested
        `Group`s `a` → `b` exists under the current group (auto-create with
        `name: "a"` etc., empty `children`, no `mcp` field), then add the
        `Command` named `c` to the deepest one.
      - Auto-created intermediate groups must merge with explicitly-defined
        sibling groups of the same name — when a sibling already exists, slot
        the upstream tool inside it instead of erroring.
      - Validate at resolve time:
        - Every key of `rename` must correspond to a tool present in the
          allowlisted set; an unknown key throws `couldn't discover MCP <name>:
          rename references unknown upstream tool "<key>"`.
        - The final command path must not collide with an existing child of
          its parent group (native command or another upstream tool); throw
          with the dotted path on collision.
      - The cache file is unaffected by rename: it always stores the upstream
        tool list verbatim. Rename is a defineGroup-time decision.

      Hot connection lifecycle: per-proxy `client?: McpClient`,
      `connecting?: Promise<McpClient>`, `dispose: () => Promise<void>`.
      Lazy connect on first call (not at discovery time), keep alive,
      reconnect on disconnect. Register `dispose` for the existing toolcraft
      shutdown path.

      Add `packages/toolcraft/src/mcp-proxy.test.ts` with unit tests using
      memfs:

      - `parseRefreshEnv` covers undefined / `1` / `true` / `github` /
        `github,linear` / whitespace.
      - `resolveCachePath` finds `package.json` upward; throws when absent.
      - Cache-load happy path produces a populated `Group.children`.
      - Allowlist filter drops non-allowlisted tools from the in-memory group
        but the on-disk cache still contains all tools.
      - Rename map cases:
        - `rename: { create_issue: "issues.create" }` produces a nested
          `issues` group containing a `create` command whose handler invokes
          upstream tool `create_issue`.
        - `rename: { create_issue: "create" }` (no dot) renames in place.
        - Unknown upstream key → resolve rejects with the documented message.
        - Auto-created intermediate group merges with an explicit sibling
          group of the same name — the upstream command lands inside the
          explicit group, not in a new one.
        - Final-path collision (rename target equals an existing native
          command) → resolve rejects.
        - Cache file content is unchanged by rename (assert it stores
          upstream-name keys verbatim).
      - Atomic write writes to `.tmp` then renames.
      - Corrupt cache JSON → re-fetch path triggers.

      Project rule: tests must not create real files; use memfs. Tests must not
      hit network. `dialUpstream` calls in unit tests must be mocked.

      Run `npm run test --workspace toolcraft -- mcp-proxy` before committing.
      Existing toolcraft tests must continue to pass.
    status:
      implement: open
      test: open
      commit: open

  - id: wire-resolve-into-entry-points
    title: Wire resolveMcpProxies into runCLI / runMCP / SDK constructor
    prompt: |
      Add a single `await resolveMcpProxies(root)` call at the top of each
      toolcraft entry point in `packages/toolcraft/src/`:

      - `cli.ts` — `runCLI` (and any other CLI entry) before commander parse.
      - `mcp.ts` — `runMCP` and `createMCPServer` before tools are bound to the
        server (before `server.tool(...)` registration).
      - `sdk.ts` — SDK constructor / factory awaits before returning the SDK
        proxy.

      The call is a no-op for trees with no `mcp`-backed groups. After the
      await, every `mcp`-backed group's `children` is populated and the rest
      of the entry-point logic walks them like native groups — no other code
      change required in those files.

      Critical: discovery output goes to stderr only. `runMCP` uses stdout for
      JSON-RPC; ensure no progress lines leak to stdout. Add an integration-
      style test (still in the unit-test runner, with mocked dial) that
      captures stdout during a `runMCP` startup and asserts it is empty.

      Existing toolcraft tests (CLI, MCP, SDK) must continue to pass without
      modification — no `mcp` field means no behavior change.

      Run `npm run test --workspace toolcraft` before committing.
    status:
      implement: open
      test: open
      commit: open

  - id: cli-flag-rendering-new-kinds
    title: Extend toolcraft CLI flag rendering for OneOf, Union, Record,
      Array-of-Object, nullable, pattern
    prompt: |
      Update `packages/toolcraft/src/cli.ts` so the flag layer renders the
      following toolcraft-schema kinds (added in earlier tasks). Today
      `cli.ts` only handles object-of-primitives plus enum/array-of-primitive.

      Required rendering:

      - `S.OneOf({ discriminator, branches })` — one required `--<discriminator>`
        flag taking a literal string. Plus the union of all branches' inner
        flags. At parse time, validate that only flags from the chosen branch
        are present; reject mixed-branch input with a `UserError`.

      - `S.Union(branches)` — synthesize a `--<field>-kind <branch-id>` flag
        where branch ids come from required-key fingerprints. Same parse-time
        validation as `OneOf`.

      - `S.Record(value)` — accept `--<name>.<key> <value>` repeated flags.
        Values parsed per the `value` schema (string by default).

      - `S.Array(S.Object(...))` — indexed flag form
        `--<name>.0.<field> ... --<name>.1.<field> ...`. Indices must be
        contiguous starting from 0.

      - Nullable fields — when the schema is `nullable: true`, accept the
        literal `null` (e.g. `--field=null`) and emit JSON `null`, not the
        string `"null"`.

      - `pattern: <regex>` on a string field — validate client-side before
        sending; mismatch surfaces as a `UserError` with the offending value
        and pattern.

      - Deep nesting beyond 2 levels — remove any depth cap; existing dot-path
        flag style continues to work.

      - `S.Json()` — render as a single `--<name> '<json>'` flag taking a JSON
        string parsed at parse time. This is the only "JSON blob" fallback and
        is only emitted by the converter for recursive-`$ref` schemas.

      Add tests covering each case. Existing CLI tests must continue to pass
      unchanged.

      Run `npm run test --workspace toolcraft -- cli` before committing.

      Visual check: `npm run screenshot-poe-code -- <test-cli-using-new-kinds>
      --help` to verify the help output renders cleanly with the design system.
    status:
      implement: open
      test: open
      commit: open

  - id: integration-tests-tiny-stdio-mcp
    title: "Integration tests: defineGroup with mcp against
      tiny-stdio-mcp-test-server"
    prompt: |
      Add `packages/toolcraft/src/mcp-proxy-integration.test.ts` that exercises
      the full path against `tiny-stdio-mcp-test-server` (existing package in
      this monorepo, already used by `tiny-mcp-client` tests).

      Each test creates a `defineGroup` whose `mcp` field spawns the test
      server as a stdio subprocess, runs the toolcraft entry point, and
      asserts the observable behavior.

      Tests:

      1. First run with empty `.toolcraft/mcp/` — discovery runs, cache file is
         written under the test's temp project root, `Group.children` is
         populated, and a tool call routes to the upstream and returns its
         result.
      2. Second run with the same cache file — no discovery output on stderr,
         no upstream subprocess spawned until the first tool call, then exactly
         one subprocess for all subsequent calls (assert spawn count = 1).
      3. `TOOLCRAFT_MCP_REFRESH=<name>` env var — cache is deleted and
         refetched; file mtime changes; stderr shows the discovery progress.
      4. Hot connection — three sequential tool calls share one upstream
         subprocess (assert spawn count = 1).
      5. Reconnect — kill the upstream child between calls, the next call
         respawns and succeeds.
      6. `runMCP` mode stdout is JSON-RPC only; capture stdout during startup
         with a missing cache and assert no discovery output leaks.
      7. Failure path — `mcp.command` points at a non-existent binary;
         `resolveMcpProxies` rejects, the runtime exits non-zero, stderr shows
         a `couldn't discover MCP <name>` message.
      8. Rename map — `rename: { <upstream-tool>: "sub.renamed" }`. Assert the
         CLI exposes the command at `<group> sub renamed`, the SDK at
         `sdk.<group>.sub.renamed`, the MCP re-emission as
         `root__<group>__sub__renamed`, and that calling it invokes the
         original upstream tool name on the wire.

      Project rules to honor: tests must be fast; if a real subprocess test
      takes more than a few seconds, mock the subprocess instead. Snapshots
      may live on disk per the snapshot-testing exception. The test must use
      the project's existing snapshot/spawn abstractions where applicable.

      Run `npm run test --workspace toolcraft -- mcp-proxy-integration` before
      committing.
    status:
      implement: open
      test: open
      commit: open

  - id: docs-readme-and-qa
    title: Document mcp proxy in toolcraft README and add QA checklist
    prompt: |
      Two documentation deliverables. Per project rule, README changes need
      explicit user approval — flag this commit for review and DO NOT merge
      without confirmation from the user.

      1. Update `packages/toolcraft/README.md`:
         - Add a "MCP proxy" section describing the new optional `mcp` field
           on `defineGroup` (accepts the standard
           `@poe-code/agent-mcp-config` `McpServerConfig` shape), the
           `tools?: string[]` allowlist, and the `rename?: Record<string,
           string>` map (keys = upstream names, values = dotted toolcraft
           paths; nested groups auto-created).
         - Document the cache location:
           `<projectRoot>/.toolcraft/mcp/<group-name>.json`. Project root is
           the nearest ancestor of cwd containing `package.json`.
         - Document the `TOOLCRAFT_MCP_REFRESH` env var: unset = use cache;
           `1` or `true` = refresh all; comma-separated names = refresh
           specific proxies.
         - Note that discovery output goes to stderr and only fires on first
           run when the cache is missing.
         - Note the recursive-`$ref` fallback behavior (single
           `--<name> '<json>'` flag for the whole input).
         - Update the "Configuration" section to list the new `mcp`, `tools`,
           and `rename` keys on `defineGroup`.

      2. Create `packages/toolcraft/QA-mcp-proxy.md` as a markdown checklist
         (NOT a script — project rule). Cover:
         - First-run discovery: delete `.toolcraft/mcp/`, run, observe stderr
           progress lines, confirm the cache file is written.
         - Second-run silence: rerun, confirm no stderr discovery output.
         - Refresh env var: set `TOOLCRAFT_MCP_REFRESH=<name>`, rerun, confirm
           the named cache file is rewritten.
         - Rename map: add `rename: { <upstream>: "sub.renamed" }`, rerun
           `--help`, confirm the command appears at the renamed path and
           invocation works.
         - Recursive `$ref` fallback: point at a fixture upstream that exposes
           a recursive tool, confirm the CLI exposes `--<name> '<json>'`.
         - Missing `package.json`: run from a directory above any
           `package.json`, confirm the clear error message.
         - Visual: `npm run screenshot-poe-code -- <command-with-mcp-group>
           --help` — confirm the design-system theming matches the rest of
           the CLI.
    status:
      implement: open
      commit: open
---

# toolcraft MCP proxy

Re-export external MCP servers as toolcraft commands so an upstream MCP's tools appear in your toolcraft tree (CLI / MCP / SDK).

## 1. What we're building

A way to declare, inside a toolcraft `defineGroup` tree, that some children come from an upstream MCP server. At registration time toolcraft connects to that server with `tiny-mcp-client`, lists its tools, and adapts each one into a toolcraft `Command`. The adapted commands behave like any other toolcraft command: they show up under CLI, get re-emitted by `createMCPServer`, and are callable from the SDK.

Non-goals:

- Not a generic MCP gateway / multi-tenant router.
- Not proxying prompts or resources — tools only, at least for v1.
- Not a runtime "hot reload" of upstream tool lists — discovery happens at startup.
- Not transparent transport pass-through (we go through a real client).

Open question: do we also re-export upstream `prompts` / `resources`, or strictly tools? Suggesting tools-only for v1.

## 2. User-facing shape

### One API: `defineGroup` with an `mcp` field

There is no separate `defineMcpProxy`, no user-authored proxy file, no codegen subcommand. A group can be backed by an upstream MCP by passing an `mcp` config — the same `McpServerConfig` shape used everywhere else in the codebase (`agent-mcp-config`):

```ts
// src/tools/github.ts
import { defineGroup } from "toolcraft";

export const githubMcp = defineGroup({
  name: "github",
  description: "GitHub MCP server tools",
  mcp: {
    transport: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-github"],
    env: { GITHUB_TOKEN: process.env.GITHUB_TOKEN ?? "" },
  },
  tools: ["create_issue", "list_issues", "get_pull_request"],
});
```

The user's app uses it like any other group:

```ts
import { defineGroup } from "toolcraft";
import { githubMcp } from "./tools/github.js";

export const root = defineGroup({
  name: "root",
  children: [githubMcp],
});
```

`mcp` accepts `McpServerConfig` verbatim — `{ transport: "stdio", command, args?, env? }` or `{ transport: "http", url, headers? }`. Nothing toolcraft-specific is layered into that field. The optional `tools?: string[]` allowlist sits next to `mcp` on the `defineGroup` config — it is a toolcraft concern, not part of the standard MCP server config.

### Renaming and re-grouping with `rename`

Upstream MCP servers ship their own tool names (`create_issue`, `getPullRequest`, …). Inside a toolcraft tree those names often want a different shape — split into nested groups, lowercased, regrouped to match the host project's vocabulary. The optional `rename?: Record<string, string>` map on the same `defineGroup` config does both jobs at once:

```ts
defineGroup({
  name: "github",
  mcp: { transport: "stdio", command: "npx", args: ["-y", "@modelcontextprotocol/server-github"] },
  tools: ["create_issue", "list_issues", "get_pull_request"],
  rename: {
    create_issue:     "issues.create",
    list_issues:      "issues.list",
    get_pull_request: "pulls.get",
  },
});
```

- Keys are upstream tool names (verbatim, as returned by `tools/list`).
- Values are dotted paths. The final segment becomes the toolcraft `Command` name; preceding segments become nested groups, auto-created on demand. So `"issues.create"` puts a `create` command under an `issues` subgroup of the `github` group.
- A value with no dot is just a rename — `{ create_issue: "create" }` keeps the command directly under `github` but renames it to `create`.
- Tools not listed in `rename` keep their upstream names verbatim, slotted directly under the group.

Resulting tree for the example above:

```text
github
├── issues
│   ├── create        # upstream: create_issue
│   └── list          # upstream: list_issues
└── pulls
    └── get           # upstream: get_pull_request
```

Surfaces:

- CLI: `mytool github issues create --owner foo --repo bar --title "..."`
- MCP: re-emitted as `root__github__issues__create`
- SDK: `await sdk.github.issues.create({ owner, repo, title })`

The `tools?` allowlist filters against **upstream** names (matching what the cache file stores). The `rename` map is applied after filtering, against the same upstream names. So `tools` and `rename` are independent: removing a key from `tools` drops the tool entirely; removing it from `rename` just keeps the upstream name.

### How the cache works (encapsulated)

The cache is an implementation detail. The user does not configure its location.

1. Toolcraft resolves a project-local cache path internally — `<project-root>/.toolcraft/mcp/<group-name>.json`. Project root is the closest ancestor directory containing `package.json`.
2. Cache file missing → toolcraft connects to the upstream via `tiny-mcp-client`, calls `tools/list`, writes the cache file, then continues. The dev commits the file.
3. Cache file present → toolcraft reads it and skips the upstream fetch entirely. Children are reified from the cached tool list.
4. Each upstream tool becomes a `Command` whose handler dials the upstream and forwards the call.

After first run:

```text
<project-root>/
├── src/tools/github.ts
└── .toolcraft/
    └── mcp/
        └── github.json       # auto-generated, checked in
```

`.toolcraft/` is meant to be checked in for proxies users want to ship; users add it to their repo. Toolcraft never writes anywhere else.

### Refresh via environment variable

There is no `mcp diff` or `mcp codegen` CLI subcommand. Refresh is opt-in via env var:

```text
TOOLCRAFT_MCP_REFRESH=1 npm run dev          # refresh every cached MCP proxy
TOOLCRAFT_MCP_REFRESH=github npm run dev     # refresh only the proxy named "github"
TOOLCRAFT_MCP_REFRESH=github,linear ...      # refresh several
```

When set, the cache file is ignored (or deleted and rewritten) for matching proxies; the rest are read from disk as usual. Without the env var the runtime never touches the upstream just to refresh.

### How proxied tools appear

Proxied commands are first-class in every scope:

- **CLI**: `mytool github create-issue --owner foo --repo bar --title "..."` — the upstream tool's JSON Schema renders as flags through the same path that handles native commands.
- **MCP** (`createMCPServer`): re-emitted as `root__github__create_issue` with the upstream's `description` and `inputSchema`.
- **SDK**: `await sdk.github.create_issue({ owner, repo, title })`. v1 args are loosely typed (`Record<string, unknown>`) — see Open question on typed call sites below.

### Cache JSON shape

```json
{
  "$schema": "https://poe-platform.github.io/poe-code/schemas/toolcraft/mcp-proxy.schema.json",
  "version": 1,
  "upstream": { "name": "github-mcp", "version": "1.4.2" },
  "fetchedAt": "2026-04-25T10:00:00Z",
  "tools": [
    {
      "name": "create_issue",
      "description": "Open a new issue on a repo.",
      "inputSchema": {
        "type": "object",
        "properties": {
          "owner": { "type": "string" },
          "repo":  { "type": "string" },
          "title": { "type": "string" },
          "body":  { "type": "string" }
        },
        "required": ["owner", "repo", "title"]
      }
    }
  ]
}
```

`tools[]` uses the upstream MCP `Tool` shape verbatim — no toolcraft-specific translation. The full upstream tool list is stored regardless of the `tools?` allowlist on `defineGroup`; allowlist filtering happens at `defineGroup` time, not at cache-write time. That way changing the allowlist doesn't require a refresh. The cache JSON does **not** include transport details — that lives in the user's source code, not in checked-in cache files. Rename is also a defineGroup-time decision: the cache always stores upstream-name keys verbatim, so changing `rename` does not require a refresh.

### Casing and naming

Upstream tool names and parameter keys pass through verbatim. Toolcraft's `casing` option only affects toolcraft-native commands.

### Errors / edge cases the user sees

- Cache missing AND upstream unreachable on first run → `defineGroup` throws at registration with the connect failure message.
- Cache present, upstream unreachable at call time → `UserError` mapped from the `tiny-mcp-client` connect failure.
- Cache stale (a tool was renamed/removed upstream) → calls to the affected tool fail with `UserError`. Run with `TOOLCRAFT_MCP_REFRESH=<name>` to refresh.
- Cache JSON contains a JSON Schema feature toolcraft can't represent at the CLI flag layer → that one tool exposes only `--json '<args>'` as a fallback; the rest still get typed flags.

- Open question: do we want a typed-args call site at the SDK boundary? v1 says no (loose types). Adding it later means generating a sibling `.d.ts` from the JSON; the runtime contract doesn't change.
- Open question: do we keep the upstream subprocess hot for the lifetime of the toolcraft process, or connect-per-call? Suggesting hot — usual MCP client pattern, cheap after warmup.

## 3. Implementation details and technical decisions

### Where the code lives

Inside the existing `toolcraft` package:

- `src/mcp-proxy.ts` — the runtime adapter (`mcp` field on `defineGroup`, cache I/O, upstream dial, tool→Command reification, hot connection management, rename expansion).
- `src/cli.ts` (existing) — extended to render every JSON Schema feature real MCP servers use (see "CLI rendering gaps" below).
- `toolcraft-schema` — extended where needed to express the missing features (`oneOf`, free-form objects, etc.) as first-class so the same renderer handles native and proxied commands.

No new package. `tiny-mcp-client` provides the client.

### Cache lookup

Project root resolution: walk upward from `process.cwd()` until a directory containing `package.json` is found. Cache path = `<projectRoot>/.toolcraft/mcp/<group-name>.json`. If no `package.json` is found above cwd, error with a clear message — toolcraft has no place to write the cache.

`<group-name>` is the `name` passed to `defineGroup`. Two `mcp`-backed groups can't share a name (already true of toolcraft groups in general).

### First-run behavior — eager discovery with visible progress

`defineGroup` with `mcp` is synchronous at the user's call site and produces a `Group` whose `children` is initially empty. The toolcraft runtime entry points (`runCLI`, `runMCP`, SDK constructor) call a single `await resolveMcpProxies(root)` step **before** any user-facing work. That step runs eagerly, in parallel across proxies, and emits visible progress to stderr via the existing `@poe-code/design-system` primitives.

For each `mcp`-backed group:

1. Read cache file from `<projectRoot>/.toolcraft/mcp/<group-name>.json`. Present → parse, populate `children`, no output. Absent → branch to discovery.
2. **Discovery** (cache missing OR `TOOLCRAFT_MCP_REFRESH` matches this name):
   - Connect via `tiny-mcp-client` using `StdioTransport` or `HttpTransport` based on `mcp.transport`.
   - Log progress lines as the steps complete: connecting, listing tools, count found, file written.
   - Atomic write of `<projectRoot>/.toolcraft/mcp/<group-name>.json` (write to a sibling `.json.tmp` file, then rename).
3. Apply `tools?` allowlist, then expand `rename?` paths into nested groups, then convert each tool's `inputSchema` and populate `children`.

Output uses the existing design-system logger and is written to **stderr**, so it doesn't pollute stdout (important for `runMCP` where stdout is the JSON-RPC channel). Discovery is a one-time event tied to cache absence — after the first run the cache file exists, no message is printed, normal CLI/MCP/SDK output is unchanged. There is no flag to silence discovery and no flag to force it; the env var is the only refresh path.

Sample first-run output (cache absent):

```text
▸ Discovering MCP servers
  ▸ github
    stdio: npx -y @modelcontextprotocol/server-github
    connecting… ok
    listing tools… 27 found
    wrote .toolcraft/mcp/github.json
```

Subsequent runs print nothing related to mcp proxies.

If discovery fails, the runtime exits with a non-zero code and a clear `couldn't discover MCP <group-name>` error (printed to stderr) — the program does not start half-initialized.

### Hot connection lifecycle

Per-proxy state, keyed by `defineGroup` instance:

- `client?: McpClient` — undefined until first call.
- `connecting?: Promise<McpClient>` — coalesces concurrent first-call attempts.
- `dispose: () => Promise<void>` — registered with the toolcraft runtime's shutdown hook (the existing `runMCP`/CLI runner already has process-exit cleanup).

On tool invocation:

1. If `client` is alive, use it.
2. Else if `connecting` exists, await it.
3. Else start `connecting`, set `client` once resolved.
4. On client disconnect event, clear `client` so the next call reconnects.

Stateless upstream means no session reuse needs to be guaranteed; reconnect on disconnect is enough.

### Refresh via `TOOLCRAFT_MCP_REFRESH`

Read at process start. Set of names to refresh:

- Empty / unset → no refresh; cache is read normally.
- `1` or `true` → refresh every `mcp`-backed group.
- Comma-separated list → refresh only those names.

For each matched group, the resolver deletes the cache file before doing the cache-missing branch above. After write, the rest of the run proceeds normally.

### Rename expansion

Rename runs after the allowlist and before schema conversion:

1. Default placement (no entry in `rename`): tool sits at `group.children[<upstream-name>]` as a leaf `Command`.
2. With entry `{ <upstream>: "a.b.c" }`: ensure a chain of nested `Group`s `a` → `b` exists under the current group (auto-create with `name: "a"` etc., empty `children`, no `mcp` field), then add the `Command` named `c` to the deepest one.
3. Auto-created intermediate groups merge with explicitly-defined sibling groups of the same name. When a sibling already exists, the upstream tool slots inside it. This is the only implicit merge.
4. The `Command` handler always uses the **upstream** tool name on the wire. Only the toolcraft-side path/name changes.

### CLI rendering gaps — in scope for this plan

Each row is work that lands as part of shipping mcp proxy. These also benefit native toolcraft commands. The principle: anything that **can** be rendered structurally **must** be — no JSON-blob escape hatch except for genuinely recursive shapes.

| JSON Schema feature | Plan |
| --- | --- |
| `oneOf` / `anyOf` of object branches with a string discriminator | Render as a required `--<discriminator>` flag plus the union of branch flags; validate at parse time that only flags from the chosen branch are present. Add `S.OneOf({ discriminator, branches })` to `toolcraft-schema`. |
| `oneOf` / `anyOf` without a discriminator | Synthesize a discriminator from each branch's structural fingerprint (set of required keys); expose it as `--<field>-kind <branch-id>`. Branches are still typed flags. Add `S.Union({ branches })` with auto-discrimination to `toolcraft-schema`. |
| `additionalProperties: true` (free-form record) with `properties: {}` | Accept `--<name>.<key> <value>` repeated flags; values parsed as JSON-or-string per `additionalProperties` schema. Add `S.Record(valueSchema)` to `toolcraft-schema`. |
| `array` of objects | Repeated indexed flags: `--<name>.0.email a@x --<name>.0.name A --<name>.1.email b@y ...`. Add `S.Array(S.Object(...))` rendering support to the CLI. |
| Deep nesting beyond 2 levels | Already works with the existing dot-path flag style; just remove any depth cap. Add a test case at depth 4. |
| `format: "uri" / "email" / "date-time"` | Accept as string; client-side validation only when the format is one we already check natively (URI, date). Show in help text. |
| `pattern: <regex>` | Accept as string and validate client-side before sending; surface mismatch as a `UserError`. |
| Nullable fields | Accept `--<name>=null` literal. Toolcraft today coerces this to the string `"null"`; fix to emit JSON `null` when the schema is `nullable: true`. |
| Recursive `$ref` to self | Out of scope. Tools whose input or any descendant uses recursive `$ref` fall back to `--json '<args>'` for their entire input. This is the only fallback. |
| `const` | Render no flag; inject the const at call time. |
| `enum` of objects | Render as a single `--<name>` flag whose value is one of the literal JSON encodings; help text lists each option. |

The only JSON fallback is for tools whose schema contains a recursive `$ref`. Everything else gets a real structural rendering.

### JSON Schema → toolcraft-schema conversion

The cache stores JSON Schema verbatim. At `defineGroup` resolve time, each tool's `inputSchema` is converted to a `toolcraft-schema` object so the rest of toolcraft (CLI flag rendering, MCP re-emission, SDK shape) treats it uniformly. Conversion is a switch on `type` plus keyword handlers for `oneOf`/`anyOf`/`additionalProperties`/`enum`/`const`/`pattern`/`format`/`nullable`. Recursive `$ref` is detected during conversion and the entire tool input collapses to a single `S.Json()` field; this is the only escape hatch.

### Edge cases

- Two groups with the same `name` in the same tree → error at `defineGroup` time, same as toolcraft does today for native groups.
- Cache file present but corrupt JSON → log + treat as missing, fetch, overwrite. (No silent-corruption mode where we try to parse partial data.)
- Cache file from a different `version` → log + refetch.
- Upstream returns paginated `tools/list` (`nextCursor`) → follow until exhausted before writing cache.
- Upstream tool name collides with a toolcraft-native command at the same path → error at resolve time, same precedence rules as native groups (no implicit override).
- `rename` key references an upstream tool name not present in the cache → error at resolve time with the offending key. Catches typos when the upstream tool was renamed or removed.
- Two `rename` entries point at the same dotted path → error at `defineGroup` time listing both upstream names.
- A `rename` target collides with an existing native command or another proxy's tool at the same final path → error at resolve time, same precedence as the native-collision rule above.
- Empty segment in a `rename` value (leading/trailing/double dot) → error at `defineGroup` time.
- Auto-created intermediate group from a `rename` path collides with an explicitly defined sibling group of the same name → the explicit group wins; the upstream tool is slotted into it as a child. This is the only implicit merge.
- Secrets in `mcp.env` are values the user already resolved (e.g. `process.env.X`); toolcraft does not interpolate `${env:X}` strings. Matches the existing `McpServerConfig` contract.
- HTTP transport with auth headers → headers are passed verbatim from `mcp.headers`; toolcraft does not refresh tokens.

### Open questions

- Do we need a `description?` override on `defineGroup` when `mcp` is present, or do we always use the upstream's `serverInfo`? Suggesting the user's `description` wins when set; otherwise blank.
- Pagination caps — is there a sane upper bound on tool count? GitHub's MCP has ~60. Probably no cap; just stream-write the cache.

## 4. Interfaces and test plan

### Public types added to `toolcraft`

```ts
// re-exported from agent-mcp-config — single source of truth for the shape
import type { McpServerConfig } from "@poe-code/agent-mcp-config";

// new fields on defineGroup config (optional, additive)
interface GroupConfig<TServices extends object> {
  // ...existing fields...
  mcp?: McpServerConfig;
  tools?: string[];
  rename?: Record<string, string>; // upstream tool name → dotted toolcraft path
}

// shape of cache files written under <projectRoot>/.toolcraft/mcp/<name>.json
interface McpProxyCacheFile {
  $schema: string;
  version: 1;
  upstream: { name: string; version: string };
  fetchedAt: string;            // ISO 8601
  tools: McpToolListEntry[];    // upstream `Tool` shape verbatim
}

interface McpToolListEntry {
  name: string;
  description?: string;
  inputSchema: JsonSchema;      // upstream JSON Schema verbatim
}
```

### New schema kinds in `toolcraft-schema`

```ts
// discriminated union — branch chosen by a literal string field
export function OneOf<TBranches extends Record<string, ObjectSchema<any>>>(
  config: { discriminator: string; branches: TBranches }
): OneOfSchema<TBranches>;

// auto-discriminated union — discriminator synthesized from each branch's
// required-key fingerprint at conversion time
export function Union<TBranches extends ObjectSchema<any>[]>(
  branches: TBranches
): UnionSchema<TBranches>;

// free-form record with a homogeneous value type
export function Record<TValue extends AnySchema>(value: TValue): RecordSchema<TValue>;

// arbitrary JSON value — used only as the recursive-$ref escape hatch
export function Json(): JsonSchema;
```

These four kinds are added in service of mcp proxy but become available to any toolcraft user.

### Internal functions in `toolcraft/src/mcp-proxy.ts`

```ts
// the single eager-discovery entry point called by runCLI / runMCP / SDK
export function resolveMcpProxies(root: Group<any>): Promise<void>;

// pure: convert an upstream JSON Schema into a toolcraft-schema object
// (recursive $ref → S.Json())
export function convertJsonSchema(schema: JsonSchema): AnySchema;

// dial the upstream and return a connected, lifecycle-managed client
export function dialUpstream(
  name: string,
  config: McpServerConfig
): Promise<McpClient>;

// resolve <projectRoot>/.toolcraft/mcp/<name>.json (errors if no package.json)
export function resolveCachePath(name: string): string;

// parse TOOLCRAFT_MCP_REFRESH into a Set<string> | "all" | undefined
export function parseRefreshEnv(value: string | undefined): "all" | Set<string> | undefined;
```

### Test plan

Tests for this work live at `packages/toolcraft/src/mcp-proxy.test.ts` plus per-feature converter tests.

#### Unit tests (memfs, fast)

- `parseRefreshEnv` — covers undefined / `1` / `true` / `github` / `github,linear` / whitespace
- `resolveCachePath` — finds `package.json` upward from cwd; throws when absent
- `convertJsonSchema`:
  - object with primitives → `S.Object`
  - object with `oneOf` + discriminator → `S.OneOf`
  - object with `oneOf` no discriminator → `S.Union` with synthesized fingerprint
  - `additionalProperties` schema → `S.Record`
  - `array` of objects → `S.Array(S.Object(...))`
  - nullable → emits JSON `null` not `"null"` string
  - recursive `$ref` → entire input collapses to `S.Json`
  - `const` → not exposed as a flag, injected at call time
  - `enum` of objects → single flag with literal values in help
- Cache load — present file → `Group.children` populated; corrupt file → re-fetch path
- Allowlist filter — `tools: ["a"]` drops non-`a` tools from the in-memory `Group` but cache still contains all
- Rename map:
  - `rename: { create_issue: "issues.create" }` produces nested `issues` group with `create` child
  - `rename: { create_issue: "create" }` (no dot) renames in place
  - Duplicate target → error at `defineGroup` time
  - Unknown upstream key → error at resolve time
  - Empty segment → error at `defineGroup` time
  - Auto-created intermediate merges with an explicit sibling group of the same name
  - Cache file content unchanged by `rename` (stores upstream names verbatim)
- Atomic write — confirms tmp-and-rename semantics via mocked fs

#### Integration tests (real subprocess)

Use the existing `tiny-stdio-mcp-test-server` package as a real stdio upstream. Each test spawns it via the `mcp` config on a `defineGroup`.

- First run: cache absent → discovery runs → cache written → `Group.children` populated → calling a proxied command forwards to upstream and returns
- Second run with same cache → no discovery output, no upstream subprocess until first call
- `TOOLCRAFT_MCP_REFRESH=name` — cache deleted, refetched, file mtime updated
- Hot connection — three sequential calls share one upstream subprocess (assert spawn count = 1)
- Reconnect — kill the upstream child between calls, the next call respawns and succeeds
- Discovery stderr — captures the runtime's stderr and asserts the expected progress lines on first run; asserts empty on second run
- Rename — `rename: { <upstream>: "sub.renamed" }` produces a CLI command at `<group> sub renamed`, an SDK path `sdk.<group>.sub.renamed`, an MCP tool name `root__<group>__sub__renamed`; the upstream call uses the original tool name
- Failure path — point `mcp.command` at a non-existent binary → `resolveMcpProxies` rejects, runtime exits non-zero with the documented message

#### E2E

A spot test invoked via `npm run dev poe-code <native-cli-using-mcp-proxy>`. Calls a proxied tool through the CLI flag layer to verify rendering+routing end-to-end against `tiny-stdio-mcp-test-server`.

#### Manual QA (markdown)

`packages/toolcraft/QA-mcp-proxy.md` — steps to verify discovery output, refresh env var, rename map, recursive-`$ref` fallback (use a fixture upstream that exposes one), error message when no `package.json` is found, and that the design-system theming matches the rest of the CLI. Per the project rule, this stays a markdown checklist, not a script.

### Rollout / migration

Purely additive. Existing `defineGroup` callers without an `mcp` field are untouched at type and runtime level. The new schema kinds (`S.OneOf`, `S.Union`, `S.Record`, `S.Json`) are new exports — no rename or deprecation. No changes required in agent definitions, providers, or any consumer.

### Autonomy checklist

An agent picking this up should be able to ship without further questions:

- Build: `npm run build --workspace toolcraft --workspace toolcraft-schema`.
- Unit tests: `npm run test --workspace toolcraft --workspace toolcraft-schema`.
- Integration tests: same command — they live in the same package and use `tiny-stdio-mcp-test-server` as the fixture upstream.
- Spot test: `npm run dev -- <command-defined-against-a-test-fixture-mcp>` — discovery output should appear on first run only; second run is silent.
- Visual check (CLI): `npm run screenshot-poe-code -- <command-with-mcp-backed-group> --help` to confirm flag rendering for the new schema kinds.
- All four new schema kinds (`S.OneOf`, `S.Union`, `S.Record`, `S.Json`) must have their own compile-check files in `toolcraft-schema/src/` matching the pattern of existing kinds.
- Cache files created during integration tests must use `memfs` (project rule); only the snapshot artifacts hit disk.
- No new packages — everything lives in the existing `toolcraft` and `toolcraft-schema` packages.
- Discovery output must go to **stderr**, not stdout. Verified by an integration test that asserts stdout is empty during discovery in `runMCP` mode.

## 5. Code plan

### Files to create

- `packages/toolcraft-schema/src/oneof.ts` — discriminated `OneOf` schema kind, `toJsonSchema` impl, type extraction.
- `packages/toolcraft-schema/src/union.ts` — auto-discriminated `Union` schema kind with required-key fingerprint logic.
- `packages/toolcraft-schema/src/record.ts` — homogeneous-value `Record` schema kind for `additionalProperties`.
- `packages/toolcraft-schema/src/json.ts` — opaque `Json` schema kind (escape hatch for recursive `$ref`).
- `packages/toolcraft-schema/src/oneof.compile-check.ts` (and `union`, `record`, `json` siblings) — type-level smoke tests, matching the existing pattern.
- `packages/toolcraft/src/mcp-proxy.ts` — runtime adapter: cache lookup, project-root resolution, refresh env parsing, eager discovery walker, hot connection lifecycle, tool-to-Command reification, rename expansion.
- `packages/toolcraft/src/json-schema-converter.ts` — pure function `convertJsonSchema(schema)`; recursive-`$ref` detection; new-kind emission.
- `packages/toolcraft/src/mcp-proxy.test.ts` — unit tests (memfs).
- `packages/toolcraft/src/mcp-proxy-integration.test.ts` — integration tests using `tiny-stdio-mcp-test-server`.
- `packages/toolcraft/src/json-schema-converter.test.ts` — converter unit tests; one test per JSON Schema feature row from level 3.
- `packages/toolcraft/QA-mcp-proxy.md` — manual QA checklist (markdown, not script).

### Files to change

- `packages/toolcraft/src/index.ts`
  - Extend the `Group` config type with `mcp?: McpServerConfig`, `tools?: string[]`, and `rename?: Record<string, string>`.
  - Validate `rename` shape eagerly (empty segments, duplicate targets) at `defineGroup` time.
  - Export `resolveMcpProxies` and the cache-file type.
- `packages/toolcraft/src/cli.ts`
  - At `runCLI` entry: `await resolveMcpProxies(root)` before commander parse.
  - Extend `FieldDefinition`/flag rendering switch to handle `S.OneOf`, `S.Union`, `S.Record`, `S.Array(S.Object(...))`, nullable null literal, `pattern` validation.
  - Help-text rendering for the new kinds.
- `packages/toolcraft/src/mcp.ts`
  - At `runMCP` and `createMCPServer` entry: `await resolveMcpProxies(root)` before binding tools.
  - `enumerateTools` walks the now-populated `Group.children` of `mcp`-backed groups exactly like native ones.
- `packages/toolcraft/src/sdk.ts`
  - SDK constructor awaits `resolveMcpProxies(root)` before the proxy object is returned.
- `packages/toolcraft-schema/src/index.ts`
  - Re-export `OneOf`, `Union`, `Record`, `Json` from `S` and from the type union `AnySchema`.
  - Extend `toJsonSchema` switch for the four new kinds.
  - Extend `Static<>` type extraction for the four new kinds.
- `packages/toolcraft/package.json`
  - Add `dependencies`: `@poe-code/agent-mcp-config` (for `McpServerConfig`), `tiny-mcp-client`.
- `packages/toolcraft/README.md`
  - New section documenting the `mcp` field on `defineGroup`, the `tools?` allowlist, the `rename?` map, the cache location, and `TOOLCRAFT_MCP_REFRESH`.
  - User explicitly approves README changes — flag this commit for review.

### New / modified function signatures

```ts
// toolcraft-schema/src/oneof.ts
export interface OneOfSchema<TBranches extends Record<string, ObjectSchema<any>>> {
  kind: "oneOf";
  discriminator: string;
  branches: TBranches;
}
export function OneOf<TBranches extends Record<string, ObjectSchema<any>>>(
  config: { discriminator: string; branches: TBranches }
): OneOfSchema<TBranches>;

// toolcraft-schema/src/union.ts
export interface UnionSchema<TBranches extends ObjectSchema<any>[]> {
  kind: "union";
  branches: TBranches;
}
export function Union<TBranches extends ObjectSchema<any>[]>(
  branches: TBranches
): UnionSchema<TBranches>;

// toolcraft-schema/src/record.ts
export interface RecordSchema<TValue extends AnySchema> {
  kind: "record";
  value: TValue;
}
export function Record<TValue extends AnySchema>(value: TValue): RecordSchema<TValue>;

// toolcraft-schema/src/json.ts
export interface JsonValueSchema {
  kind: "json";
}
export function Json(): JsonValueSchema;

// toolcraft/src/mcp-proxy.ts
export function resolveMcpProxies(root: Group<any>): Promise<void>;
export function resolveCachePath(name: string, projectRoot?: string): string;
export function parseRefreshEnv(value: string | undefined): "all" | Set<string> | undefined;
export function dialUpstream(name: string, config: McpServerConfig): Promise<McpClient>;

// toolcraft/src/json-schema-converter.ts
export function convertJsonSchema(schema: JsonSchema): AnySchema;

// toolcraft/src/index.ts (extension)
export interface GroupConfig<TServices extends object> {
  // ...existing fields...
  mcp?: McpServerConfig;
  tools?: string[];
  rename?: Record<string, string>;
}
```

### Build order (each step keeps the branch green)

The pipeline frontmatter at the top of this file lists eight tasks in this order:

1. **schema-kinds-oneof-union-record-json** — add `OneOf`, `Union`, `Record`, `Json` to `toolcraft-schema`. No consumers yet.
2. **json-schema-converter** — new file in toolcraft, depends only on the new schema kinds. Unused by the rest of the codebase.
3. **group-type-mcp-fields** — extend `Group` config with `mcp?`/`tools?`/`rename?`. No runtime wiring; existing tests still pass.
4. **mcp-proxy-runtime-core** — implement `mcp-proxy.ts` (cache I/O, dial, resolve, rename expansion, hot connection). Still unwired.
5. **wire-resolve-into-entry-points** — single `await resolveMcpProxies(root)` in `runCLI`/`runMCP`/SDK. No-op for trees without `mcp` groups.
6. **cli-flag-rendering-new-kinds** — extend `cli.ts` to render `OneOf`/`Union`/`Record`/`Array(Object)`/nullable/pattern.
7. **integration-tests-tiny-stdio-mcp** — full path against the real test server, including rename and stderr-only assertions.
8. **docs-readme-and-qa** — README section + `QA-mcp-proxy.md`.

Each step ships as a separate commit, in order, so reverting any single step leaves the branch buildable.
