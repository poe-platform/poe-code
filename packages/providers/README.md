# @poe-code/providers

Auth-provider abstraction for poe-code: declarative provider manifests plus pluggable auth strategies. Each provider declares its id, label, API shapes, and the auth method it uses. Providers may declare a default base URL when one exists.

See [docs/plans/provider-abstraction.md](../../docs/plans/provider-abstraction.md) for the full design.

## Shape

```ts
import type { AuthProvider } from "@poe-code/providers";

const anthropic: AuthProvider = {
  id: "anthropic",
  label: "Anthropic",
  baseUrl: "https://api.anthropic.com",
  baseUrlEnvVar: "ANTHROPIC_BASE_URL",
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

`baseUrl` and `baseUrlEnvVar` are optional. `baseUrl` is only for providers that have a real
provider-level default. When a provider declares `baseUrlEnvVar`, consumers may resolve a
provider base URL from that environment variable before falling back to stored provider config
or declared defaults.

`requiresBaseUrl: true` marks providers, such as Cloudflare AI Gateway, that cannot be
configured without an explicit gateway URL. `modelInput: { kind: "freeform" }` marks providers
whose model names must be typed by the user rather than selected from an agent-owned list.

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
via provider declarations (e.g. `auth.envVar` and `baseUrlEnvVar`),
`ProviderRegistryOptions.envVars`, and `LoginContext.envVars`.

Declared environment variables:

- `POE_API_KEY` - Poe API key.
- `ANTHROPIC_API_KEY` - Anthropic API key.
- `CF_AIG_TOKEN` - Cloudflare AI Gateway token.
- `CF_AIG_BASE_URL` - Cloudflare AI Gateway root URL, for example `https://gateway.ai.cloudflare.com/v1/<account_id>/<gateway_id>/`.

## Configuration options

No runtime configuration; everything is declared per-provider via the `AuthProvider`
manifest. Supported provider config fields include `baseUrl`, `baseUrlEnvVar`,
`requiresBaseUrl`, `modelInput`, `auth`, `apiShapes`, and `env`.
