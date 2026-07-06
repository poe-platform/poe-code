---
kind: pipeline
version: 1
tasks:
  - id: cmdkit-schema
    title: cmdkit-schema package
    prompt: >
      Create `packages/cmdkit-schema` — a zero-dependency package with its own `package.json` and
      README.


      Implement the `S` schema builder:
        - `S.String({ description?, default? })`
        - `S.Number({ description?, default? })`
        - `S.Boolean({ description?, default? })`
        - `S.Enum(values[], { description?, default? })`
        - `S.Array(itemSchema, { description?, default? })`
        - `S.Object({ [key]: schema })`
        - `S.Optional(schema)` — wraps any schema as optional

      Each builder returns a typed descriptor object.

      `Static<typeof schema>` infers the TypeScript type.

      Every schema can be serialised to standard JSON Schema via `toJsonSchema(schema)`.


      Required arrays: properties not wrapped in `S.Optional` are listed in `required[]`.

      Nested `S.Object` schemas produce nested JSON Schema objects.

      Default values are included in the JSON Schema output as `default`.


      Export all builders and types from the package root.

      Write unit tests covering type inference and JSON Schema output for all schema types.
    status:
      implement: done
      refactor: done
      test: done
      commit: done
  - id: cmdkit-define
    title: defineCommand + defineGroup core types
    prompt: >
      Create `packages/cmdkit` — depends on `cmdkit-schema`. Add its own `package.json` and README.


      Implement `defineCommand(config)` and `defineGroup(config)`.


      `defineCommand` accepts:
        - `name: string`
        - `description?: string`
        - `aliases?: string[]`
        - `positional?: string[]` — param names mapped from positional CLI args
        - `params: S.Object(...)` — parameter schema
        - `secrets?: Record<string, { env: string; description?: string; optional?: boolean }>`
        - `scope?: Array<'cli' | 'mcp' | 'sdk'>` — defaults to `['cli', 'sdk']`
        - `confirm?: boolean` — defaults to `false`
        - `requires?: { auth?: boolean; apiVersion?: string; check?: (ctx) => Promise<{ ok: boolean; message?: string }> }`
        - `handler: (ctx: HandlerContext) => Promise<unknown>`
        - `render?: { rich?: (result, primitives) => void; markdown?: (result) => string; json?: (result) => unknown }`

      `defineGroup` accepts:
        - `name`, `description`, `aliases`, `scope`, `secrets`, `requires`
        - `children: Array<Command | Group>` — the command tree
        - `default?: Command` — forwarded when first token doesn't match any child name/alias

      `HandlerContext` type:
        - `params` — inferred from the params schema
        - `secrets` — inferred from the secrets declaration
        - `fetch` — `typeof globalThis.fetch`
        - `fs` — `{ readFile, writeFile, exists }`
        - `env` — `{ get(key: string): string | undefined }`
        - `progress(message: string): void`
        - plus any custom service keys passed at runner init

      Secrets and `requires` declared on a group are inherited by all descendants.

      Scope declared on a group is inherited by descendants that don't override it.


      Export `defineCommand`, `defineGroup`, `UserError`, and all types from the package root.

      Write unit tests for inheritance of secrets, scope, and requires through group nesting.
    status:
      implement: done
      refactor: done
      test: done
      commit: done
  - id: cli-runner
    title: CLI runner (runCLI)
    prompt: >
      In `packages/cmdkit`, implement `runCLI(root, options?)` exported from `cmdkit/cli`.


      Options:
        - `casing?: 'kebab' | 'snake'` — defaults to `kebab`
        - `services?: Record<string, unknown>` — custom services injected into handler context
        - `version?: string`

      Behaviour:
        - Use `commander` for arg parsing. Build the Commander program by recursively walking the command tree.
        - Map `S.Object` param fields to Commander options respecting `casing`. Nested objects use dot-notation flags (`--database.host`).
        - `S.Enum` fields become choices-validated options.
        - `S.Boolean` fields become `--flag / --no-flag` pairs.
        - `S.Array` fields accept multiple values (space or comma-separated).
        - Required params (not `S.Optional`, no `default`) without a CLI value trigger an interactive prompt using the project's design system (NOT `@clack/prompts` or `chalk` directly — use `@poe-code/design-system`).
        - `S.Optional` params are never prompted.
        - Params with a `default` are prompted with the default pre-filled; pressing enter accepts.
        - `S.Enum` interactive prompt renders as a select list.
        - When `--yes` is passed or `stdin` is not a TTY, prompts are skipped and defaults are used. Missing required params without a default produce a validation error.
        - Global flags added automatically: `--yes`, `--output <rich|md|json>`, `--help`, `--version`.
        - Output format auto-switches to `json` when `stdout` is not a TTY.
        - Validate reserved service name collisions at startup and throw with a clear message.

      Confirmation (when `confirm: true`):
        - Display the resolved param values using the design system.
        - Prompt "Proceed? (Y/n)". Skip when `--yes` is set.

      Run the handler with the resolved context. Catch errors:
        - `UserError` → print red message, exit 1.
        - Any other throw → print red message + hint to use `--verbose`, exit 1.
        - In `--verbose` mode print the stack trace.

      Write unit tests for arg parsing, casing conversion, TTY detection, and error handling.
    status:
      implement: done
      refactor: done
      test: done
      commit: done
  - id: output-rendering
    title: Auto output rendering (rich / md / json)
    prompt: |
      In `packages/cmdkit`, implement the auto-renderer used by all runners.

      After the handler returns, inspect the return value shape and render using `@poe-code/design-system` primitives:

      | Return shape       | rich CLI                                    | markdown                  | json                   |
      |--------------------|---------------------------------------------|---------------------------|------------------------|
      | `object`           | key-value table via `renderTable()`         | `- key: value` list       | `JSON.stringify`       |
      | `array of objects` | table with columns via `renderTable()`      | markdown table            | `JSON.stringify`       |
      | `string`           | printed as-is                               | printed as-is             | `{"result":"..."}`     |
      | `null/undefined`   | "Done."                                     | "Done."                   | `{"ok":true}`          |

      When the command defines `render.rich`, `render.markdown`, or `render.json` overrides, call those instead of the auto renderer for that format. Pass the design system primitives as the second argument.

      The renderer is format-agnostic: the active format (`rich` | `md` | `json`) is set by the runner before calling the renderer.

      Write unit tests covering each return shape × format combination.
    status:
      implement: done
      refactor: done
      test: done
      commit: done
  - id: secrets-and-requires
    title: Secrets resolution + requirements checking
    prompt: >
      In `packages/cmdkit`, implement two runner-level pre-flight checks run before prompting for
      params.


      **Secrets resolution**
        - Collect secrets from the matched command + all ancestor groups (inheritance).
        - For each secret, read `process.env[secret.env]`.
        - Required secrets (no `optional: true`) that are missing abort with:
          ```
          Error: Missing required secret <ENV_VAR>
            <description if provided>
          ```
        - Optional secrets are passed as `undefined` if missing.

      **Requirements checking**
        - `auth: true` — check that `POE_API_KEY` (or the auth env var) is present. On failure:
          ```
          Error: Command "<name>" requires authentication.
            Run 'poe-code login' first.
          ```
        - `apiVersion: '>=X.Y.Z'` — compare against the server API version (injected via runner option `apiVersion`). On failure print a clear semver mismatch message.
        - `check: async (ctx) => { ok, message }` — call the function; on `ok: false` print `message` and abort.

      Both checks are shared logic used by CLI, MCP, and SDK runners. Expose as internal helper
      functions.


      Write unit tests for each failure path.
    status:
      implement: done
      refactor: done
      test: done
      commit: done
  - id: fixtures
    title: Fixture mode (CMDKIT_FIXTURE)
    prompt: >
      In `packages/cmdkit`, implement fixture mode. Triggered exclusively by the `CMDKIT_FIXTURE`
      env var; no CLI flag.


      When `CMDKIT_FIXTURE` is set:
        1. Locate the fixture file co-located with the command file: same path, `.fixture.json` extension.
        2. Parse the JSON array of scenarios.
        3. Select the scenario: if `CMDKIT_FIXTURE` is a number, use it as a 1-based index; if a string, match `scenario.name`.
        4. Replace the built-in `fetch` service with a mock that matches requests against `scenario.services.fetch` entries (method + URL). Unmatched reads return `null`; unmatched writes succeed silently.
        5. Replace `fs` with a mock driven by `scenario.services.fs`.
        6. Custom services listed in `scenario.services` are replaced with mocks matching the service's fixture schema.
        7. Services not mentioned in the scenario fall back to safe no-ops.
        8. Secrets are not required in fixture mode (all resolve to a dummy string).
        9. The header in rich output appends `(fixture)` to the command name.

      Fixture file format:

      ```json

      [
        {
          "name": "scenario name",
          "services": {
            "fetch": [
              { "request": { "method": "GET", "url": "..." }, "response": { "status": 200, "body": {} } }
            ],
            "fs": {
              "readFile": { "/path": "content" }
            }
          }
        }
      ]

      ```


      Write unit tests for scenario selection, fetch matching, and no-op fallback behaviour.
    status:
      implement: done
      refactor: done
      test: done
      commit: done
  - id: mcp-runner
    title: MCP runner (runMCP)
    prompt: >
      In `packages/cmdkit`, implement `runMCP(root, options)` exported from `cmdkit/mcp`.


      Options:
        - `name: string` — MCP server name
        - `version: string`
        - `tools?: string[]` — allowlist of command names/paths to expose (e.g. `['usage', 'generate', 'bot.create']`). When a group name is listed, all its descendants are included.
        - `services?: Record<string, unknown>`
        - `casing?: 'snake' | 'camel'` — defaults to `snake`

      A command is exposed as an MCP tool only when:
        1. Its effective `scope` includes `'mcp'`.
        2. It matches the `tools` allowlist (or an ancestor does), or `tools` is omitted.

      For each eligible command:
        - Tool `name`: join group names + command name with `.` separators.
        - Tool `description`: command `description` + parameter summary.
        - `inputSchema`: JSON Schema produced by `toJsonSchema(command.params)` from `cmdkit-schema`, with casing applied to property keys.

      On tool call:
        - Run secrets resolution and requirements checks.
        - Validate the input against the param schema.
        - Call the handler with the resolved context.
        - Return the result serialised as the MCP tool result.
        - `confirm` is ignored.
        - `progress()` calls are no-ops.
        - Errors map to MCP error responses with appropriate codes.

      Write unit tests for tool enumeration (scope + tools filter) and error mapping.
    status:
      implement: done
      refactor: done
      test: done
      commit: done
  - id: sdk-runner
    title: SDK runner (createSDK)
    prompt: >
      In `packages/cmdkit`, implement `createSDK(root, options?)` exported from `cmdkit/sdk`.


      Options:
        - `services?: Record<string, unknown>`
        - `casing?: 'camel'` — defaults to `camel`

      `createSDK` walks the command tree and returns a nested object mirroring the group structure.

      Each command becomes an async function: `sdk.group.subgroup.commandName(params) =>
      Promise<ReturnType>`.


      Command names and param keys are converted to `camelCase`.

      Only commands with `'sdk'` in their effective scope are included.


      The returned function:
        - Runs secrets resolution and requirements checks.
        - Calls the handler with the resolved context.
        - Returns the result typed from the handler's inferred return type.
        - `confirm` is ignored. `progress()` is a no-op (caller can subscribe if needed in the future).
        - Throws `UserError` or re-throws unhandled errors directly.

      The SDK object is fully typed: `poeCode.generate.text({ prompt: string }) => Promise<{ model:
      string, content: string }>`.

      TypeScript must catch calls to non-existent methods and wrong param types.


      Write unit tests for nested method resolution, camelCase conversion, and scope filtering.
    status:
      implement: done
      refactor: done
      test: done
      commit: done
  - id: help-generation
    title: Auto-generated help text
    prompt: >
      In the CLI runner (`packages/cmdkit`), implement auto-generated `--help` output. No manual
      help text anywhere.


      For a group (`poe-code --help` / `poe-code generate --help`):

      ```

      poe-code generate

        Generate content via Poe API.
        Requires: authentication        ← when requires.auth: true

      Commands:
        text           Generate text
        image          Generate an image

      Global options:
        --yes          Accept defaults, skip prompts
        --output       Output format (rich, md, json)
        --help         Show help
        --version      Show version
      ```


      For a leaf command (`poe-code generate text --help`):

      ```

      poe-code generate text

        Generate text.

      Options:
        --prompt <string>          Generation prompt (required)
        --model <string>           Model identifier (default: GPT-4.1)

      Secrets (via environment):
        POE_API_KEY                Inherited from generate group
      ```


      Rules:
        - Breadcrumb path is built from root → current node names.
        - Aliases shown next to command name in the listing.
        - Secrets section lists all inherited + own secrets with their `env` name and `description`.
        - "Requires: authentication" note appears when `requires.auth: true` anywhere in the ancestor chain.
        - Only commands within the active runner's scope are shown.
        - Help is rendered using `@poe-code/design-system`, not raw `console.log`.

      Write unit tests for breadcrumb generation, secrets inheritance display, and scope filtering
      in help.
    status:
      implement: done
      refactor: done
      test: done
      commit: done
  - id: presets
    title: Preset JSON file support
    prompt: >
      In `packages/cmdkit` CLI runner, implement `--preset <path>` support.


      Behaviour:
        - Load and parse the JSON file at the given path.
        - Validate that the keys are valid param names for the current command (unknown keys are an error).
        - Merge order: preset defaults → CLI flags → interactive prompts for still-missing required params.
        - `--preset` can be combined with any other flag; explicit flags override preset values.
        - If the file does not exist or is invalid JSON, print a clear error and exit 1.

      Example:

      ```bash

      poe-code deploy --preset presets/staging.json

      poe-code deploy --preset presets/staging.json --replicas 5   # override replicas

      ```


      Example preset file:

      ```json

      { "service": "api", "region": "us-east-1", "replicas": 1 }

      ```


      Write unit tests for merge order, unknown key validation, and file-not-found error.
    status:
      implement: done
      refactor: done
      test: done
      commit: done
---

# cmdkit

Archived local pipeline plan converted from YAML during docs cleanup.
