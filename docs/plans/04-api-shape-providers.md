---
$schema: https://poe-platform.github.io/poe-code/schemas/plans/plan.schema.json
kind: plan
version: 1
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
Provider    Status       API shapes                                      Agents
poe         logged in    chat-completions, responses, messages           claude-code, codex, kimi, opencode, goose, poe-agent
openai      -            chat-completions, responses                     codex, opencode, goose, poe-agent
anthropic   -            messages                                       claude-code, goose, poe-agent
google      -            generations                                    goose, poe-agent
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
