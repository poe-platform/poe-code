# @poe-code/providers

Auth-provider abstraction for poe-code: declarative provider manifests plus pluggable auth strategies. Each provider declares its id, label, base URL, supported coding agents, and the auth method it uses.

See [docs/plans/provider-abstraction.md](../../docs/plans/provider-abstraction.md) for the full design.

## Shape

```ts
import type { AuthProvider } from "@poe-code/providers";

const anthropic: AuthProvider = {
  id: "anthropic",
  label: "Anthropic",
  baseUrl: "https://api.anthropic.com",
  auth: {
    kind: "api-key",
    envVar: "ANTHROPIC_API_KEY",
    storageKey: "provider:anthropic",
    prompt: { title: "Anthropic API key", placeholder: "sk-ant-..." }
  },
  supportsAgents: ["claude-code"]
};
```

## Registry

```ts
import { ProviderRegistry } from "@poe-code/providers";

const registry = new ProviderRegistry([anthropic, poe]);
registry.list();               // all providers, construction order
registry.get("anthropic");     // AuthProvider | undefined
registry.forAgent("claude-code"); // providers that can power the agent
```

## Auth strategies

Strategies are dispatched on `auth.kind`. The api-key strategy stores the credential in a
[`SecretStore`](../auth-store) — keychain on macOS, encrypted file elsewhere — and can prompt
interactively when an API key is not supplied up front.

```ts
import { apiKeyAuthStrategy } from "@poe-code/providers";

await apiKeyAuthStrategy.login(
  anthropic,
  { apiKey: process.env.ANTHROPIC_API_KEY },
  { secretStore, promptForSecret }
);

const apiKey = await apiKeyAuthStrategy.resolveCredential(anthropic, { secretStore });
```

## Environment variables

This package does not read any environment variables directly. Consumers pass them in
via provider declarations (e.g. `auth.envVar`) and login options.

## Configuration options

No runtime configuration; everything is declared per-provider via the `AuthProvider`
manifest.
