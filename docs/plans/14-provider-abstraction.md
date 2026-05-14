---
$schema: https://poe-platform.github.io/poe-code/schemas/plans/superintendent.schema.json
kind: superintendent
version: 1

builder:
  prompt: |
    Build the highest-priority open task from {{plan.path}}. Tests before code.

inspectors:
  code-quality:
    agent: claude-code
    prompt: |
      Review convention + architecture. Flag SOLID/YAGNI/KISS violations, proxy-only functions, if/case on provider id, and tests that leaked complexity into production code.
  testing:
    prompt: |
      Verify every touched module has a colocated `*.test.ts` using memfs (no real FS, no LLM). Run `npm test` and `npm run lint`; report any failure — no pre-existing excuses.
  snapshot-parity:
    prompt: |
      Through phase 4 the snapshot test for the claude-code configure manifest must stay green. Run `npm test` and check snapshot files under `src/providers/__snapshots__/`. Reject any diff in the generated `~/.claude/settings.json` snapshot.
  cli-surface:
    prompt: |
      Run `npm run dev -- provider list` and `npm run screenshot-poe-code -- provider list`. Confirm exit 0, no style regressions, and that screenshots render the new command group cleanly. Do NOT run `configure` without `--dry-run` — it triggers real auth.

superintendent:
  prompt: |
    Review builder + inspector output, update the Task Board in {{plan.path}}, and hand to owner only when every open task is checked and every inspector accepted.

    Builder summary:
    {{builder.summary}}

    Inspector summaries:

    ## code quality
    {{inspectors.code-quality}}

    ## testing
    {{inspectors.testing}}

    ## snapshot parity
    {{inspectors.snapshot-parity}}

    ## cli surface
    {{inspectors.cli-surface}}

owner:
  agent: claude-code
  prompt: |
    Approve or send back based on {{superintendent.summary}}. Reject if any Task Board item is open, any inspector is red, new code lacks tests, or any agent file still references `poeApiKey` / `poeBaseUrl` / `POE_API_KEY` literals after phase 4.

max_rounds: 100

status:
  state: completed
  round: 1
  review_turn: 0
---

# Provider abstraction

Turn "provider" into a real auth/endpoint concept so Poe is one of many (Anthropic direct, OpenAI direct, Moonshot, …), each declaring which coding agents it can power and how users log in.

## 1. What we're building

The thing today called a "provider" in [src/providers/](src/providers/) is actually a **coding agent** (claude-code, codex, kimi, opencode, goose, poe-agent). There is no real auth/endpoint abstraction — Poe is hardcoded everywhere (`POE_API_KEY`, `poeBaseUrl`, "Poe API key" prompt in login).

We want:

1. A true **auth provider** concept — declarative, one file per provider, no if/case on provider id. Each provider declares: id, label, base URL, auth method (API key for v1; OAuth stubbed), and the list of coding agents it supports.
2. **Per-provider login** — `poe-code provider login <id>`. `poe-code login` keeps working and defaults to `poe` (backwards compat).
3. **Configure picks a compatible provider** — `poe-code configure <agent>` prompts for a provider when >1 logged-in provider supports the agent, or honors `--provider <id>`. Wires that provider's credential + base URL + env vars into the agent's config file and spawn environment.

Out of scope:
- poe-agent internal model-routing providers (separate, see [docs/plans/poe-agent-providers.md](docs/plans/poe-agent-providers.md)).
- OAuth/device-code flows — keep the discriminant in the type, implement only API key in v1.
- Renaming `src/providers/` → `src/agents/` (big rename, gated behind a later phase).

## 2. User-facing shape

New top-level command group:

```
poe-code provider list
poe-code provider login <id> [--api-key <key>]
poe-code provider logout <id>
```

Existing commands, extended:

```
poe-code login [--api-key <key>]                 # unchanged; defaults to provider=poe
poe-code configure <agent> [--provider <id>]     # new --provider flag
```

Example session:

```
$ poe-code provider list
poe         [logged in]   claude-code, codex, kimi, opencode, goose, poe-agent
anthropic   [-]           claude-code
openai      [-]           codex
moonshot    [-]           kimi

$ poe-code provider login anthropic
? Anthropic API key: ************
Saved credential for anthropic.

$ poe-code configure claude-code
? Which provider powers claude-code?
  › poe (logged in)
    anthropic (logged in)
? Claude Code default model: claude-sonnet-4-6
Configured claude-code via anthropic.

$ poe-code configure codex --provider openai --yes
Configured codex via openai.
```

Env vars:
- `POE_API_KEY` — still works, still belongs to the `poe` provider (backwards compat).
- `POE_CODE_PROVIDER=<id>` — opt-in default for the `configure` command when the agent is supported by >1 logged-in provider.
- Per-provider key env (e.g. `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `MOONSHOT_API_KEY`) — declared in the provider file.

## 3. Implementation details and technical decisions

### New package

`packages/providers/` — owns the auth-provider abstraction. Mirrors how [packages/agent-defs/](packages/agent-defs/) owns agent metadata. Keeps `src/` lightweight per [CLAUDE.md](CLAUDE.md) ("The core should be lightweight and only wire packages").

Layout:
```
packages/providers/
  package.json
  README.md
  src/
    index.ts                # re-exports; auto-loads provider files
    types.ts                # AuthProvider, AuthMethod, EnvValueSource
    registry.ts             # ProviderRegistry (list, get, forAgent)
    auth/
      types.ts              # AuthStrategy contract
      api-key.ts            # api-key strategy: prompt → store → retrieve
    providers/
      poe.ts                # the only provider shipped in phase 2
      anthropic.ts          # phase 4, validates the abstraction
```

### Provider declaration shape (declarative, no branching)

One file per provider, no exported logic beyond a manifest. Auth strategy is resolved via a map keyed by `auth.kind` — adding a new auth method = add one handler, no if/case in callers.

### Agent files become provider-agnostic

Each file in [src/providers/](src/providers/) currently hardcodes Poe:

- [src/providers/claude-code.ts:76](src/providers/claude-code.ts#L76) — `POE_API_KEY: { kind: "poeApiKey" }`
- [src/providers/claude-code.ts:84](src/providers/claude-code.ts#L84) — `ANTHROPIC_BASE_URL: { kind: "poeBaseUrl" }`
- [src/providers/claude-code.ts:104-106](src/providers/claude-code.ts#L104-L106) — manifest reads `options.env.poeBaseUrl` + `options.apiKey`

Replace the Poe-specific `kind` values with provider-agnostic ones:

- `poeApiKey` → `providerCredential`
- `poeBaseUrl` → `providerBaseUrl`

The resolver reads the active provider's credential and base URL at spawn/configure time. The agent file no longer names Poe.

Agent → env mapping stays declarative in each agent file; what changes is the source of the value (active provider, not hardcoded Poe).

### Config storage

`~/.config/poe-code/services.json` already tracks configured services. Add a `provider` field per service entry:

```jsonc
{
  "claude-code": { "files": [...], "provider": "anthropic" },
  "codex":       { "files": [...], "provider": "poe" }
}
```

Migration: on first load, if a service has no `provider`, set it to `"poe"` and rewrite. Handled by `@poe-code/poe-code-config`.

### Credential storage

`@poe-code/auth-store` already abstracts keychain vs file. Today it stores one Poe key. Switch to provider-keyed entries: `provider:<id>`. Migration: on first read, if no `provider:poe` entry exists but a legacy Poe entry does, move it.

### Login command

[src/cli/commands/login.ts](src/cli/commands/login.ts) stays as the Poe shortcut. Its body changes to:
1. Resolve provider = `"poe"`.
2. Dispatch to `ProviderRegistry.login(providerId, options)`.
3. Reconfigure services **that are bound to this provider** (today it reconfigures all; under the new model, only those with `provider: "poe"`).

A new [src/cli/commands/provider.ts](src/cli/commands/provider.ts) registers the `provider` command group.

### Configure command

[src/cli/commands/configure.ts](src/cli/commands/configure.ts) changes:
1. Resolve the agent as today via `ServiceRegistry`.
2. Resolve the active provider:
   - `--provider <id>` if given.
   - Else `POE_CODE_PROVIDER` env var.
   - Else the only logged-in provider that supports this agent.
   - Else prompt (interactive) or error with a list (non-interactive).
3. Load the credential via the auth strategy.
4. Build payload `{ env, provider: { id, baseUrl, credential, extraEnv }, ...agentOptions }`.
5. Call `adapter.configure(payload)` as today.
6. Persist the chosen `provider` in services.json.

The dry-run message branch at [src/cli/commands/configure.ts:130-131](src/cli/commands/configure.ts#L130-L131) (currently an if/case on `canonicalService === "claude-code"`) — remove it; derive the message uniformly.

### Edge cases

- **No provider supports the agent** → error listing the agent's known providers and how to log in.
- **Agent already configured with provider A, user reruns with provider B** → overwrite config files, update services.json. Warn if the old provider is still logged in and has no other agent attached.
- **Logout of a provider that has attached agents** → warn + require `--force`, or offer to unconfigure attached agents.
- **Dry run** → resolves provider but does not read or write credentials; prints what would happen.
- **Assume-yes (`--yes`)** → cannot prompt for provider selection → require `--provider` flag if >1 eligible provider, else pick the single eligible one.

### Flags / env vars

| Knob | Default | Purpose |
|---|---|---|
| `--provider <id>` on `configure` | unset | explicit provider choice |
| `POE_CODE_PROVIDER` | unset | default provider for `configure` |
| `POE_API_KEY` | unset | legacy shortcut; feeds the `poe` provider |
| `<PROVIDER>_API_KEY` (per provider) | unset | optional skip of login prompt |

### Open questions

- Open question: Do we persist `provider` in services.json (per-agent binding) or recompute it at spawn time from which credentials are available? Plan assumes persist.
- Open question: Does a provider need to constrain models (e.g. `anthropic` → only `claude-*`)? Phase 4 will show. If yes, add a `supports: { agent, models? }` shape; for now a plain `supportsAgents: readonly string[]` is enough.
- Open question: Rename `src/providers/` → `src/agents/` as a followup? The current name is a lie under the new model. Out of scope for this plan; track separately.

## 4. Interfaces and test plan

### Types (packages/providers/src/types.ts)

```ts
export type EnvValueSource =
  | { kind: "literal"; value: string }
  | { kind: "providerCredential" }
  | { kind: "providerBaseUrl" }
  | { kind: "providerField"; path: string };

export type ApiKeyAuth = {
  kind: "api-key";
  envVar: string;              // e.g. "ANTHROPIC_API_KEY"
  storageKey: string;          // e.g. "provider:anthropic"
  prompt: { title: string; placeholder?: string };
};

export type OAuthAuth = {
  kind: "oauth";
  // stubbed; not implemented in v1
};

export type AuthMethod = ApiKeyAuth | OAuthAuth;

export type AuthProvider = Readonly<{
  id: string;
  label: string;
  summary?: string;
  baseUrl: string;
  auth: AuthMethod;
  supportsAgents: readonly string[];
  env?: Record<string, EnvValueSource>;
}>;
```

### Registry (packages/providers/src/registry.ts)

```ts
export class ProviderRegistry {
  list(): readonly AuthProvider[];
  get(id: string): AuthProvider | undefined;
  forAgent(agentId: string): readonly AuthProvider[];
  login(id: string, options: LoginOptions): Promise<void>;
  logout(id: string): Promise<void>;
  isLoggedIn(id: string): Promise<boolean>;
  resolveCredential(id: string): Promise<string>;
}
```

### Configure payload (src/cli/commands/shared.ts)

```ts
export interface ActiveProvider {
  id: string;
  baseUrl: string;
  credential: string;
  extraEnv: Record<string, string>;
}

export interface ConfigurePayload {
  env: CliEnvironment;
  provider: ActiveProvider;
  // + agent-specific options (model, etc.)
}
```

### Tests

Unit (under each package, fast, memfs for filesystem):
- `packages/providers/registry.test.ts` — `forAgent` filters correctly; `get` returns the file that exports the id; `list` is stable order.
- `packages/providers/auth/api-key.test.ts` — prompt → store → retrieve round-trip with mocked `SecretStore`.
- `packages/providers/providers/poe.test.ts` — shape conforms, `supportsAgents` includes every agent id from `@poe-code/agent-defs`.
- `src/cli/commands/configure.test.ts` — auto-select when 1 eligible, prompt when >1, error when 0, honors `--provider`, honors `POE_CODE_PROVIDER`, rejects `--yes` with >1 and no flag.
- `src/cli/commands/login.test.ts` — `login --api-key` still passes (defaults to `poe`), only reconfigures services bound to `poe`.
- `src/cli/commands/provider.test.ts` — list renders logged-in status; login/logout dispatch to strategy.

Snapshot (per [docs/SNAPSHOT_TESTING.md](docs/SNAPSHOT_TESTING.md)):
- Generated `~/.claude/settings.json` after `configure claude-code --provider poe --yes` must equal the pre-refactor snapshot byte-for-byte.

Integration (no new script — reuse existing):
- `npm run dev -- provider list` → renders.
- `npm run dev -- configure claude-code --provider anthropic --yes` after `provider login anthropic` → writes anthropic base URL into config.
- Screenshots of `provider list`, `provider login`, `configure` prompt — one per screen per [CLAUDE.md](CLAUDE.md) visual-testing rules.

### Migration / rollout

1. services.json: on first read after upgrade, tag each entry with `provider: "poe"`.
2. auth-store: on first read after upgrade, if no `provider:poe` entry and legacy Poe entry exists, copy under the new key (keep legacy for 1 version, log deprecation).
3. README: add the `provider` command group and multi-provider example. Per [CLAUDE.md](CLAUDE.md), ask the user before editing.

### Autonomy checklist

**Acceptance criteria**
- `poe-code provider list` exits 0 with ≥1 provider row.
- `poe-code provider login poe --api-key X` stores under `provider:poe`.
- `poe-code login --api-key X` still works, tagged as provider=poe.
- `poe-code configure claude-code` (interactive, Poe logged in) produces identical `~/.claude/settings.json` as pre-refactor.
- `poe-code configure claude-code --provider anthropic` with no anthropic login errors cleanly.
- With both `poe` and `anthropic` logged in: `configure claude-code --yes` errors until `--provider` is given; `configure claude-code --provider anthropic --yes` succeeds.
- No file in `src/providers/*.ts` contains the literal strings `poeApiKey`, `poeBaseUrl`, or `POE_API_KEY`.

**Verification commands**
- `npm test` — all green.
- `npm run lint` — clean.
- `npm run dev -- provider list`
- `npm run dev -- provider login poe --api-key $POE_API_KEY`
- `npm run dev -- configure claude-code --yes`
- `npm run screenshot-poe-code -- provider list`
- `npm run screenshot-poe-code -- configure claude-code`

**Decisions already made vs. open to the agent**
- Made: new package at `packages/providers/`, `provider:<id>` storage key, persist `provider` in services.json, API-key strategy only in v1, keep `src/providers/` folder name.
- Agent may decide: exact filenames inside `packages/providers/src/auth/`, exact prompt copy, order of provider rows in `list`, whether ProviderRegistry caches credentials in-process.

**Stop conditions**
- If refactoring an agent file requires a change to its public `spawn()` / `test()` contract, pause.
- If the snapshot for `~/.claude/settings.json` differs after phase 3, pause — the poe path must be byte-identical before phase 4 lands.
- If rename of `src/providers/` appears necessary to ship the plan, pause and escalate.

## 5. Code plan

### Files to create

- `packages/providers/package.json`
- `packages/providers/README.md`
- `packages/providers/src/index.ts` — auto-load + re-export registry
- `packages/providers/src/types.ts` — shapes above
- `packages/providers/src/registry.ts` — `ProviderRegistry` class
- `packages/providers/src/auth/types.ts` — `AuthStrategy` contract
- `packages/providers/src/auth/api-key.ts` — prompt/store/retrieve
- `packages/providers/src/providers/poe.ts` — poe provider declaration
- `packages/providers/src/providers/anthropic.ts` — phase 4
- `packages/providers/src/registry.test.ts`
- `packages/providers/src/auth/api-key.test.ts`
- `packages/providers/src/providers/poe.test.ts`
- `src/cli/commands/provider.ts` — `provider list|login|logout` subcommands
- `src/cli/commands/provider.test.ts`

### Files to change

- [src/cli/commands/login.ts](src/cli/commands/login.ts) — default provider to `"poe"`; reconfigure only services bound to poe; re-prompt copy stays "Poe API key" (v1) but routed through `ProviderRegistry.login`.
- [src/cli/commands/configure.ts](src/cli/commands/configure.ts) — resolve active provider (flag → env → single eligible → prompt); drop the claude-code-specific dry-run branch at lines 130-131; persist `provider` in services.json.
- [src/cli/commands/shared.ts](src/cli/commands/shared.ts) — `buildProviderContext` takes an `ActiveProvider`; `applyIsolatedConfiguration` reads from it.
- [src/providers/claude-code.ts](src/providers/claude-code.ts), [codex.ts](src/providers/codex.ts), [kimi.ts](src/providers/kimi.ts), [opencode.ts](src/providers/opencode.ts), [goose.ts](src/providers/goose.ts), [poe-agent.ts](src/providers/poe-agent.ts) — swap `poeApiKey`/`poeBaseUrl` kinds for `providerCredential`/`providerBaseUrl`; remove any direct `env.poeBaseUrl` access in manifest `value` functions, use `ctx.provider.baseUrl` / `ctx.provider.credential`.
- [src/cli/service-registry.ts](src/cli/service-registry.ts) — env kind registry extended with `providerCredential` / `providerBaseUrl`; existing kinds kept temporarily as aliases then removed.
- [src/container.ts](src/container.ts) — instantiate and expose `ProviderRegistry` alongside `ServiceRegistry`.
- [packages/auth-store/](packages/auth-store/) — add `key(provider: string)` helper; migration on read.
- [packages/poe-code-config/](packages/poe-code-config/) — services.json schema gains `provider: string`; migration tags missing entries with `"poe"`.
- [README.md](README.md) — new `provider` section (ask user first).

### Ordering (keep main green at every step)

1. **Scaffold package.** Create `packages/providers/` with types + empty `ProviderRegistry` + `poe.ts`. Wire into build. No consumers yet. Tests pass.
2. **Wire ProviderRegistry into container, not used.** Resolve `poe` by id in a no-op path. Tests pass.
3. **Route login through ProviderRegistry.** `login` command now calls `ProviderRegistry.login("poe")`. External behavior identical. Snapshot of services.json unchanged except for a migration-added `provider: "poe"` field (updated snapshot). Tests pass.
4. **Route configure through ProviderRegistry.** Replace `poeApiKey`/`poeBaseUrl` env kinds in all agent files; payload carries `provider`. Snapshot of `~/.claude/settings.json` byte-identical to pre-refactor. Tests pass.
5. **Add `provider` command group.** `list`, `login`, `logout`. `poe-code login` keeps working. Tests + screenshots.
6. **Add `anthropic` provider.** Proves the abstraction: `configure claude-code --provider anthropic` writes Anthropic base URL. Tests.
7. **(Optional, separate step)** Rename `src/providers/` → `src/agents/` and `ServiceRegistry` → `AgentRegistry`.

## Task Board

- [x] Scaffold `packages/providers/`: `package.json`, `README.md`, `src/types.ts`, empty `src/registry.ts`, `src/auth/types.ts`, `src/auth/api-key.ts`, `src/index.ts` auto-load. Wire into the workspace build. Colocated tests (memfs).
- [x] Declare the `poe` provider at `packages/providers/src/providers/poe.ts`: api-key auth, baseUrl, `supportsAgents` covers every id in `@poe-code/agent-defs`. Test asserts the list matches agent-defs.
- [x] Expose `ProviderRegistry` via [src/container.ts](src/container.ts) alongside `ServiceRegistry`. No callers yet.
- [x] Migrate `@poe-code/auth-store` to provider-keyed entries (`provider:<id>`). On read, if legacy Poe entry exists and `provider:poe` is missing, copy under the new key. Tests cover both paths.
- [x] Migrate `@poe-code/poe-code-config`: services.json schema gains `provider: string`; on load, tag untagged entries with `"poe"` and rewrite. Tests cover both paths.
- [x] Route [src/cli/commands/login.ts](src/cli/commands/login.ts) through `ProviderRegistry.login("poe")`. `reconfigureServices` filters to services bound to `poe`. External behavior unchanged.
- [x] Extend env-kind resolver in [src/cli/service-registry.ts](src/cli/service-registry.ts) with `providerCredential` and `providerBaseUrl`, sourced from an `ActiveProvider` on the payload. Existing `poeApiKey` / `poeBaseUrl` kinds keep working as aliases for this step only.
- [x] Teach [src/cli/commands/configure.ts](src/cli/commands/configure.ts) to resolve an active provider (flag → env `POE_CODE_PROVIDER` → single eligible → prompt; `--yes` with >1 eligible errors). Drop the claude-code-specific dry-run branch at lines 130-131. Persist `provider` in services.json.
- [x] **[pre-phase 4]** Capture the pre-refactor golden snapshot: run `poe-code configure claude-code --yes` with a known `POE_API_KEY` and commit the resulting `~/.claude/settings.json` as a test fixture. Byte-identical check in the next task depends on this.
- [x] Swap Poe-specific env kinds in every agent file: [claude-code.ts](src/providers/claude-code.ts), [codex.ts](src/providers/codex.ts), [kimi.ts](src/providers/kimi.ts), [opencode.ts](src/providers/opencode.ts), [goose.ts](src/providers/goose.ts), [poe-agent.ts](src/providers/poe-agent.ts). `~/.claude/settings.json` snapshot for `configure claude-code --provider poe --yes` stays byte-identical.
- [x] Remove the legacy `poeApiKey` / `poeBaseUrl` env kinds from the resolver. Grep `src/providers/**` must return zero hits for `poeApiKey`, `poeBaseUrl`, `POE_API_KEY`.
- [x] Add `src/cli/commands/provider.ts` with `provider list|login|logout` subcommands. Register in the CLI entrypoint. Tests + screenshot of `poe-code provider list`.
- [x] Add `packages/providers/src/providers/anthropic.ts` (api-key, `supportsAgents: ["claude-code"]`, `baseUrl: https://api.anthropic.com`). End-to-end: `provider login anthropic --api-key X && configure claude-code --provider anthropic --yes` writes the Anthropic base URL into `~/.claude/settings.json`.
- [ ] Ask the user before touching [README.md](README.md); once approved, document the `provider` command group and the multi-provider example.
