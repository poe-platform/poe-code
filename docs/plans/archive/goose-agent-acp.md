# Plan: Add Goose as an ACP-first agent

## Goal

Add Goose to `poe-code` as a first-class agent using **ACP as the primary spawn path**.

This plan covers:

- install
- configure
- test
- spawn via ACP
- MCP support
- skills support

This plan intentionally treats Goose as a **normal `poe-code` integration** with Goose-specific config/mapping work, not as a one-off exception.

---

## Verified facts

These were re-checked against the current `poe-code` and Goose source trees.

### Goose configuration and install

- Goose CLI binary is `goose`.
- Goose config file is:
  - macOS/Linux: `~/.config/goose/config.yaml`
  - Windows: `%APPDATA%\Block\goose\config\config.yaml`
- Goose can store secrets in:
  - environment variables
  - keyring
  - `secrets.yaml` fallback
- Setting `GOOSE_DISABLE_KEYRING: true` in `config.yaml` is enough to force file-based secrets.
- Goose custom providers live in:
  - `~/.config/goose/custom_providers/*.json`
- Goose CLI install options already documented upstream:
  - `curl -fsSL https://github.com/block/goose/releases/download/stable/download_cli.sh | bash`
  - `brew install block-goose-cli`
- Goose source build path is valid:
  - `cargo build`
  - `cargo run -p goose-cli -- ...`

### Goose ACP

- Goose has a native ACP server: `goose acp`.
- `goose acp` advertises:
  - session support
  - load session support
  - MCP HTTP capability (`http: true`)
  - ACP auth methods
- Goose ACP **does implement authenticate**; `skipAuth` is **not** needed.
- Goose ACP new sessions load enabled extensions from `config.yaml` and then merge any builtins passed to `goose acp --with-builtin ...`.
- Goose ACP accepts MCP servers in `session/new` and converts them to Goose extensions.
- Goose ACP exposes custom extension methods, including:
  - `_goose/config/extensions`
  - `_goose/extensions/add`
  - `_goose/extensions/remove`
  - `_goose/session/provider/update`

### Goose extensions / MCP / skills

- Goose stores persistent MCP-like configuration under `extensions:` in `config.yaml`.
- Goose extension entry types include:
  - `stdio`
  - `streamable_http`
  - `builtin`
  - `platform`
- Goose does **not** support SSE for extensions anymore.
- Goose skills now require the **Summon** platform extension.
- Recommended Goose skill directories are:
  - local: `.agents/skills`
  - global: `~/.agents/skills`
- Goose still supports several legacy skill directories, but `.agents/skills` is the recommended standard.
- The **Developer** and **Summon** platform extensions are both marked upstream as `default_enabled: true`, but `poe-code` should not rely on Goose bootstrapping them for us — we should write them explicitly when needed.

### Current `poe-code` state

- `packages/config-mutations` currently supports only `json` and `toml` formats.
- `packages/agent-mcp-config` currently supports only `json` and `toml` config files.
- `packages/agent-mcp-config` already supports both MCP transports at the data model level:
  - `stdio`
  - `http`
- `packages/agent-spawn` already supports ACP spawn and already passes MCP servers in `session/new`.
- `packages/poe-acp-client` already supports:
  - ACP auth
  - MCP HTTP server types
  - custom extension requests via `sendExtRequest()`
- **Important shared gap:** current ACP spawn code in `packages/agent-spawn/src/acp/spawn-acp.ts` does **not** use `options.model`.
  - This is already a shared ACP limitation, not a Goose-only problem.
- Current spawn-time MCP input type in `packages/agent-spawn` is still stdio-shaped (`{command,args?,env?}`), so HTTP MCP at spawn is not yet fully modeled there, even though `poe-acp-client` and Goose ACP can support it.

---

## Decisions

## 1. Use ACP as the primary Goose spawn path

Do **not** build Goose support around `stream-json`.

Implementation target:

- add `AcpSpawnConfig` for Goose
- use `goose acp`
- treat CLI `goose run` only as a fallback for manual debugging, not as the main integration path

## 2. Configure Goose through a custom Poe provider

Do **not** overload Goose’s built-in `openai` provider.

Write a custom provider file:

- `~/.config/goose/custom_providers/custom_poe.json`

and set:

- `GOOSE_PROVIDER: custom_poe`
- `GOOSE_MODEL: <selected-model>`

## 3. Use file-based secrets only

For `poe-code`, force the simple path:

- write `GOOSE_DISABLE_KEYRING: true`
- write API key to `~/.config/goose/secrets.yaml`

No keyring integration in phase 1.

## 4. Treat MCP as required for support

Goose support is not considered complete without MCP.

That means phase 1 must include:

- persistent MCP config in `config.yaml`
- ACP-session MCP injection support for the currently supported spawn MCP abstraction

## 5. Treat skills as required enough to wire from the start

Skills support should include:

- `~/.agents/skills`
- `.agents/skills`
- explicit enablement of Summon in Goose config

---

## Goose-specific config shapes to write

## A. `config.yaml`

Minimum managed keys:

```yaml
GOOSE_DISABLE_KEYRING: true
GOOSE_PROVIDER: custom_poe
GOOSE_MODEL: openai/gpt-5.4
extensions:
  developer:
    enabled: true
    type: platform
    name: developer
    description: Write and edit files, and execute shell commands
    display_name: Developer
    bundled: true
    available_tools: []
  summon:
    enabled: true
    type: platform
    name: summon
    description: Load knowledge and delegate tasks to subagents
    display_name: Summon
    bundled: true
    available_tools: []
```

Notes:

- `developer` is required for useful ACP file/shell workflows.
- `summon` is required for skills.
- MCP entries will also be written under the same `extensions:` map.

## B. `secrets.yaml`

```yaml
CUSTOM_POE_API_KEY: <poe api key>
```

## C. `custom_providers/custom_poe.json`

```json
{
  "name": "custom_poe",
  "engine": "openai",
  "display_name": "Poe",
  "description": "Poe OpenAI-compatible API",
  "api_key_env": "CUSTOM_POE_API_KEY",
  "base_url": "https://api.poe.com/v1/chat/completions",
  "models": [
    { "name": "openai/gpt-5.4", "context_limit": 128000 }
  ],
  "supports_streaming": true,
  "requires_auth": true
}
```

Notes:

- The `models` array should be generated from `src/cli/constants.ts`, not hardcoded ad hoc.
- Use the exact Poe model IDs that `poe-code` already exposes.

---

## MCP plan

## Scope

Support both:

1. **persistent MCP config** via `poe-code mcp ...`
2. **ACP-session MCP injection** for spawn flows

## Persistent MCP config for Goose

Add Goose to `packages/agent-mcp-config` with a Goose-specific YAML shape.

### Config file

- macOS/Linux: `~/.config/goose/config.yaml`
- Windows: `~/AppData/Roaming/Block/goose/config/config.yaml` (through platform resolver)

### Config key

- `extensions`

### Required new format support

Add `yaml` support to:

- `packages/config-mutations`
- `packages/agent-mcp-config`

### Required new shape

Add a new `goose` shape transformer in `packages/agent-mcp-config/src/shapes.ts`.

#### Stdio MCP server

Input:

```ts
{
  name: "github",
  config: {
    transport: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-github"],
    env: { GITHUB_PERSONAL_ACCESS_TOKEN: "..." }
  }
}
```

Output under `extensions.github`:

```yaml
github:
  enabled: true
  type: stdio
  name: github
  description: github
  cmd: npx
  args:
    - -y
    - "@modelcontextprotocol/server-github"
  envs:
    GITHUB_PERSONAL_ACCESS_TOKEN: ...
  timeout: 300
  available_tools: []
```

#### HTTP MCP server

Input:

```ts
{
  name: "remote",
  config: {
    transport: "http",
    url: "https://example.com/mcp",
    headers: { Authorization: "Bearer ..." }
  }
}
```

Output under `extensions.remote`:

```yaml
remote:
  enabled: true
  type: streamable_http
  name: remote
  description: remote
  uri: https://example.com/mcp
  headers:
    Authorization: Bearer ...
  envs: {}
  timeout: 300
  available_tools: []
```

### Key choice

Use Goose-style normalized extension keys, i.e. the equivalent of Goose’s `name_to_key(name)`.

That keeps `poe-code` output aligned with Goose’s own config behavior.

## ACP-session MCP injection

### What already works

`packages/agent-spawn` already sends MCP servers in ACP `session/new`.

Goose ACP already converts session MCP servers into Goose extension configs.

### What to support in phase 1

- stdio MCP servers over ACP session/new

### What is a shared follow-up

If we want HTTP MCP servers at spawn time through `poe-code spawn`, widen the generic spawn MCP types in `packages/agent-spawn` from stdio-only to a union that also models HTTP.

This is a **shared ACP improvement**, not a Goose-specific hack.

---

## Skills plan

Add Goose to `packages/agent-skill-config` as:

```ts
{
  globalSkillDir: "~/.agents/skills",
  localSkillDir: ".agents/skills"
}
```

### Additional configure behavior

`poe-code configure goose` must ensure the `summon` platform extension is enabled in Goose config.

### Do not use legacy skill directories

Do not expose legacy Goose skill directories in `poe-code`.

Use the standard Agent Skills directories only:

- `~/.agents/skills`
- `.agents/skills`

That matches the current Goose docs and keeps skills portable across agents.

---

## ACP model/provider plan

This is the most important shared ACP gap surfaced by Goose.

## Verified issue

`packages/agent-spawn/src/acp/spawn-acp.ts` currently ignores `options.model`.

That means a Goose ACP integration would otherwise only use the default model from `config.yaml`.

## Required behavior

`poe-code spawn goose --model ...` and SDK `spawn({ model })` must work.

## Recommended implementation

Add a post-session initialization hook to ACP spawn configs.

Example shape:

```ts
interface AcpSpawnConfig {
  kind: "acp";
  agentId: string;
  acpArgs: string[];
  skipAuth?: boolean;
  mcpEnv?: ...;
  afterNewSession?: (args) => Promise<void>;
}
```

Then Goose can use:

- `client.sendExtRequest("_goose/session/provider/update", ...)`

with:

- `sessionId`
- `provider: "custom_poe"`
- `model: <resolved-model>`

### Why this is the right approach

- uses Goose’s own supported ACP extension method
- keeps Goose ACP as the main path
- preserves CLI/SDK model parity
- avoids inventing Goose-only env hacks for spawn-time model selection

### Minimal fallback if we want to phase this

Phase 1 can configure the default model correctly in `config.yaml`, but the plan should still treat per-spawn model override as required work before calling Goose support complete.

---

## Install plan

Add Goose install support in `src/providers/goose.ts`.

### Binary check

- binary name: `goose`

### Install steps

Use platform-specific install commands:

#### macOS / Linux

```sh
sh -c 'curl -fsSL https://github.com/block/goose/releases/download/stable/download_cli.sh | CONFIGURE=false bash'
```

#### Windows

Use the PowerShell installer path documented upstream.

### Why `CONFIGURE=false`

`poe-code` should own configuration. Installer should only install the binary.

---

## Concrete file plan

## 1. Agent definition

Add:

- `packages/agent-defs/src/agents/goose.ts`
- export from `packages/agent-defs/src/agents/index.ts`
- register in `packages/agent-defs/src/registry.ts`

Proposed basics:

- `id: "goose"`
- `name: "goose"`
- `label: "Goose"`
- `binaryName: "goose"`
- `configPath: "~/.config/goose/config.yaml"`

## 2. Provider

Add:

- `src/providers/goose.ts`

Responsibilities:

- configure custom Poe provider
- write `config.yaml`
- write `secrets.yaml`
- enable `developer`
- enable `summon`
- install Goose
- custom ACP-aware health check

## 3. Shared config mutation support

Extend:

- `packages/config-mutations/src/types.ts`
- `packages/config-mutations/src/mutations/config-mutation.ts`
- `packages/config-mutations/src/formats/*`
- `packages/config-mutations/src/execution/apply-mutation.ts`
- related tests

Add `yaml` as a supported config format.

## 4. MCP config package

Extend:

- `packages/agent-mcp-config/src/configs.ts`
- `packages/agent-mcp-config/src/shapes.ts`
- `packages/agent-mcp-config/src/apply.ts`
- tests

Add:

- `format: "yaml"`
- `shape: "goose"`

## 5. Skill config package

Extend:

- `packages/agent-skill-config/src/configs.ts`
- tests

Add Goose skill directory mapping.

## 6. ACP spawn config

Add:

- `packages/agent-spawn/src/configs/goose.ts`
- register in `packages/agent-spawn/src/configs/index.ts`

Proposed config:

```ts
{
  kind: "acp",
  agentId: "goose",
  acpArgs: ["acp"]
}
```

No `skipAuth`.

## 7. Shared ACP post-session hook

Extend:

- `packages/agent-spawn/src/types.ts`
- `packages/agent-spawn/src/acp/spawn-acp.ts`
- tests

So Goose can call `_goose/session/provider/update` after session creation.

## 8. CLI constants

Extend:

- `src/cli/constants.ts`

Add a Goose model list + default, probably derived from existing frontier/Poe-safe model list rather than inventing a Goose-only list.

---

## Test plan

## Unit tests

### `packages/config-mutations`

- YAML detect/parse/serialize/merge/prune/transform
- preserve unrelated YAML keys
- deep merge `extensions`

### `packages/agent-mcp-config`

- Goose stdio entry serialization
- Goose HTTP entry serialization
- Goose unconfigure removes only the target extension entry
- existing `developer` / `summon` entries remain untouched

### `packages/agent-skill-config`

- Goose global/local skill dir resolution

### `packages/agent-spawn`

- Goose ACP config resolution
- Goose ACP spawn path uses `goose acp`
- Goose post-session hook sends `_goose/session/provider/update`
- Goose ACP new session receives MCP servers

### `src/providers/providers.test.ts`

- configure writes:
  - `config.yaml`
  - `secrets.yaml`
  - `custom_providers/custom_poe.json`
- unconfigure behavior, if included
- install definition

## Spot tests

- `npm run dev -- configure goose --yes`
- `npm run dev -- test goose`
- `npm run dev -- spawn goose "Output exactly: GOOSE_OK"`
- `npm run dev -- mcp add goose ...`
- `npm run dev -- skill add goose ...` if applicable to existing commands

## Screenshot checks

Required for any CLI UX touched by Goose integration:

- `npm run screenshot-poe-code -- configure goose`
- `npm run screenshot-poe-code -- spawn goose "hello"`
- any MCP/skills command UX touched

---

## Phase order

## Phase 1 — shared prerequisites

1. add YAML support to `config-mutations`
2. add YAML support to `agent-mcp-config`
3. add Goose MCP shape

## Phase 2 — configure/install/skills

1. add Goose agent definition
2. add `src/providers/goose.ts`
3. write custom provider + config + secrets
4. add Goose skill dir mapping
5. ensure `developer` + `summon`
6. add install definition

## Phase 3 — ACP spawn

1. add Goose ACP spawn config
2. verify `goose acp` works through existing `spawnAcp`
3. add Goose-specific post-session provider/model update hook
4. add ACP-based health check

## Phase 4 — MCP end-to-end validation

1. persistent MCP config via `poe-code mcp`
2. ACP session stdio MCP injection
3. optional follow-up: widen spawn MCP types for HTTP MCP injection

---

## Risks / caveats

## 1. ACP model override is not currently wired

This is the biggest implementation risk, but it is contained and has a clean Goose-native solution via `_goose/session/provider/update`.

## 2. YAML support is a shared-package change

This is not risky conceptually, but it is a shared surface and should land first with focused tests.

## 3. Spawn-time HTTP MCP is a generic follow-up

Goose ACP supports HTTP MCP servers, but `packages/agent-spawn` still models spawn MCP input as stdio-only. If that matters for phase 1, widen the shared type. If not, ship persistent HTTP MCP first and stdio ACP injection first.

## 4. Do not over-prune Goose config

Unconfigure must not wipe unrelated Goose extensions, providers, or user-managed settings.

---

## Recommended delivery sequence

### Commit 1

- shared YAML support in `config-mutations`
- tests

### Commit 2

- Goose MCP YAML config support in `agent-mcp-config`
- tests

### Commit 3

- Goose agent definition + provider configure/install + skills mapping
- tests

### Commit 4

- Goose ACP spawn config + ACP post-session provider/model hook
- tests

### Commit 5

- spot tests + screenshots + final doc cleanup

---

## Future follow-up: Goose ACP plugin support

Not required for initial Goose agent support, but worth noting:

Goose ACP already exposes custom methods for extension/config management. That makes a future `poe-code` Goose plugin plausible without shelling into config files for every operation.

Possible future direction:

- a Goose-specific plugin/client that uses `_goose/config/extensions`, `_goose/extensions/add/remove`, and `_goose/session/provider/update`
- use file mutation as the compatibility baseline, ACP extension methods as the richer path

