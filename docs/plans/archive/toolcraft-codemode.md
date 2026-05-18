---
$schema: https://poe-platform.github.io/poe-code/schemas/plans/pipeline.schema.json
kind: pipeline
version: 1
tasks:
  - id: scaffold-package
    title: Scaffold packages/toolcraft-codemode
    prompt: |
      Create a new workspace package `toolcraft-codemode` at
      `packages/toolcraft-codemode/`. Mirror the layout of
      `packages/toolcraft-openapi/`: `package.json`, `tsconfig.json`,
      `src/index.ts` (empty `export {}` for now), and a stub
      `README.md` containing only the package name and one-line description
      ("Code-mode meta-tools for toolcraft trees, sandboxed by
      agent-script.").

      package.json fields:
        - name: "toolcraft-codemode"
        - version: "0.0.1"
        - type: "module"
        - main/types/exports: dist/index.js + .d.ts at the package root
          only (no subpath exports yet)
        - dependencies: "toolcraft": "workspace:*",
          "toolcraft-schema": "workspace:*",
          "@poe-code/agent-script": "workspace:*"
        - scripts: build/test/lint matching toolcraft-openapi
        - engines.node: ">=20"
        - files: ["dist"]

      Make sure the workspace picks it up: the root `package.json`
      `workspaces` array uses a `packages/*` glob, so no edit there should
      be needed — verify with `npm ls --workspace toolcraft-codemode` or
      equivalent.

      Do not add any logic yet. Do not write tests for this scaffolding.
    status:
      implement: done
      commit: done
  - id: walk-toolcraft-tree
    title: Flatten a resolved toolcraft root into command entries
    prompt: |
      In `packages/toolcraft-codemode/src/tree.ts`, implement a tree
      walker that takes a resolved toolcraft `Group` (root) and returns:

        type CommandEntry = {
          path: string;          // dot-joined snake_case, e.g. "issues.list"
          groupPath: string;     // parent path, e.g. "issues" ("" for root)
          name: string;          // command name, e.g. "list"
          command: Command;      // the toolcraft Command node
        };

      Plus a derived map `Map<groupPath, exportNames[]>` used later for
      agent-script lint metadata.

      Rules:
        - Use the resolved tree as produced by toolcraft (proxies already
          expanded). Do not re-implement MCP proxy resolution; call into
          toolcraft's existing resolver. Read `packages/toolcraft/src/`
          to find the right helper rather than duplicating logic.
        - Skip commands whose `scope` excludes both `mcp` and `sdk`.
          Code-mode only exposes tools usable from a programmatic
          dispatch.
        - Names are already snake_case in toolcraft; do not transform.
        - No regex anywhere. Path joining uses literal "." string.

      TDD: write `src/tree.test.ts` first. Use small in-memory
      `defineGroup` fixtures with nested children (depth >= 2). Assert
      flat list ordering is stable and matches insertion order, and that
      the export map groups correctly. Use `memfs` for any file I/O, but
      this code should not touch the filesystem.
    status:
      implement: done
      test: done
      commit: done
  - id: build-host-modules
    title: Expose toolcraft commands as agent-script host modules
    prompt: |
      In `packages/toolcraft-codemode/src/host-modules.ts`, implement
      `buildHostModules(root, sdk)` that returns:

        - `modules`: the `modules` argument for agent-script `run()`.
          One module per group path (dot-joined snake_case key, e.g.
          "issues" or "pulls.reviews"). Each module is a plain object
          whose keys are the group's command names and values are
          async functions `(params) => sdk.<...>(params)`.

        - `lintModules`: the metadata for `lint({ modules })`. Same keys
          as `modules`, values are arrays of exported names.

      The SDK argument is whatever `createSDK(root, options)` returns;
      `buildHostModules` does not construct it. Tool dispatch must go
      through the SDK so toolcraft's secrets, requires, humanInLoop, and
      progress all cascade — do not call command handlers directly.

      For nested groups, walk the entry list from `tree.ts` (task
      walk-toolcraft-tree). The root group itself contributes a module
      keyed by its own name (matches toolcraft's path convention).

      TDD in `src/host-modules.test.ts`: build a small toolcraft tree
      with one secret-requiring command and one humanInLoop-gated
      command, build host modules over its SDK, run a tiny agent-script
      that imports and calls both, assert the secret was injected and
      the humanInLoop approval was requested via the same path as a
      direct SDK call. Stub the humanInLoop provider in-memory; no real
      approvals.
    status:
      implement: done
      test: done
      commit: done
  - id: search-meta-tool
    title: Search meta-tool with BM25 over the command tree
    prompt: |
      In `packages/toolcraft-codemode/src/search.ts`, implement a
      toolcraft `defineCommand` named `search` with params:

        - query: string (required)
        - limit: number (optional, default from options, fallback 10)
        - detail: "brief" | "detailed" | "full" (optional, default
          "brief")

      Handler: BM25 (k1=1.5, b=0.75) over each command entry's
      `name + description + path`. Tokenize by lowercasing and splitting
      on a whitelist of word characters — iterate the string char by
      char, do not use regex (CLAUDE.md forbids regex). Strip empty
      tokens.

      Return `Array<{ path: string; description: string; schema?: object }>`
      sorted by descending score, capped at `limit`. Include the JSON
      schema for `params` only when `detail` is "detailed" or "full".
      Use `toJsonSchema` from `toolcraft-schema` to generate schemas;
      "detailed" emits the schema as-is, "full" same (we have no
      verbose form to add). Brief omits schema.

      The handler takes the flattened entry list and a default-options
      object via a factory: `makeSearchCommand({ entries, defaults })`.

      TDD in `src/search.test.ts`: fixture tree of ~10 commands across
      multiple groups. Assert that an exact name match outranks a
      description match, that path tokens count toward score, that
      limit truncates, and that detail levels produce the right shape.
      Verify no `RegExp` constructor is reachable (grep the source as
      part of the test if needed, or simpler: just don't import it).
    status:
      implement: done
      test: done
      commit: done
  - id: get-schemas-meta-tool
    title: get_schemas meta-tool returning JSON schemas by path
    prompt: |
      In `packages/toolcraft-codemode/src/get-schemas.ts`, implement
      `makeGetSchemasCommand({ entries })` returning a toolcraft
      `defineCommand` named `get_schemas` with params:

        - names: string[] (required, dotted command paths like
          "issues.list")

      Handler: for each requested name look up the entry, generate its
      params JSON schema via `toJsonSchema` from `toolcraft-schema`, and
      return `Record<string, JsonSchema>`. Unknown names raise
      `UserError` from toolcraft with a message listing the missing
      paths.

      Include the command's `description` in each entry of the response
      so the model does not have to round-trip back to `search`. Shape:

        { [path]: { description: string, params: JsonSchema } }

      TDD in `src/get-schemas.test.ts`: fixture tree, request a known
      command, assert schema matches a snapshot. Request a mix of
      known + unknown, assert `UserError` lists exactly the unknown
      names. Use the snapshot conventions from
      `docs/SNAPSHOT_TESTING.md`.
    status:
      implement: done
      test: done
      commit: done
  - id: execute-meta-tool
    title: execute meta-tool running agent-script with the host modules
    prompt: |
      In `packages/toolcraft-codemode/src/execute.ts`, implement
      `makeExecuteCommand({ root, sdk, budget, sink? })` returning a
      toolcraft `defineCommand` named `execute` with params:

        - source: string (required, agent-script source)

      Handler flow:
        1. Build `modules` and `lintModules` via `buildHostModules`
           (task build-host-modules).
        2. Call `lint(source, { modules: lintModules, filename: "<execute>" })`
           from `@poe-code/agent-script`. Filter to severity === "error".
           If any: return `{ ok: false, kind: "lint", diagnostics }`
           (do not throw — diagnostics are part of the normal response
           so the model can self-correct).
        3. Call `run(source, { modules, budget, signal })` where signal
           comes from the toolcraft handler context's cancellation
           plumbing (look up how toolcraft surfaces AbortSignal in
           handler ctx; if not exposed today, file a follow-up note in
           the plan and proceed with no signal).
        4. On `result.ok` return `{ ok: true, returnValue, stats }`.
           On `!result.ok` return `{ ok: false, kind: "runtime", error:
           { message, code, stack } }`.

      `budget` defaults come from the `codeMode()` options (task
      code-mode-entrypoint). Defaults match agent-script's documented
      defaults; do not invent new caps. Forward only the
      keys agent-script accepts (`maxSteps`, `deadline`, `maxCallDepth`,
      `stringLength`, `arrayLength`).

      Return type is the structured object above, not a string. The
      MCP layer serializes it as the tool result.

      TDD in `src/execute.test.ts`:
        - success path: source returns a value computed from two host
          calls, returnValue matches.
        - lint failure: source uses `function` keyword, response is
          `{ ok: false, kind: "lint", diagnostics: [...] }` with the
          expected error code.
        - runtime failure: host call throws, response is
          `{ ok: false, kind: "runtime", error }`.
        - budget: `maxSteps: 1`, source loops, response is
          `{ ok: false, kind: "runtime" }` with `code: "budgetExceeded"`.
    status:
      implement: done
      test: done
      commit: done
    follow_up:
      - Toolcraft `HandlerContext` does not expose an `AbortSignal` today;
        `execute` currently runs agent-script without cancellation plumbing
        until toolcraft surfaces one.
  - id: code-mode-entrypoint
    title: codeMode(root, options) returning a Group of meta-tools
    prompt: |
      In `packages/toolcraft-codemode/src/index.ts`, export
      `codeMode(root, options?)` returning a toolcraft `defineGroup`
      named `code_mode` whose children are the `search`, `get_schemas`,
      and `execute` commands wired with a shared resolved entry list
      and a shared SDK over `root`.

      Signature (declarative, no zod):

        type CodeModeOptions = {
          budget?: {
            maxSteps?: number;
            deadline?: number;
            maxCallDepth?: number;
            stringLength?: number;
            arrayLength?: number;
          };
          search?: {
            defaultDetail?: "brief" | "detailed" | "full";
            defaultLimit?: number;
          };
        };

      Implementation:
        - Construct one shared SDK via `createSDK(root)` from
          `toolcraft/sdk`. Pass through any humanInLoop / services /
          apiVersion the caller supplies on `options`; lean on
          toolcraft's existing option type rather than redefining it.
          If extending the option type means touching toolcraft, do it
          there instead of duplicating in this package (memory rule:
          extend shared libs, don't duplicate).
        - Walk the resolved tree once via `tree.ts`. Pass the entry
          list to all three meta-tool factories.
        - Default scope for the returned group is `["mcp", "sdk"]`
          (CLI is unusable — pasting agent-script source as a CLI flag
          is not a real use case). Callers can override per-command.

      Re-export `CodeModeOptions` and any types the consumer needs.

      TDD in `src/index.test.ts`: build a fixture toolcraft root, wrap
      with `codeMode(root)`, drive each meta-tool through
      `createSDK(codeMode(root))`, and assert the end-to-end paths
      (search returns expected paths; get_schemas returns expected
      shape; execute runs a tiny script that calls two fixture
      commands and returns a derived value).
    status:
      implement: done
      test: done
      commit: done
  - id: package-readme
    title: Write the toolcraft-codemode README
    prompt: |
      Overwrite `packages/toolcraft-codemode/README.md` with the full
      package README. Required sections (in this order):

        1. Title + one-line pitch ("Code-mode meta-tools for toolcraft
           trees, sandboxed by agent-script.").
        2. Why — the two scaling problems code-mode addresses (catalog
           context bloat, intermediate-token waste); cite that the
           sandbox is `@poe-code/agent-script`, not a custom runtime.
        3. Install + hello world: 10-line snippet wiring
           `codeMode(root)` into `runMCP`.
        4. Meta-tools: one short subsection each for `search`,
           `get_schemas`, `execute`. Params + return shape. No prose
           padding.
        5. The agent-script subset the model must respect — link to
           `packages/agent-script/README.md`, do not restate the
           grammar.
        6. Options: `CodeModeOptions` table with each field, default,
           and what it controls.
        7. Env vars: none. Config: none — options-only.

      Constraints (CLAUDE.md / memory):
        - Dense prose. No restating what toolcraft or agent-script
          docs already say.
        - No emojis.
        - Do not document features that don't exist (no tags, no
          `validate` meta-tool, no `get_tags`, no `list_tools`).
        - Mention that the model's script return value is the
          execute tool's result; lint failures come back as a
          structured response, not an exception.

      No tests for the README.
    status:
      implement: done
      commit: done
name: toolcraft-codemode
state: archived
---

# Context

New package `toolcraft-codemode` providing FastMCP-style "code mode"
meta-tools over any toolcraft `Group`. The sandbox is
`@poe-code/agent-script` — deterministic JS subset, budgets,
explicit-module capability, snapshots, cancellation. No custom sandbox.

## Meta-tool surface (final)

1. `search` — BM25 over command name + description + path. Detail
   levels brief/detailed/full.
2. `get_schemas` — JSON schemas for a list of dotted command paths.
3. `execute` — runs `lint()` then `run()` from agent-script. Lint
   errors return as structured diagnostics; runtime errors return as
   structured errors; success returns the script's `returnValue`.

Explicitly **not** included: tags, `get_tags`, `list_tools`, a
separate `validate` meta-tool. Lint runs inside `execute`; a separate
tool is redundant.

## How tools reach the sandbox

One agent-script module per toolcraft group, named by dotted path
(e.g. `"pulls.reviews"`); each command is a named export. Dispatch
flows through `createSDK(root)` so secrets, requires, humanInLoop, and
progress cascade as they do for any other toolcraft surface.

## Out of scope for this plan

- CLI surface for the meta-tools (script-as-CLI-flag is not a real use
  case).
- Tag-based discovery.
- Streaming progress from individual tool calls inside a script back
  to the MCP client.
- Resumable scripts via agent-script snapshots — possible later, but
  the meta-tool semantics stay single-shot for now.
