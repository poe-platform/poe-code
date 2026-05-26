# Dry-run provider login omits base URL config write

## Summary

Running `provider login cloudflare --base-url ...` with root `--dry-run` reports `# no filesystem changes`, even though the equivalent normal command writes Cloudflare shape base URLs to the Poe Code services configuration file.

## Environment

- Date reproduced: 2026-05-24
- Repository branch: `main`
- Package version: `0.0.0-dev`
- Runtime: local TypeScript CLI entrypoint with separate disposable dry-run and normal home/project directories

## Reproduction

From the repository root, compare dry-run and normal Cloudflare provider login executions using separate disposable homes:

```sh
repo=$PWD
probe=$(mktemp -d)
mkdir -p "$probe/dry/home" "$probe/dry/project" "$probe/live/home" "$probe/live/project"
(
  cd "$probe/dry/project" &&
  HOME="$probe/dry/home" \
    "$repo/node_modules/.bin/tsx" \
    --import "$repo/scripts/register-template-loader.mjs" \
    "$repo/src/index.ts" --dry-run --yes provider login cloudflare \
      --api-key preview-secret --base-url https://preview-gateway.example.test
) > "$probe/dry/out" 2>&1
(
  cd "$probe/live/project" &&
  HOME="$probe/live/home" \
    "$repo/node_modules/.bin/tsx" \
    --import "$repo/scripts/register-template-loader.mjs" \
    "$repo/src/index.ts" --yes provider login cloudflare \
      --api-key live-secret --base-url https://live-gateway.example.test
) > "$probe/live/out" 2>&1
printf '%s\n' '=== dry-run output ==='
cat "$probe/dry/out"
printf '%s\n' '=== dry-run files ==='
find "$probe/dry/home" -type f -print | sort || true
printf '%s\n' '=== normal services config ==='
cat "$probe/live/home/.config/poe-code/services.json"
```

## Observed Behavior

- Dry-run prints `Dry run: would save credential for cloudflare.` followed by `# no filesystem changes`.
- Normal provider login creates `~/.config/poe-code/services.json` containing Cloudflare `shapeBaseUrls` derived from the supplied gateway root URL.
- Dry-run does not preview the services configuration write that would occur in normal execution.

## Expected Behavior

Dry-run output must preview all non-secret filesystem mutations that a provider login would perform, including persisted provider base URL mappings, while redacting any credential write as needed.

## Impact

- Users cannot review which stored endpoint mappings will be introduced by a provider login before applying it.
- Dry-run incorrectly communicates that provider login has no filesystem effect beyond an abstract credential operation.
- Endpoint routing changes can be missed during automation, security review, and migration planning.

## Supporting Evidence

In `src/cli/commands/provider.ts`, both `container.providerRegistry.login(...)` and `saveProviderShapeBaseUrls(...)` are inside `if (!flags.dryRun)`, so dry-run does not record or render the provider URL configuration mutation. In normal execution, `saveProviderShapeBaseUrls(...)` persists the generated shape URLs through `packages/poe-code-config/src/provider-config.ts` to `~/.config/poe-code/services.json`.

## Suspected Area

Provider login needs a dry-run-aware mutation path that records intended provider configuration updates without persisting credentials or metadata.
