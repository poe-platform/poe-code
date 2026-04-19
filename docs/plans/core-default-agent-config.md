# `core.default_agent` Config Property

Add a config-driven default so users can skip the agent-selection prompt across the CLI.

## 1. What we're building

A new config property `core.default_agent`. When set, every command that today prompts the user to pick an agent skips that prompt and uses the configured value instead.

Precedence (user's words):
- `--agent` takes precedence over the config.
- If neither `--agent` nor `core.default_agent` is set, current behavior (prompt) is preserved.

Inventory of places where the agent is prompted today — every one of these is in scope:

| # | Command | Prompt location |
|---|---------|-----------------|
| 1 | `configure [agent]` | [src/cli/commands/configure.ts:173-212](src/cli/commands/configure.ts#L173-L212) (`resolveServiceArgument`) |
| 2 | `test [agent]` | [src/cli/commands/test.ts:37](src/cli/commands/test.ts#L37) (via `resolveServiceArgument`) |
| 3 | `install [agent]` | [src/cli/commands/install.ts:31](src/cli/commands/install.ts#L31) (via `resolveServiceArgument`) |
| 4 | `ralph run` / `ralph init` | [src/cli/commands/ralph.ts:436-455](src/cli/commands/ralph.ts#L436-L455) (`promptForAgent`) |
| 5 | `experiment run` | [src/cli/commands/experiment.ts:534-553](src/cli/commands/experiment.ts#L534-L553) (`promptForAgent`) |
| 6 | `experiment install` | [src/cli/commands/experiment.ts:936-940](src/cli/commands/experiment.ts#L936-L940) (inline `select()`) |
| 7 | `pipeline run` | [src/cli/commands/pipeline.ts:666-673](src/cli/commands/pipeline.ts#L666-L673) (inline `select()`) |
| 8 | `pipeline install` | [src/cli/commands/pipeline.ts:960-964](src/cli/commands/pipeline.ts#L960-L964) (inline `select()`) |
| 9 | `plan install` | [src/cli/commands/plan.ts:625-628](src/cli/commands/plan.ts#L625-L628) (`resolvePlanAgent`) |
| 10 | `skill configure` | [src/cli/commands/skill.ts:55-61](src/cli/commands/skill.ts#L55-L61) (inline `select()`) |
| 11 | `skill unconfigure` | [src/cli/commands/skill.ts:159-162](src/cli/commands/skill.ts#L159-L162) (inline `select()`) |
| 12 | `mcp configure` | [src/cli/commands/mcp.ts:106-110](src/cli/commands/mcp.ts#L106-L110) (inline `select()`) |

### Decisions

- Property name: `core.defaultAgent` (camelCase — matches global JSON config convention and the existing `apiKey` / `poeBaseUrl` keys in the `core` scope).
- Property lives under the existing `core` scope.
- Precedence (final):
  1. Explicit `--agent` / positional `<agent>` CLI input
  2. Frontmatter `agent:` field (ralph / experiment / pipeline plan docs)
  3. `core.defaultAgent` config
  4. `--yes` → hardcoded `DEFAULT_*_AGENT` constant
  5. Interactive prompt
- `core.defaultAgent` wins over `--yes`: if the user configured a default, `--yes` honors it rather than jumping to the hardcoded constant.
- Additive, no migration needed — empty default preserves current prompt behavior.

### Out of scope

- Renaming the existing snake_case keys (`plan_directory`, `tui`) to camelCase for consistency across scopes. Tracked separately — keeps this plan's blast radius small.

## 2. User-facing shape

### Setting the default

Three surfaces, same as every other scope property today — no new CLI commands.

**Via `config edit`** (opens the file in `$EDITOR`):

```
$ poe-code config edit
# user adds defaultAgent under "core":
{
  "core": {
    "apiKey": "…",
    "defaultAgent": "claude-code"
  }
}
```

**Via env var:**

```
$ POE_DEFAULT_AGENT=codex poe-code configure
```

**Via project-scoped config file** (`./.poe-code/config.json`):

```json
{
  "core": {
    "defaultAgent": "claude-code"
  }
}
```

`poe-code config show` already prints the merged document — users will see `core.defaultAgent` listed there once set.

### Behavior when set

Before (no config):

```
$ poe-code configure
? Pick an agent to configure: › (Use arrow keys)
❯   Claude Code
    Codex
    Gemini
```

After (`core.defaultAgent = claude-code`):

```
$ poe-code configure
▶ configure claude-code
  …runs immediately, no prompt…
```

### `--agent` still wins

```
$ poe-code configure --agent codex
▶ configure codex
```

### Frontmatter still wins (ralph / experiment / pipeline)

```yaml
---
agent: codex
---
```

```
$ poe-code ralph run plans/my-plan.md
▶ ralph run codex        # frontmatter outranks core.defaultAgent
```

### `--yes` respects the config

```
$ poe-code configure --yes
▶ configure claude-code   # uses core.defaultAgent, not the hardcoded constant
```

With no config set, `--yes` falls back to the hardcoded `DEFAULT_*_AGENT` as today.

### Error on invalid config value

```
$ POE_DEFAULT_AGENT=not-a-real-agent poe-code configure
✖ Invalid value for core.defaultAgent: "not-a-real-agent".
  Supported: claude-code, codex, gemini, …
```

Same error shape as today's `--agent not-a-real-agent`. Fails fast; does not fall through to the prompt.

### Commands affected

All 12 agent-prompt sites listed in level 1. No command gains a new flag or argument; the behavior change is uniform: the existing flow short-circuits whenever `core.defaultAgent` resolves to a valid agent.

### README section (draft)

> #### `core.defaultAgent`
>
> Agent used when no `--agent` flag is provided. Skips the interactive agent-selection prompt across `configure`, `test`, `install`, `ralph`, `experiment`, `pipeline`, `plan`, `skill`, and `mcp` commands.
>
> - Default: *(empty — prompt is shown)*
> - Env: `POE_DEFAULT_AGENT`
> - Set via `poe-code config edit` or by adding `"defaultAgent": "claude-code"` under `core` in `~/.poe-code/config.json` or `./.poe-code/config.json`.
>
> Precedence: `--agent` / positional arg › frontmatter `agent:` › `core.defaultAgent` › `--yes` fallback › prompt.
>
> Accepts bare agent id (`claude-code`) or `agent:model` notation (`claude-code:anthropic/claude-sonnet-4.6`). Commands that don't take a model silently drop the model portion, same as they do today when `--agent claude-code:…` is passed.

### Invalid config value

Fails fast with the same error shape as today's `--agent foo`:

```
$ POE_DEFAULT_AGENT=not-a-real-agent poe-code configure
✖ Invalid value for core.defaultAgent: "not-a-real-agent".
  Supported: claude-code, codex, gemini, …
```

No fallback to prompt.

## 3. Implementation details and technical decisions

### Architecture

One new helper, wired into each of the 12 prompt sites.

**New helper** — `resolveDefaultAgent(container)` in [src/cli/commands/shared.ts](src/cli/commands/shared.ts), co-located with `resolveCommandFlags`:

- Reads the merged config document: global + project via `readMergedDocument`, then env overrides via `collectEnvOverrides` + `deepMergeDocuments`. Same pipeline as `executeConfigShow` in [src/cli/commands/config.ts:78-86](src/cli/commands/config.ts#L78-L86) — extract a small helper (`resolveMergedDocument(container)`) and share it between the two call sites so the merge chain is defined once.
- Returns `null` if `core.defaultAgent` is empty / whitespace / unset.
- Otherwise parses with `parseAgentSpecifier`, validates the agent portion against `allAgents` from `@poe-code/agent-defs` (canonical list), and returns the normalized specifier string (e.g., `"claude-code"` or `"claude-code:anthropic/claude-sonnet-4.6"`).
- On invalid agent portion: throws a `ValidationError` immediately. Error message names the property and the invalid value and lists supported agent ids. Thrown before any command-specific work runs.
- The model portion is **not** validated here — per-agent model validity is still the per-command resolver's job (same as `--agent` today). Only the agent id is checked at load time.

**New schema entry** — `defaultAgent` under `coreConfigScope` in [src/services/config.ts:40-53](src/services/config.ts#L40-L53):

```
defaultAgent: {
  type: "string",
  default: "",
  env: "POE_DEFAULT_AGENT",
  doc: "Agent (or agent:model) used when no --agent flag is provided; skips the selection prompt"
}
```

### Wiring pattern

Every one of the 12 sites gains the same early-return block. Using the current ralph `promptForAgent` as a template:

```
async function promptForAgent(program, container) {
  const flags = resolveCommandFlags(program);
  const fromConfig = await resolveDefaultAgent(container);   // NEW
  if (fromConfig) return resolveRalphAgent(fromConfig);      // reuses existing validator
  if (flags.assumeYes) return DEFAULT_RALPH_AGENT;
  /* existing select() prompt */
}
```

The wiring order inside each command's overall resolver stays:

1. Explicit CLI arg (`providedAgent`) — already checked first
2. Frontmatter (`configuredAgent` in ralph/experiment) — already checked second
3. *(falls through to `promptForAgent`, which now checks config before `--yes` and before prompting)*

So frontmatter > config is natural: frontmatter is checked by the outer resolver, config is checked by the inner `promptForAgent`.

For the 6 sites that today use an inline `select()` (experiment install, pipeline run/install, skill configure/unconfigure, mcp configure), the same block is inlined; no shared resolver to thread through.

### `agent:model` handling per command

- **Run commands** (`ralph run`, `experiment run`, `pipeline run`): already thread the full specifier through `parseAgentSpecifier` / `resolve<Cmd>Agent`. No change needed beyond passing the config value into those resolvers.
- **Non-run commands** (`configure`, `test`, `install`, `ralph init`, `experiment install`, `pipeline install`, `plan install`, `skill`, `mcp`): only use the agent id. They strip the model portion via `parseAgentSpecifier(value).agent` before validation — same behavior as `--agent claude-code:anthropic/claude-sonnet-4.6` on these commands today.

### Edge cases

- **Empty / whitespace value** → treated as unset, falls through to existing flow.
- **Unknown agent id** → fail fast. Error message names the property (`core.defaultAgent`) and the invalid value. Source (env vs file) is *not* reported — keeps the message aligned with the `--agent` error. Can revisit if users struggle to trace it.
- **`agent:model` with unknown model** → delegated to per-command validator. Same behavior as today's `--agent claude-code:bogus-model`.
- **Config read failure / malformed JSON** → propagates up from `readMergedDocument`. The existing `migrateLegacyConfigIfNeeded` handles legacy recovery; no new recovery path.
- **Project config overrides global** → inherent to `readMergedDocument`. No extra logic.
- **Env overrides file** → inherent to `collectEnvOverrides` + `deepMergeDocuments`, matching `config show`.
- **`--agent` + `core.defaultAgent` + frontmatter all set** → `--agent` wins (precedence #1).
- **`--yes` + `core.defaultAgent`** → config wins. The order inside `promptForAgent` is config-check *before* `if (assumeYes)`.
- **Multi-agent (`agent: [a, b]` in frontmatter)** → out of scope for `defaultAgent`. Single-value only. Users who want multiple agents use frontmatter. Documented, not enforced with a special type.

### Flags, env vars, config knobs

- Config: `core.defaultAgent` (string, default `""`)
- Env: `POE_DEFAULT_AGENT`
- No new CLI flag. No new subcommand.

### Decisions

- Invalid agent portion in `core.defaultAgent` → fail fast inside `resolveDefaultAgent`, before any command-specific work. Error message names the property (`core.defaultAgent`), not the generic `--agent` error, so the user knows where to look.
- Output stays quiet when `core.defaultAgent` drives the selection. No "Using agent X (core.defaultAgent)" announcement in the command intro. If users get confused later, add a single `logger.info` line — not planned for now.

## 4. Interfaces and test plan

### Module boundaries

**`@poe-code/poe-code-config`** — no API change. The existing `defineScope` / `readMergedDocument` / `collectEnvOverrides` / `deepMergeDocuments` surface is enough.

**`src/services/config.ts`** — add one property to the exported `coreConfigScope`. No new exports.

```
coreConfigScope = defineScope("core", {
  apiKey:       { type: "string", default: "",                         env: "POE_API_KEY" },
  poeBaseUrl:   { type: "string", default: "https://api.poe.com/v1",   env: "POE_BASE_URL" },
  defaultAgent: { type: "string", default: "",                         env: "POE_DEFAULT_AGENT" }
});
```

**`src/cli/commands/shared.ts`** — two new exports:

```
export async function resolveMergedDocument(container: CliContainer): Promise<ConfigDocument>;
export async function resolveDefaultAgent(container: CliContainer): Promise<string | null>;
```

Contract for `resolveDefaultAgent`:
- Returns `null` when `core.defaultAgent` is empty / whitespace / unset.
- Returns the normalized specifier string when set and valid.
- Throws `ValidationError` with a message of the form `Invalid value for core.defaultAgent: "foo". Supported agents: claude-code, codex, gemini, …` when the agent id is unknown.
- Does not prompt, does not log.

### Call-site pattern

Identical at all 12 sites. For commands with an outer resolver (ralph, experiment, plan, configure-via-shared), the check goes in `promptForAgent` / `resolveServiceArgument` / `resolvePlanAgent`. For inline `select()` sites (mcp, skill, pipeline run/install, experiment install), the check is inlined.

Template:

```
const fromConfig = await resolveDefaultAgent(container);
if (fromConfig) {
  // run-commands: pass through existing resolver (handles agent:model)
  return resolve<Cmd>Agent(fromConfig);
  // non-run commands: strip model portion
  return parseAgentSpecifier(fromConfig).agent;
}
if (flags.assumeYes) return DEFAULT_*_AGENT;
/* existing prompt */
```

### Test strategy

TDD. Unit tests first (memfs, mocked `container.env.variables`), then wire.

**Unit — `resolveDefaultAgent` (new file `src/cli/commands/shared.test.ts` or extend existing):**

1. Returns `null` when scope is absent.
2. Returns `null` when value is empty string.
3. Returns `null` when value is whitespace only.
4. Returns the bare id when set to a valid agent.
5. Returns `"claude-code:anthropic/claude-sonnet-4.6"` when set with model notation.
6. Throws `ValidationError` with property name and supported list when agent is unknown (`defaultAgent = "not-a-real-agent"`).
7. Throws `ValidationError` when `agent:model` notation has an unknown agent portion.
8. Project-scope value overrides global-scope value.
9. `POE_DEFAULT_AGENT` env overrides both file scopes.

**Integration — one per resolver family, not all 12 sites:**

10. `configure` with `defaultAgent = claude-code` and no positional arg → no prompt shown; runs against claude-code. (Shared-resolver coverage: configure/test/install.)
11. `configure --agent codex` with `defaultAgent = claude-code` set → uses codex. (Precedence.)
12. `ralph run` with `defaultAgent = claude-code`, no `--agent`, no frontmatter → no prompt; runs with claude-code. (Covers promptForAgent-style sites: ralph/experiment.)
13. `ralph run` with `defaultAgent = claude-code` and frontmatter `agent: codex` → uses codex. (Frontmatter > config.)
14. `mcp configure` with `defaultAgent = claude-code` → no prompt. (Covers inline-`select()` sites: mcp/skill/pipeline/experiment-install.)
15. `configure --yes` with `defaultAgent = claude-code` set → claude-code (config wins over `--yes`).
16. `configure --yes` with `defaultAgent` unset → `DEFAULT_*_AGENT` (regression guard on existing `--yes` behavior).
17. `configure` with invalid `defaultAgent = "foo"` → `ValidationError` before the command runs, clean exit code, no prompt.
18. Run command (e.g. `ralph run`) with `defaultAgent = "claude-code:anthropic/claude-sonnet-4.6"` → resolves to specifier with model.
19. Non-run command (e.g. `configure`) with `defaultAgent = "claude-code:anthropic/claude-sonnet-4.6"` → agent portion used, model silently dropped.

Mock boundaries: `container.fs` via memfs, `container.env.variables` as a plain record, prompts via the existing `container.prompts` mock (existing tests show the shape).

**Manual QA** — add a short markdown doc to `docs/development/` with a 6-step walkthrough: set env var, run `configure` / `ralph run` / `mcp configure`, override with `--agent`, clear env, see prompt return. Per CLAUDE.md QA is markdown, not a script.

**Screenshot check** — run `npm run screenshot-poe-code -- configure` with `POE_DEFAULT_AGENT=claude-code` and without, verify the prompt appears in one and not the other. No new screenshot test, just ad-hoc validation.

### Rollout / migration

- No migration. New optional field, empty default, backwards-compatible.
- Single PR, `feat(config)` commit, merged to `main` for stable or `beta` for preview per CLAUDE.md release rules.
- README: one paragraph in the top-level README config section, plus one line in [packages/poe-code-config/README.md](packages/poe-code-config/README.md) env-var table. Both require user permission per CLAUDE.md — confirm before writing.

### Autonomy checklist

An agent should be able to take this plan and build it without returning. Concretely:

**Acceptance criteria**

- `npm run test` passes, including the 9 new unit cases and 10 new integration cases listed above.
- `npm run lint` and `npm run typecheck` clean.
- `resolveDefaultAgent` exists in `src/cli/commands/shared.ts` with the documented contract.
- `coreConfigScope` includes `defaultAgent` with env `POE_DEFAULT_AGENT`.
- Each of the 12 sites listed in level 1 consults `resolveDefaultAgent` before prompting — verifiable by grep: every `select({ message: "Select agent…" })` / every `promptForAgent` / `resolveServiceArgument` / `resolvePlanAgent` has a `resolveDefaultAgent` call upstream.
- Running `POE_DEFAULT_AGENT=claude-code npm run dev -- configure` does not prompt.
- Running `POE_DEFAULT_AGENT=not-a-real-agent npm run dev -- configure` exits with a ValidationError naming `core.defaultAgent`.

**Verification commands**

- Unit + integration: `npm run test -- shared.test.ts` and `npm run test`
- Spot test: `POE_DEFAULT_AGENT=claude-code npm run dev -- configure`
- Spot test (invalid): `POE_DEFAULT_AGENT=bogus npm run dev -- configure`
- Visual: `npm run screenshot-poe-code -- configure` with and without the env var set

**Fixtures / environment**

- No new fixtures. Existing memfs + mocked container are enough.

**Decisions already made**

- Property name: `defaultAgent` (camelCase).
- Precedence: CLI > frontmatter > config > `--yes` > prompt.
- Validation: agent id only, at load time, via `allAgents` from `@poe-code/agent-defs`.
- Output: silent (no "Using agent X" line).
- README/documentation updates require explicit user confirmation before writing.

**Decisions the agent can make on its own**

- Exact wording of the `ValidationError` message, as long as it names `core.defaultAgent` and lists supported agent ids.
- Whether the merged-document helper is named `resolveMergedDocument` or something else — as long as it's extracted and shared with `config show`.
- Test file layout — extend `shared.test.ts` or split into `resolve-default-agent.test.ts`.

**Stop conditions — escalate instead of pushing through**

- If `readMergedDocument` proves async-unsafe / race-prone under parallel CLI calls, stop and flag.
- If the `allAgents` list is not the right source of truth (e.g., some scope considers a subset), stop and ask which list to validate against.
- If touching any of the 12 sites requires reshaping a command's resolver signature beyond the template pattern above, stop — the plan may be under-specified for that site.
- If README/docs edits surface anything non-obvious, pause for user review per CLAUDE.md ("not allowed to add anything to readme without user's permission").

## 5. Code plan

### Files to create

- `docs/development/qa-default-agent.md` — manual QA walkthrough per CLAUDE.md (markdown, not a script). 6 steps: set env var, run `configure`, run `ralph run`, override with `--agent`, set invalid value + verify error, clear env + verify prompt returns.

### Files to change

| File | Change |
|---|---|
| [src/services/config.ts](src/services/config.ts) | Add `defaultAgent` property to `coreConfigScope` (line 40-53). |
| [src/cli/commands/shared.ts](src/cli/commands/shared.ts) | Add `resolveMergedDocument(container)` and `resolveDefaultAgent(container)`. |
| [src/cli/commands/config.ts](src/cli/commands/config.ts) | Refactor `executeConfigShow` (lines 75-97) to call `resolveMergedDocument`. |
| [src/cli/commands/configure.ts](src/cli/commands/configure.ts) | Thread config check into `resolveServiceArgument` (lines 173-212). |
| [src/cli/commands/ralph.ts](src/cli/commands/ralph.ts) | Thread config check into `promptForAgent` (lines 436-455). |
| [src/cli/commands/experiment.ts](src/cli/commands/experiment.ts) | Thread into `promptForAgent` (lines 534-553) and inline `select()` for install (lines 936-940). |
| [src/cli/commands/pipeline.ts](src/cli/commands/pipeline.ts) | Thread into inline `select()` at run (lines 666-673) and install (lines 960-964). |
| [src/cli/commands/plan.ts](src/cli/commands/plan.ts) | Thread into `resolvePlanAgent` (lines 613-634). |
| [src/cli/commands/skill.ts](src/cli/commands/skill.ts) | Thread into inline `select()` at configure (lines 55-61) and unconfigure (lines 159-162). |
| [src/cli/commands/mcp.ts](src/cli/commands/mcp.ts) | Thread into inline `select()` at configure (lines 106-110). |
| `src/cli/commands/shared.test.ts` (existing or new) | Add 9 unit cases per level 4. |
| Integration test file(s) colocated with each command family | Add the 10 integration cases per level 4. |

### New function signatures

```
// src/cli/commands/shared.ts

export async function resolveMergedDocument(
  container: CliContainer
): Promise<ConfigDocument>;
// Merges global config + project config + env overrides via the existing
// readMergedDocument / collectEnvOverrides / deepMergeDocuments pipeline.

export async function resolveDefaultAgent(
  container: CliContainer
): Promise<string | null>;
// Returns null when core.defaultAgent is empty/whitespace/unset.
// Returns the normalized specifier string otherwise.
// Throws ValidationError when the agent id is unknown.
```

### Call-site wiring (pattern repeats 12 times)

```
// At every site that currently prompts for an agent, insert before the
// existing assumeYes / prompt block:
const fromConfig = await resolveDefaultAgent(container);
if (fromConfig !== null) {
  // run-commands: existing resolver parses agent:model
  return resolve<Cmd>Agent(fromConfig);
  // non-run commands: strip model
  return parseAgentSpecifier(fromConfig).agent;
}
```

For the 6 sites that don't have a `container` in scope today (inline `select()` in mcp/skill/pipeline/experiment-install), thread `container` through or use the closure-captured container from the surrounding command action — inspecting each of the 12 sites, all 6 already receive `container` via the command registration in `program.ts`, so no plumbing change is needed.

### Build order

Build in this order so each step leaves the branch green and tests running against a partial-but-correct state.

1. **Schema** — add `defaultAgent` to `coreConfigScope`. No behavior change yet. `npm run test` + `npm run typecheck`.
2. **Helpers** — add `resolveMergedDocument` + `resolveDefaultAgent` to `shared.ts`. Write all 9 unit tests. Red → green.
3. **Refactor `executeConfigShow`** — swap its local merge chain for `resolveMergedDocument`. Existing `config show` tests must stay green — proves the helper is correct.
4. **Wire one shared-resolver site** — `configure.ts` (`resolveServiceArgument`). Add integration tests #10, #11, #15, #16, #17, #19. All pass.
5. **Wire ralph + frontmatter coverage** — `ralph.ts` (`promptForAgent`). Integration tests #12, #13, #18.
6. **Wire one inline-`select()` site** — `mcp.ts`. Integration test #14.
7. **Wire remaining sites** — experiment (run + install), pipeline (run + install), plan install, skill (configure + unconfigure), test, install. No new integration tests; they follow the same patterns already covered.
8. **Manual QA doc** — write `docs/development/qa-default-agent.md`.
9. **Full sweep** — `npm run test`, `npm run lint`, `npm run typecheck`, `npm run screenshot-poe-code -- configure` with and without the env var.
10. **Commit** — single `feat(config): add core.defaultAgent to skip agent prompt` commit, specific files, no `-A`. Plan doc `docs/plans/core-default-agent-config.md` belongs to this commit (CLAUDE.md: "Relevant plans belongs to commits").
