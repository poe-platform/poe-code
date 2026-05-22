---
$schema: https://poe-platform.github.io/poe-code/schemas/plans/pipeline.schema.json
kind: pipeline
version: 1
tasks:
  - id: add-shape-types-optional
    title: Add ApiShapeId types and optional apiShapes fields
    prompt: >
      Extend types only. No behavioral change. Run `npm test` after; everything
      stays green.


      In `packages/providers/src/types.ts`:

      - Add `export type ApiShapeId = "openai-chat-completions" |
      "openai-responses" | "anthropic-messages" | "google-generations";`

      - Add `export interface ApiShapeBinding { readonly id: ApiShapeId;
      readonly defaultBaseUrl: string; }`

      - Add `readonly apiShapes?: readonly ApiShapeBinding[]` to `AuthProvider`
      (optional during transition; `supportsAgents` stays required).


      In `packages/agent-defs/src/types.ts` (or wherever `AgentDefinition` lives
      — grep if unsure):

      - Add `readonly apiShapes?: readonly ApiShapeId[]`. Optional during
      transition.


      Colocate `*.test.ts` per CLAUDE.md if the shape ids need a stability test.
      No code that *reads* these fields lands in this task.
    status:
      implement: done
      test: done
      commit: done
  - id: declare-shapes-on-poe-provider
    title: Declare apiShapes on the Poe provider
    prompt: >
      In `packages/providers/src/providers/poe.ts`, add `apiShapes` alongside
      the existing `supportsAgents` (do not remove `supportsAgents`):


      ```ts

      apiShapes: [
        { id: "openai-chat-completions", defaultBaseUrl: "https://api.poe.com/v1" },
        { id: "openai-responses",        defaultBaseUrl: "https://api.poe.com/v1" },
        { id: "anthropic-messages",      defaultBaseUrl: "https://api.poe.com/anthropic" }
      ]

      ```


      Update `packages/providers/src/providers/poe.test.ts` to assert the three
      shapes exist with these defaults. No runtime behavior changes — no caller
      consumes `apiShapes` yet.
    status:
      implement: done
      test: done
      commit: done
  - id: declare-shapes-on-agents
    title: Declare ordered apiShapes on every agent definition
    prompt: >
      Each agent in `packages/agent-defs/` declares its ordered required API
      shapes. Order is preference when a provider supports more than one.


      Determine each agent's shape from its current spawn/configure code in
      `src/providers/<agent>.ts` (look at which API the agent talks to today
      through Poe). Expected shapes:

      - `claude-code` → `["anthropic-messages"]`

      - `codex` → `["openai-responses"]`

      - `kimi` → `["openai-chat-completions"]`

      - `opencode` → derive from its config (likely
      `["openai-chat-completions"]`; verify)

      - `goose` → derive from its config (multi-shape candidate; list every
      shape it can be configured against, ordered by what current code chooses
      by default)

      - `poe-agent` → derive from its current Poe call shape


      Add tests in `packages/agent-defs/` confirming each agent declares at
      least one shape and that the order matches what existing code routes by
      default. No consumer yet — type field is optional, current callers ignore
      it.
    status:
      implement: done
      test: done
      commit: done
  - id: shape-intersection-helper
    title: Add resolveApiShape and switch ProviderRegistry.forAgent to it
    prompt: >
      In `packages/providers/src/compatibility.ts` (new file):


      ```ts

      export function resolveApiShape(
        provider: AuthProvider,
        agent: { apiShapes?: readonly ApiShapeId[] }
      ): ApiShapeId | undefined {
        if (!provider.apiShapes || !agent.apiShapes) return undefined;
        for (const shapeId of agent.apiShapes) {
          if (provider.apiShapes.some(s => s.id === shapeId)) return shapeId;
        }
        return undefined;
      }

      ```


      In `packages/providers/src/registry.ts`, change `forAgent(agentId:
      string)` to `forAgent(agent: { id: string; apiShapes?: readonly
      ApiShapeId[] })`. Selection rule:

      - If both sides declare `apiShapes`, return providers where
      `resolveApiShape(provider, agent)` is defined.

      - Else fall back to the current `supportsAgents.includes(agent.id)`
      filter.


      Update both callers (`src/cli/commands/configure.ts`,
      `src/cli/commands/provider.ts`) to pass the resolved `AgentDefinition`
      instead of just the id. Add `compatibility.test.ts` covering: empty
      intersection, preference order respected, fallback path when one side
      lacks `apiShapes`.


      Backwards-compat invariant: with poe declaring both `supportsAgents` and
      `apiShapes`, and every agent declaring `apiShapes`, `forAgent(agent)`
      returns the same `[poeProvider]` set as before.
    status:
      implement: done
      test: done
      commit: done
  - id: persist-apishape-in-services-json
    title: Persist apiShape in services.json with idempotent migration
    prompt: >
      In `packages/poe-code-config/`, extend the services.json schema entry from
      `{ provider, files }` to `{ provider, apiShape, files }`. The `apiShape`
      is a string matching `ApiShapeId` from `@poe-code/providers`.


      Migration on read (idempotent):

      - If an entry has `apiShape`, leave it.

      - If `apiShape` is missing, derive it: look up the entry's `provider` in
      `ProviderRegistry`, look up the entry's agent in `agent-defs`, call
      `resolveApiShape(provider, agent)`. If a result exists, set it and rewrite
      the file. If not (legacy entry with a provider that no longer maps), leave
      `apiShape` undefined and warn.


      Snapshot test: starting from a services.json with `{ "claude-code": {
      "provider": "poe", "files": [...] } }`, after one load+save, the file
      becomes `{ "claude-code": { "provider": "poe", "apiShape":
      "anthropic-messages", "files": [...] } }`. Backwards-compat: no consumer
      fails when `apiShape` is undefined (defer reading it until task
      `shape-scoped-baseurl`).
    status:
      implement: done
      test: done
      commit: done
  - id: shape-scoped-baseurl
    title: Resolve baseUrl per shape on ActiveProvider
    prompt: >
      Today `ActiveProvider` (in `src/cli/commands/shared.ts` and used by
      `src/cli/service-registry.ts`) is `{ id, baseUrl, credential, extraEnv }`
      with `baseUrl` provider-wide. Make `baseUrl` shape-scoped without changing
      the env-kind names.


      Changes:

      - Extend `ActiveProvider` to `{ id, apiShape: ApiShapeId, baseUrl,
      credential, extraEnv }`.

      - In `src/cli/commands/configure.ts` and any spawn path that builds an
      `ActiveProvider`, resolve `apiShape` via `resolveApiShape(provider,
      agent)` then set `baseUrl` to the stored per-shape URL if present, else
      `provider.apiShapes.find(s => s.id === apiShape).defaultBaseUrl`.

      - Env-kind resolver in `src/cli/service-registry.ts` keeps reading the
      `providerBaseUrl` env kind — it just pulls from the new shape-scoped
      `baseUrl`. No new env kind. No agent-file edits.


      Backwards-compat invariant: snapshot of `~/.claude/settings.json` from
      `configure claude-code --yes` with only `POE_API_KEY` set must be
      byte-identical to the pre-change snapshot. Add a regression snapshot test
      that asserts this against the fixture from plan 14's `[pre-phase 4]`
      capture.
    status:
      implement: done
      test: done
      commit: done
  - id: shape-base-url-login-flag
    title: Accept --shape-base-url on provider login
    prompt: >
      In `src/cli/commands/provider.ts`, add a repeated flag `--shape-base-url
      <shape-id>=<url>` to `provider login`. Parse into `Record<ApiShapeId,
      string>`. Reject unknown shape ids with an error listing the provider's
      exposed shapes.


      Storage: stored login records currently hold only the credential
      (`@poe-code/auth-store` keyed by `provider:<id>`). Per-shape base URLs do
      not belong with secrets; store them in `~/.config/poe-code/services.json`
      under a new `providers: { <id>: { shapeBaseUrls: { <shape-id>: <url> } }
      }` map managed by `@poe-code/poe-code-config`. Migration: missing
      `providers` section is the default empty map.


      Resolution order at configure time (already specified in plan body):
      explicit `--base-url`/`--shape-base-url` > env var (api key only) > stored
      shape URL > `provider.apiShapes[...].defaultBaseUrl`. Base URLs are never
      read from env vars.


      Tests: round-trip — `provider login poe --shape-base-url
      anthropic-messages=https://example/anth` stores under poe's
      `shapeBaseUrls`; `configure claude-code --provider poe --yes` resolves the
      `anthropic-messages` base URL to the stored value, not the default.
    status:
      implement: done
      test: done
      commit: done
  - id: provider-list-shape-labels
    title: Render shape labels in provider list
    prompt: >
      Update `provider list` rendering in `src/cli/commands/provider.ts` to show
      three columns: Provider, Status, API shapes, Agents. Shape labels use
      short ids per plan body §2:


      | CLI label           | Canonical id              |

      |---------------------|---------------------------|

      | `chat-completions`  | `openai-chat-completions` |

      | `responses`         | `openai-responses`        |

      | `messages`          | `anthropic-messages`      |

      | `generations`       | `google-generations`      |


      The "Agents" column is derived: list every agent in `agent-defs` whose
      `apiShapes` intersect the provider's `apiShapes` (sorted by agent id). Do
      not read `supportsAgents`.


      Verify with `npm run dev -- provider list` and `npm run
      screenshot-poe-code -- provider list`. Snapshot the rendered output. No
      regression in column alignment.
    status:
      implement: done
      test: done
      commit: done
  - id: register-and-shape-anthropic
    title: Register anthropicProvider with apiShapes
    prompt: >
      Two issues at once: `anthropicProvider` exists at
      `packages/providers/src/providers/anthropic.ts` but is not registered in
      either container (`src/cli/container.ts:167` and
      `src/sdk/container.ts:136` both pass only `[poeProvider]`). It also lacks
      `apiShapes`.


      Changes:

      - In `packages/providers/src/providers/anthropic.ts`, add `apiShapes: [{
      id: "anthropic-messages", defaultBaseUrl: "https://api.anthropic.com" }]`.
      Keep `supportsAgents: ["claude-code"]` for now.

      - In both `src/cli/container.ts` and `src/sdk/container.ts`, change the
      `ProviderRegistry` construction from `[poeProvider]` to `[poeProvider,
      anthropicProvider]`.

      - Update `packages/providers/src/index.ts` to re-export
      `anthropicProvider` if not already.


      End-to-end test (memfs + mocked secret store): `provider login anthropic
      --api-key sk-ant-...` followed by `configure claude-code --provider
      anthropic --yes` writes `https://api.anthropic.com` into
      `~/.claude/settings.json`'s `ANTHROPIC_BASE_URL`. With only `POE_API_KEY`
      set and `anthropic` not logged in, `configure claude-code --yes` still
      resolves to poe (single eligible logged-in provider). This is the
      backwards-compat invariant for this task.
    status:
      implement: done
      test: done
      commit: done
  - id: add-cloudflare-provider
    title: Add the Cloudflare gateway provider
    prompt: >
      Add `packages/providers/src/providers/cloudflare.ts` as a second
      compatibility provider validating the abstraction. Source-of-truth:
      `/Users/kjopek/Workspace/poe-cloudflare-internal-gateway/README.md`.


      ```ts

      export const cloudflareProvider: AuthProvider = {
        id: "cloudflare",
        label: "Cloudflare AI Gateway",
        summary: "Route coding agents through Cloudflare AI Gateway.",
        baseUrl: "https://gateway.ai.cloudflare.com",
        requiresBaseUrl: true,
        auth: {
          kind: "api-key",
          envVar: "CF_AIG_TOKEN",
          storageKey: "provider:cloudflare",
          prompt: { title: "Cloudflare AI Gateway token" }
        },
        apiShapes: [
          { id: "openai-chat-completions", baseUrlPath: "compat" },
          { id: "openai-responses",        baseUrlPath: "openai" },
          { id: "anthropic-messages",      baseUrlPath: "anthropic" },
          { id: "google-generations",      baseUrlPath: "google-ai-studio" }
        ]
      };

      ```


      Wire `cloudflareProvider` into both `src/cli/container.ts` and
      `src/sdk/container.ts` after `anthropicProvider`. Export from
      `packages/providers/src/index.ts`.


      Auth note: the cloudflare gateway uses a Cloudflare AI Gateway token, and
      the provider declares `CF_AIG_TOKEN` as its env var so it has a
      distinct identity from poe. This preserves the backwards-compat invariant:
      with only `POE_API_KEY` set, cloudflare is not env-logged-in and
      `configure --yes` still resolves uniquely to poe. The credential value
      flows opaquely from the env var or stored login into the `Authorization:
      Bearer` header.


      Tests:

      - `provider login cloudflare --api-key X && configure claude-code
      --provider cloudflare --base-url https://gateway.ai.cloudflare.com/v1/<account_id>/<gateway_id>/ --yes`
      writes the base URL plus `/anthropic` into `ANTHROPIC_BASE_URL`.

      - `provider login cloudflare --api-key X && configure codex --provider
      cloudflare --base-url https://gateway.ai.cloudflare.com/v1/<account_id>/<gateway_id>/ --yes`
      writes the base URL plus `/openai` into the codex config.

      - With `POE_API_KEY` set and `CF_AIG_TOKEN` unset, `configure
      claude-code --yes` resolves to poe (cloudflare is not env-logged-in).
      Backwards-compat invariant.

      - With both `POE_API_KEY` and `CF_AIG_TOKEN` set, `configure
      claude-code --yes` errors and demands `--provider` (two env-logged-in
      compatible providers).
    status:
      implement: done
      test: done
      commit: done
  - id: drop-supports-agents
    title: Remove supportsAgents; shape intersection is the only compatibility rule
    prompt: >
      Every provider now declares `apiShapes` and every agent declares
      `apiShapes`. Drop the transitional field.


      Changes:

      - Remove `supportsAgents` from `AuthProvider` in
      `packages/providers/src/types.ts`.

      - Delete the field from every provider file: `poe.ts`, `anthropic.ts`,
      `cloudflare.ts`.

      - In `packages/providers/src/registry.ts`, simplify `forAgent` to use only
      `resolveApiShape`. Delete the fallback branch.

      - Remove `supportsAgents`-based tests in
      `packages/providers/src/providers/*.test.ts`; replace with
      shape-intersection assertions if not already present.


      Acceptance: `grep -rn supportsAgents packages/ src/` returns zero hits.
      Snapshot of `~/.claude/settings.json` for `configure claude-code --yes`
      with only `POE_API_KEY` set remains byte-identical.
    status:
      implement: done
      test: done
      commit: done
  - id: shape-aware-error-messages
    title: Error messages name the missing shape
    prompt: >
      Update error paths in `src/cli/commands/configure.ts` to match plan body
      §2:


      `Error: Provider "openai" cannot configure claude-code.\nclaude-code
      requires one of: anthropic-messages.\nopenai provides: openai-responses,
      openai-chat-completions.`


      And for the ambiguity case:


      `Error: claude-code can be configured with multiple providers.\nPass
      --provider.\n\nCompatible providers:\n  poe\n  anthropic`


      Use short shape labels (`chat-completions`, `responses`, `messages`,
      `generations`) when rendering to humans; canonical ids only in machine
      output. Snapshot tests in `src/cli/commands/configure.test.ts` cover both
      error formats. No regression in the happy-path snapshot.
    status:
      implement: done
      test: done
      commit: done
name: api-shape-providers
state: archived
---

# API shape providers

Generalize provider compatibility around API shapes instead of treating Poe as the central API.

## 1. What we're building

We are phasing out the Poe API as the assumed center of provider configuration.

Instead of saying a provider supports an agent directly, each coding agent declares the API shapes it can be configured with. The initial API shapes are:

- OpenAI chat completions
- OpenAI responses
- Anthropic messages
- Google generations

Each auth provider declares which API shapes it exposes, the first-party base URL defaults for those shapes, and the environment variable that can supply its API key. Provider login captures the user's API key and base URL choices when explicit values are needed. First-party providers can accept their declared base URL defaults during login, and custom or compatibility providers can override base URLs without changing agent configuration code.

Adding a provider should be a matter of adding one declarative provider file. Everything else should be derived from that provider config. Host code must not add provider-specific if/case branches.

Poe becomes one provider that exposes multiple API shapes: chat completions, responses, and messages. It does not expose Google generations. Agents that need any of those shapes can still be configured through Poe because compatibility is computed from the agent's required API shape and the provider's exposed API shapes.

This builds on the existing `@poe-code/providers` package rather than creating a parallel abstraction. The current provider manifest already owns auth, base URL, environment variables, and provider registry behavior; this plan extends that manifest from `supportsAgents` to API-shape capabilities and moves agent compatibility into declarative agent metadata.

Explicit non-goals:

- Do not add provider-specific branches in configure, spawn, SDK, or CLI code.
- Do not require changes outside one provider file when adding a provider.
- Do not make providers know about logging, dry-run behavior, prompts, or coding-agent internals.
- Do not remove Poe support; reframe Poe as a multi-shape provider.
- Do not implement external provider plugins or third-party package loading in this feature.

## 2. User-facing shape

Provider configuration stays centered on the existing provider commands, but the output explains compatibility through API shapes rather than agent lists.

```sh
poe-code provider list
poe-code provider login poe
poe-code provider login openai --api-key "$OPENAI_API_KEY"
poe-code provider login openai --api-key "$OPENAI_API_KEY" --base-url https://api.openai.com/v1
OPENAI_API_KEY=sk-... poe-code configure codex --provider openai --yes
poe-code provider login anthropic --api-key "$ANTHROPIC_API_KEY"
poe-code provider login google --api-key "$GEMINI_API_KEY"
poe-code configure codex --provider openai --yes
poe-code configure claude-code --provider poe --yes
```

`provider list` shows which API shapes each provider exposes and which coding agents can be configured from those shapes. Agent compatibility is derived from the provider's shapes and the agent's declared requirements.

```text
$ poe-code provider list
Provider     Status       API shapes                                      Agents
poe          logged in    chat-completions, responses, messages           claude-code, codex, kimi, opencode, goose, poe-agent
cloudflare   -            chat-completions, responses, messages, generations  claude-code, codex, kimi, opencode, goose, poe-agent
openai       -            chat-completions, responses                     codex, opencode, goose, poe-agent
anthropic    -            messages                                        claude-code, goose, poe-agent
google       -            generations                                     goose, poe-agent
```

The short shape labels in CLI output map to canonical ids:

| CLI label | Canonical id |
|---|---|
| `chat-completions` | `openai-chat-completions` |
| `responses` | `openai-responses` |
| `messages` | `anthropic-messages` |
| `generations` | `google-generations` |

`provider login` owns endpoint selection. For a provider with one endpoint for every exposed shape, `--base-url` sets that endpoint. For a provider that needs different endpoints per shape, login accepts per-shape base URLs through config or repeated flags.

```sh
poe-code provider login poe \
  --api-key "$POE_API_KEY" \
  --shape-base-url openai-responses=https://api.poe.com/v1 \
  --shape-base-url openai-chat-completions=https://api.poe.com/v1 \
  --shape-base-url anthropic-messages=https://api.poe.com/anthropic
```

Every provider declares the API key env var it can read without an explicit `provider login` round-trip. Base URLs are not read from env; they come from explicit login/config values or provider-declared defaults. Resolution order is:

1. Explicit CLI/SDK options, such as `--api-key`, `--base-url`, and `--shape-base-url`.
2. Provider-declared API key env vars, such as `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, and `POE_API_KEY`.
3. Stored provider login values.
4. Provider-declared defaults for base URLs only.
5. Interactive prompt when required and allowed.

This keeps CI and local shell workflows equivalent to today's `POE_API_KEY` behavior: setting the provider's API key env var is enough for configure, test, spawn, and SDK calls when default base URLs are acceptable.

Cloudflare gateway declares `CF_AIG_TOKEN` as its env var so it has a distinct env-var identity from poe. With only `POE_API_KEY` set, cloudflare is not env-logged-in and `configure --yes` resolves uniquely to poe — backwards compat preserved. With both env vars set, the user has opted into ambiguity and must pass `--provider`.

`configure` resolves only a provider from the user's perspective. The API shape is derived by intersecting the provider's declared shapes with the agent's declared required shapes.

1. If `--provider` is passed, that provider must expose at least one shape the agent accepts.
2. If the provider exposes multiple compatible shapes, the agent's ordered shape preference selects the first match.
3. If no provider is passed, interactive mode prompts for compatible providers, not provider/shape pairs.
4. With `--yes`, defaults are accepted only when there is a single compatible provider or the agent has a configured default provider.

Example interactive flow:

```text
$ poe-code configure claude-code
? Provider
  › poe
    anthropic
? Claude Code model
  › anthropic/claude-sonnet-4.6
Configured claude-code using poe.
```

Example non-interactive ambiguity:

```text
$ poe-code configure claude-code --yes
Error: claude-code can be configured with multiple providers.
Pass --provider.

Compatible providers:
  poe
  anthropic
```

Provider files stay declarative. A first-party provider declares API shapes and base URL defaults. Login stores the actual API key and base URL values used by configuration. A compatibility provider such as Poe declares the shapes it exposes; users can keep the defaults or override endpoint values at login time.

```ts
import type { AuthProvider } from "@poe-code/providers";

export const openaiProvider: AuthProvider = {
  id: "openai",
  label: "OpenAI",
  summary: "Use OpenAI's first-party API.",
  auth: {
    kind: "api-key",
    envVar: "OPENAI_API_KEY",
    storageKey: "provider:openai",
    prompt: { title: "OpenAI API key" }
  },
  apiShapes: [
    { id: "openai-responses", defaultBaseUrl: "https://api.openai.com/v1" },
    { id: "openai-chat-completions", defaultBaseUrl: "https://api.openai.com/v1" }
  ]
};

export const poeProvider: AuthProvider = {
  id: "poe",
  label: "Poe",
  summary: "Route coding agents through Poe's API.",
  auth: {
    kind: "api-key",
    envVar: "POE_API_KEY",
    storageKey: "provider:poe",
    prompt: { title: "Poe API key" },
    preferredLogin: "oauth"
  },
  apiShapes: [
    { id: "openai-responses", defaultBaseUrl: "https://api.poe.com/v1" },
    { id: "openai-chat-completions", defaultBaseUrl: "https://api.poe.com/v1" },
    { id: "anthropic-messages", defaultBaseUrl: "https://api.poe.com/anthropic" }
  ]
};
```

Agent definitions declare ordered API-shape support. The order is the agent's preference when a provider supports more than one compatible shape.

```ts
export const codexAgent: AgentDefinition = {
  id: "codex",
  name: "codex",
  label: "Codex",
  summary: "Configure Codex to use a compatible model API.",
  binaryName: "codex",
  configPath: "~/.codex/config.toml",
  apiShapes: ["openai-responses"],
  branding: {
    colors: {
      dark: "#D5D9DF",
      light: "#7A7F86"
    }
  }
};
```

The SDK exposes the same knobs as the CLI.

```ts
import { configure } from "@poe-code/sdk";

await configure("codex", {
  provider: "openai",
  yes: true
});
```

Configured services persist both the selected provider and API shape so future reconfigure, spawn, and test commands do not guess.

```json
{
  "configured_services": {
    "codex": {
      "provider": "openai",
      "apiShape": "openai-responses",
      "files": ["~/.codex/config.toml"]
    },
    "claude-code": {
      "provider": "poe",
      "apiShape": "anthropic-messages",
      "files": ["~/.claude/settings.json"]
    }
  }
}
```

Error messages name the missing shape rather than implying a provider-specific integration is missing.

```text
Error: Provider "openai" cannot configure claude-code.
claude-code requires one of: anthropic-messages.
openai provides: openai-responses, openai-chat-completions.
```

## 3. Backwards-compatibility invariants

These hold at every task boundary. Each task prompt restates the invariants relevant to it; the global rules are:

- With only `POE_API_KEY` set (no `provider login` performed for any non-poe provider), `poe-code configure <agent> --yes` resolves to poe and never prompts.
- `poe-code login` continues to default to provider=poe and continues to work with `--api-key`.
- `~/.claude/settings.json` produced by `configure claude-code --yes` is byte-identical to the pre-refactor snapshot through every task. The fixture is the snapshot captured by plan 14's `[pre-phase 4]` task.
- `POE_API_KEY` always feeds the `poe` provider, never any other provider.
- Cloudflare provider declares no `envVar`. It is reachable only via explicit `provider login cloudflare` or `--provider cloudflare`.
- Migrations on `services.json` and `auth-store` are idempotent and forward-only; running an older binary against migrated state is not supported, but running the new binary against legacy state migrates it once on first read.

## 4. Task dependency order

The Task Board executes top-to-bottom. The dependency graph:

```
add-shape-types-optional
  → declare-shapes-on-poe-provider
  → declare-shapes-on-agents
    → shape-intersection-helper
      → persist-apishape-in-services-json
        → shape-scoped-baseurl                 (snapshot byte-identity gate)
          → shape-base-url-login-flag
            → provider-list-shape-labels
              → register-and-shape-anthropic
                → add-cloudflare-provider      (validates abstraction)
                  → drop-supports-agents       (cleanup gate)
                    → shape-aware-error-messages
```

The two gate tasks are `shape-scoped-baseurl` (snapshot stays byte-identical) and `drop-supports-agents` (zero `supportsAgents` references remain). The two abstraction-validation gates are `register-and-shape-anthropic` (proves a single-shape provider works) and `add-cloudflare-provider` (proves a multi-shape compatibility provider works).
