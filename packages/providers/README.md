# @poe-code/providers

Auth-provider abstraction for poe-code: declarative provider manifests plus pluggable auth strategies. Each provider declares its id, label, base URL, API shapes, and the auth method it uses.

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
  apiShapes: [
    {
      id: "anthropic-messages",
      defaultBaseUrl: "https://api.anthropic.com"
    }
  ]
};
```

## Registry

```ts
import { ProviderRegistry } from "@poe-code/providers";

const registry = new ProviderRegistry([anthropic, poe]);
registry.list();               // all providers, construction order
registry.get("anthropic");     // AuthProvider | undefined
registry.forAgent({ id: "claude-code", apiShapes: ["anthropic-messages"] });
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

`ProviderRegistry.login()` resolves API keys in this order:

1. Explicit `options.apiKey`
2. The provider's declared `auth.envVar` from `context.envVars`
3. `promptForSecret`

`ProviderRegistry.isLoggedIn()` also treats a non-empty declared env var as logged in,
matching what `login()` would use in CI.

## Environment variables

This package does not read `process.env` directly. Consumers pass environment variables in
via provider declarations (e.g. `auth.envVar`), `ProviderRegistryOptions.envVars`,
and `LoginContext.envVars`.

## Configuration options

No runtime configuration; everything is declared per-provider via the `AuthProvider`
manifest.
