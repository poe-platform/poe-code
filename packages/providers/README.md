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
      id: "anthropic-messages"
    }
  ]
};
```

`baseUrl` and `baseUrlEnvVar` are optional. `baseUrl` is only for providers that have a real
provider-level default. When a provider declares `baseUrlEnvVar`, consumers may resolve a
provider base URL from that environment variable before falling back to stored provider config
or declared defaults. When `apiShapes[].defaultBaseUrl` is absent, consumers derive the default
shape URL from `baseUrl` plus `apiShapes[].envBaseUrlPath` or `apiShapes[].baseUrlPath`.

`requiresBaseUrl: true` marks providers, such as Cloudflare AI Gateway, that cannot be
configured without an explicit gateway URL. `modelInput: { kind: "freeform" }` marks providers
whose model names must be typed by the user rather than selected from an agent-owned list.

## Registry

```ts
import { ProviderRegistry } from "@poe-code/providers";

const registry = new ProviderRegistry([anthropic, poe]);
registry.list(); // all providers, construction order
registry.get("anthropic"); // AuthProvider | undefined
registry.forAgent({ id: "claude-code", apiShapes: ["anthropic-messages"] });
```

## Auth strategies

Strategies are dispatched on `auth.kind`. The registry login and credential-resolution APIs
currently support `auth.kind: "api-key"`. The api-key strategy stores the credential in a
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

1. `context.resolvePreferredLogin` when the provider declares `auth.preferredLogin`
2. Explicit `options.apiKey`
3. The provider's declared `auth.envVar` from `context.envVars`
4. `promptForSecret`

`preferredLogin` is optional. It lets a provider prefer a custom login flow, such as OAuth,
while still storing the resulting API key through the same provider secret store. If no
`resolvePreferredLogin` callback is supplied, login falls back to the generic API-key flow.

Native `auth.kind: "oauth"` provider manifests are type-level only in this package today.
`ProviderRegistry.login()` and `ProviderRegistry.resolveCredential()` reject them because no
OAuth registry strategy is implemented. Providers that need an OAuth login flow should declare
`auth.kind: "api-key"` with `preferredLogin: "oauth"` and supply `resolvePreferredLogin`.

`ProviderRegistry.isLoggedIn()` also treats a non-empty declared env var as logged in,
matching what `login()` would use in CI.

## CLI integration

`poe-code provider login <id>` stores the provider credential and any provider endpoint
metadata needed later by `poe-code configure`. `--base-url <url>` must be an `http` or
`https` URL; for providers with `apiShapes[].baseUrlPath`, Poe Code derives and stores the
shape-specific endpoint URLs from that root. `--shape-base-url <shape-id>=<url>` can set or
override individual API-shape endpoints directly.

Providers with `requiresBaseUrl: true`, such as Cloudflare AI Gateway, require a gateway
root URL before they can configure an agent. Interactive login prompts for the URL when no
`--base-url`, `--shape-base-url`, or `baseUrlEnvVar` value is available. Non-interactive
`--yes` login must receive the URL through one of those inputs.

During `poe-code configure <agent> --provider <id>`, the active API-shape base URL resolves
from explicit shape URLs, then `--base-url`, then the provider `baseUrlEnvVar`, then stored
login metadata, then the shape's default URL. Providers with `modelInput: { kind: "freeform" }`
use the configured model, an explicit `--model`, or an interactive text prompt; `--yes`
requires one of those model sources.

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
manifest.

Provider manifest options:

- `id`, `label`, `summary`, `baseUrl`, `baseUrlEnvVar`, `requiresBaseUrl`, and
  `modelInput`
- `auth.kind: "api-key"` with `envVar`, `storageKey`, `prompt`, and optional
  `preferredLogin: "oauth"`
- `apiShapes` for provider API compatibility and shape-specific URL suffixes/defaults
- `env` for provider-specific environment values derived from literals, credentials, base
  URLs, or provider fields
