# Provider login base URL overrides explicit shape URL

## Summary

When `provider login cloudflare` receives both a gateway `--base-url` and an explicit `--shape-base-url` for the same API shape, the derived gateway URL overwrites the explicit shape URL instead of honoring the more specific option.

## Environment

- Date reproduced: 2026-05-24
- Repository branch: `main`
- Package version: `0.0.0-dev`
- Runtime: local TypeScript CLI entrypoint with disposable home/project directories

## Reproduction

From the repository root, log in to Cloudflare while overriding its OpenAI Responses shape URL, then configure Codex from that provider:

```sh
repo=$PWD
probe=$(mktemp -d)
mkdir -p "$probe/home" "$probe/project"
(
  cd "$probe/project" &&
  HOME="$probe/home" \
    "$repo/node_modules/.bin/tsx" \
    --import "$repo/scripts/register-template-loader.mjs" \
    "$repo/src/index.ts" --yes provider login cloudflare \
      --api-key precedence-secret \
      --base-url https://root-gateway.example.test \
      --shape-base-url openai-responses=https://specific-responses.example.test/v1
)
cat "$probe/home/.config/poe-code/services.json"
(
  cd "$probe/project" &&
  HOME="$probe/home" \
    "$repo/node_modules/.bin/tsx" \
    --import "$repo/scripts/register-template-loader.mjs" \
    "$repo/src/index.ts" --yes configure codex --provider cloudflare \
      --model precedence-codex --reasoning-effort high
)
rg -n 'base_url|root-gateway|specific-responses' "$probe/home/.codex/config.toml"
```

## Observed Behavior

- The stored Cloudflare `openai-responses` shape URL is `https://root-gateway.example.test/openai`.
- The supplied explicit URL `https://specific-responses.example.test/v1` does not appear in the provider configuration.
- Codex is consequently configured with the derived generic gateway URL instead of the explicitly requested Responses endpoint.

## Expected Behavior

An explicit `--shape-base-url openai-responses=<url>` must override the URL derived for that shape from `--base-url`, while `--base-url` supplies defaults only for shapes without explicit values.

## Impact

- Users cannot set one shape-specific endpoint while deriving the remaining Cloudflare endpoints from a gateway root in a single login command.
- Codex and other shape-specific agents silently route requests to the wrong endpoint despite an explicit CLI override.
- Provider routing configuration appears accepted but disregards the most precise user input.

## Supporting Evidence

In `src/cli/commands/provider.ts`, `resolveProviderLoginShapeBaseUrls(...)` returns `{ ...shapeBaseUrls, ...deriveShapeBaseUrls(input.provider, explicitBaseUrl) }` when `--base-url` is present. Because derived values are spread second, they overwrite matching explicit shape values parsed from `--shape-base-url`.

## Suspected Area

Gateway-derived shape URLs must be merged first and explicit `--shape-base-url` entries applied last so user overrides take precedence.
