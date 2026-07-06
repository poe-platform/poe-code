# Goose Agent Investigation

> Note: this investigation was the earlier research pass. The implementation direction moved through the archived [Goose ACP plan](../plans/archive/goose-agent-acp.md), which superseded the earlier CLI/`stream-json` framing and treated Goose as an ACP-first integration.

## Scope

This document investigates two separate questions:

1. **How to install and configure Goose to use Poe today**
2. **What it would take to add Goose as a first-class agent in `poe-code`**

Reference point for implementation expectations: [`docs/ADDING_AGENT.md`](../ADDING_AGENT.md).

---

## Executive Summary

- **Manual Goose + Poe setup is very feasible today.**
- The cleanest provider path is a **Goose custom provider** (`engine: "openai"`) pointed at Poe.
- For **`poe-code` first-class support**, Goose should be treated as a **normal ACP-capable integration**, not as an exceptional case.
- The real work is mostly shared/config work:
  - **YAML config mutation support**
  - Goose `extensions:` mapping for **MCP**
  - file-based secrets fallback via `secrets.yaml`
  - skill directory wiring plus explicit **Summon** enablement
- The correct spawn strategy is **ACP-first** via `goose acp`, not CLI `stream-json`.
- **Recommendation:** implement Goose in `poe-code` through:
  1. custom provider configuration
  2. YAML config support
  3. MCP + skills support
  4. ACP spawn

---

## 1. Installing Goose

### Release installer

```bash
curl -fsSL https://github.com/block/goose/releases/download/stable/download_cli.sh | bash
```

Install without launching interactive configuration:

```bash
curl -fsSL https://github.com/block/goose/releases/download/stable/download_cli.sh | CONFIGURE=false bash
```

### Homebrew

```bash
brew install block-goose-cli
```

### From source

Goose’s CLI binary lives in `crates/goose-cli`.

```bash
cd /Users/kjopek/Workspace/open-source/goose
source ./bin/activate-hermit
cargo build
./target/debug/goose --help
```

For iteration:

```bash
cargo run -p goose-cli -- --help
```

---

## 2. How Goose Stores Configuration

### Main files

Goose primarily uses these files:

- macOS/Linux config: `~/.config/goose/config.yaml`
- Windows config: `%APPDATA%\Block\goose\config\config.yaml`
- permissions: `permission.yaml`
- secrets fallback: `secrets.yaml`
- custom providers: `~/.config/goose/custom_providers/*.json`

### Important config behavior

- `config.yaml` stores general settings such as:
  - `GOOSE_PROVIDER`
  - `GOOSE_MODEL`
  - `GOOSE_MODE`
  - `extensions`
- Secrets are read in this order:
  1. environment variables
  2. system keyring
  3. `secrets.yaml` fallback
- Regular config values are read in this order:
  1. environment variables
  2. `config.yaml`
  3. defaults

### Test isolation

Goose has a strong isolation story already:

```bash
GOOSE_PATH_ROOT=/tmp/goose-test goose session
```

This redirects Goose’s `config/`, `data/`, and `state/` directories under the temporary root. This is very useful for future `poe-code test` support.

---

## 3. Recommended Ways to Connect Goose to Poe

## Option A — Built-in OpenAI provider

This is the fastest path if you just want Goose to talk to Poe.

### Example `config.yaml`

```yaml
GOOSE_PROVIDER: openai
GOOSE_MODEL: openai/gpt-5.4
OPENAI_HOST: https://api.poe.com
OPENAI_BASE_PATH: v1/chat/completions
```

And then provide the Poe key as:

```bash
export OPENAI_API_KEY="<your-poe-api-key>"
```

### Safe host/path combinations

Because Goose joins `OPENAI_HOST` and `OPENAI_BASE_PATH`, these combinations matter:

#### Good

```yaml
OPENAI_HOST: https://api.poe.com
OPENAI_BASE_PATH: v1/chat/completions
```

#### Also good

```yaml
OPENAI_HOST: https://api.poe.com/v1
OPENAI_BASE_PATH: chat/completions
```

#### Risky

```yaml
OPENAI_HOST: https://api.poe.com/v1
OPENAI_BASE_PATH: v1/chat/completions
```

That last form is likely to produce a doubled `/v1/v1/...` path.

### Why this works

Goose’s OpenAI provider already supports:

- `OPENAI_HOST`
- `OPENAI_BASE_PATH`
- `OPENAI_API_KEY`
- `OPENAI_CUSTOM_HEADERS`

It also maps the models endpoint from the configured base path, so a `chat/completions` base path can still resolve model listing via `v1/models`.

### Downsides

- Poe is disguised as generic OpenAI inside Goose
- harder to keep a separate Goose-side identity for Poe
- more awkward if the user also uses normal OpenAI in Goose
- first-class `poe-code` support would be harder to unconfigure cleanly

---

## Option B — Goose custom provider (**recommended manual setup**)

This is the cleanest long-term setup for actual Goose users.

### Why this is better

- Poe appears as its **own provider** in Goose
- the API key can use a Poe-specific env var
- the model list can be explicitly controlled
- it avoids mutating Goose’s built-in OpenAI provider settings
- it aligns better with how Goose expects unsupported OpenAI-compatible endpoints to be integrated

### Example custom provider file

Create:

`~/.config/goose/custom_providers/custom_poe.json`

```json
{
  "name": "custom_poe",
  "engine": "openai",
  "display_name": "Poe",
  "description": "Poe OpenAI-compatible API",
  "api_key_env": "CUSTOM_POE_API_KEY",
  "base_url": "https://api.poe.com/v1/chat/completions",
  "models": [
    { "name": "openai/gpt-5.4", "context_limit": 128000 },
    { "name": "openai/gpt-5.3-codex", "context_limit": 400000 },
    { "name": "anthropic/claude-sonnet-4.6", "context_limit": 200000 }
  ],
  "supports_streaming": true,
  "requires_auth": true
}
```

Then set:

```yaml
GOOSE_PROVIDER: custom_poe
GOOSE_MODEL: openai/gpt-5.4
```

And export:

```bash
export CUSTOM_POE_API_KEY="<your-poe-api-key>"
```

### Notes

- The `models` list should contain **the exact model slugs Poe accepts**.
- If you want to avoid hardcoding the full endpoint in `base_url`, Goose custom providers also support `base_url` + optional `base_path` behavior, but the single full URL above is the simplest form.
- If Goose keyring storage is preferred, the provider can also be created through `goose configure` instead of hand-editing JSON.

---

## 4. Practical Commands to Validate a Poe-backed Goose Setup

### Quick smoke test

```bash
goose run --text "Reply with exactly: GOOSE_OK" --output-format text
```

### Structured output

```bash
goose run --text "Reply with exactly: GOOSE_OK" --output-format json
```

### Streaming output

```bash
goose run --text "Reply with exactly: GOOSE_OK" --output-format stream-json
```

### Stdin input

```bash
printf 'Reply with exactly: GOOSE_OK\n' | goose run --instructions - --output-format stream-json
```

### Explicit provider/model override

```bash
goose run \
  --provider custom_poe \
  --model openai/gpt-5.4 \
  --text "Reply with exactly: GOOSE_OK"
```

### Interactive session

```bash
goose session
```

### Resume

```bash
goose run --resume --text "continue"
# or

goose session --resume
```

---

## 5. Capability Mapping Against `poe-code`

| Feature from `docs/ADDING_AGENT.md` | Goose capability | Fit for `poe-code` | Notes                                                                          |
| ----------------------------------- | ---------------- | ------------------ | ------------------------------------------------------------------------------ |
| Configure                           | Yes              | Medium             | Needs YAML + possibly custom-provider JSON + secret handling.                  |
| Unconfigure                         | Partially        | Medium/Hard        | Must decide whether to remove YAML only, custom provider JSON, and/or secrets. |
| Models                              | Yes              | Good               | Goose supports provider/model selection directly.                              |
| Install                             | Yes              | Good               | Release script, Homebrew, source build.                                        |
| Test                                | Yes              | Good               | `goose run --text ...` is suitable for a health check.                         |
| Spawn (CLI)                         | Yes              | Good               | `goose run` looks viable for `agent-spawn`.                                    |
| Spawn (ACP)                         | Different        | Poor fit           | Goose is an ACP **server**, not an ACP adapter to another agent.               |
| Adapter                             | Probably         | Unknown            | `stream-json` may need a Goose-specific parser.                                |
| Stdin prompt                        | Yes              | Good               | `--instructions -` works.                                                      |
| Interactive mode                    | Yes              | Good               | `goose session` or `goose run -s`.                                             |
| Resume                              | Yes              | Good               | `--resume` supported.                                                          |
| MCP (config)                        | Yes              | Medium/Hard        | Stored under YAML `extensions`.                                                |
| MCP (spawn)                         | Yes              | Good               | `--with-extension`, `--with-streamable-http-extension`, `--with-builtin`.      |
| Skills                              | Yes              | Medium             | Goose discovers multiple skill directories, not a single fixed pair.           |
| Isolated env                        | Yes              | Excellent          | `GOOSE_PATH_ROOT` already exists.                                              |
| Templates                           | No clear need    | N/A                | Likely not needed.                                                             |

---

## 6. Why Goose Is Harder Than Existing `poe-code` Agents

Current supported agents in `poe-code` mostly fit one of these patterns:

- mutate one JSON/TOML config file
- install one CLI binary
- spawn with known prompt/model flags
- optionally pass MCP via CLI or write a single config key

Goose breaks that assumption in several ways.

### 6.1 Config is split across multiple storage layers

A realistic Goose setup may involve all of these at once:

- `config.yaml`
- `custom_providers/custom_poe.json`
- keyring or `secrets.yaml`
- `extensions` in YAML

### 6.2 YAML support is currently missing from `agent-mcp-config`

`packages/agent-mcp-config/src/configs.ts` currently supports only:

- `json`
- `toml`

Goose MCP configuration is YAML under:

- config file: `~/.config/goose/config.yaml`
- key: `extensions`

So first-class MCP config support for Goose requires YAML support in that package.

### 6.3 Secret handling is not just “write a file”

Goose prefers the OS keyring. If that is unavailable or disabled, it falls back to `secrets.yaml`.

For `poe-code`, this creates a design choice:

- write only environment-variable-based config and avoid secret persistence
- write `secrets.yaml`
- or integrate with Goose’s keyring expectations

That choice affects configure, unconfigure, and tests.

### 6.4 Goose custom providers are probably the right abstraction

If `poe-code` adds Goose, using Goose’s built-in OpenAI provider is technically possible, but a **Goose custom provider** is cleaner because it gives Poe a dedicated identity inside Goose.

That means configure support is not just “set a few YAML fields” — it may also need to create and maintain a JSON provider definition.

### 6.5 Skills do not map perfectly to current assumptions

`packages/agent-skill-config` currently expects one global and one local directory.

Goose scans several locations, including:

- local: `.goose/skills`, `.claude/skills`, `.agents/skills`
- global: `~/.agents/skills`, Goose config `skills/`, `~/.claude/skills`, `~/.config/agents/skills`

For `poe-code`, the best practical choice would probably be:

- local: `.agents/skills`
- global: `~/.agents/skills`

But that would still be a simplification of Goose’s actual discovery behavior.

---

## 7. Likely `poe-code` Implementation Shape

If Goose is added, these files are the likely touch points:

### Definitely needed

- `packages/agent-defs/src/agents/goose.ts`
- `packages/agent-defs/src/agents/index.ts`
- `packages/agent-defs/src/registry.ts`
- `src/providers/goose.ts`

### Likely needed

- `packages/agent-spawn/src/configs/goose.ts`
- `packages/agent-spawn/src/configs/index.ts`
- possibly `packages/agent-spawn/src/adapters/goose.ts`
- `src/cli/constants.ts`

### Needed only if supporting those features

- `packages/agent-mcp-config/src/configs.ts`
- `packages/agent-skill-config/src/configs.ts`

### Important architectural note

Goose is not a strong match for the ideal “one provider file and everything else derived automatically” goal yet.

The main reason is that Goose support would probably require new shared capabilities first:

- YAML config handling
- provider-definition file generation
- clearer secret-storage strategy

---

## 8. Recommended Implementation Options

## Option 1 — Documentation only

Do not add Goose as a first-class supported agent yet.

### Pros

- lowest risk
- no new YAML or keyring complexity in runtime code
- users can still use Goose manually with Poe immediately

### Cons

- no `poe-code configure goose`
- no `poe-code test goose`
- no `poe-code spawn goose`

### Verdict

Safe, but limited.

---

## Option 2 — Minimal first-class Goose support

Support only:

- install
- configure
- test
- spawn (CLI)
- isolated env

Defer:

- unconfigure
- MCP config file mutation
- skills
- ACP integration

### Recommended configuration strategy

Use a **Goose custom provider** named something like `custom_poe`.

That would let `poe-code configure goose` do roughly this:

1. ensure Goose is installed
2. create/update `custom_providers/custom_poe.json`
3. set `GOOSE_PROVIDER: custom_poe`
4. set `GOOSE_MODEL`
5. decide whether the API key is:
   - only passed via env, or
   - written to `secrets.yaml`

### Verdict

This is the best first implementation target.

---

## Option 3 — Full support

Support everything in the matrix, including:

- unconfigure
- MCP config writing
- skills
- maybe ACP-related workflows

### Requirements before this is sane

- YAML config mutation support in shared packages
- clear secret-storage policy
- tested Goose stream adapter behavior
- a decision on how much of Goose’s multi-directory skill behavior should be exposed

### Verdict

Possible, but not a good first step.

---

## 9. Recommended Direction

### For users today

Use Goose with Poe via a **Goose custom provider**.

### For `poe-code`

If Goose support is added, implement it in phases:

1. **configure + install + test + spawn (CLI)**
2. **isolated env** using `GOOSE_PATH_ROOT`
3. then decide whether to add:
   - unconfigure
   - MCP config support in YAML
   - skill config exposure

### Strong recommendation

If implementation work starts, prefer **custom provider JSON + YAML config** over repurposing Goose’s built-in OpenAI provider.

That choice is cleaner for:

- user mental model
- future maintenance
- unconfigure behavior
- keeping Poe separate from any real OpenAI configuration inside Goose

---

## 10. Sources Inspected

### `poe-code`

- `docs/ADDING_AGENT.md`
- `docs/research/agent-capabilities.md`
- `docs/research/mcp-agents.md`
- `src/providers/opencode.ts`
- `packages/agent-spawn/src/configs/opencode.ts`
- `packages/agent-mcp-config/src/configs.ts`
- `packages/agent-skill-config/src/configs.ts`
- `src/cli/constants.ts`
- `src/cli/environment.ts`

### `goose`

- `documentation/docs/getting-started/installation.md`
- `documentation/docs/getting-started/providers.md`
- `documentation/docs/guides/config-files.md`
- `documentation/docs/guides/cli-providers.md`
- `documentation/docs/guides/acp-providers.md`
- `documentation/docs/guides/acp-clients.md`
- `crates/goose-cli/src/cli.rs`
- `crates/goose-cli/src/session/mod.rs`
- `crates/goose-cli/src/session/output.rs`
- `crates/goose/src/config/base.rs`
- `crates/goose/src/config/paths.rs`
- `crates/goose/src/config/declarative_providers.rs`
- `crates/goose/src/providers/openai.rs`
- `crates/goose/src/providers/openai_compatible.rs`
- `crates/goose/src/providers/api_client.rs`
- `crates/goose/src/agents/platform_extensions/skills.rs`
- `download_cli.sh`
- `CONTRIBUTING.md`
