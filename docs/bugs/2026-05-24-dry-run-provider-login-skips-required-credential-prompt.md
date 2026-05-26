# Dry-run provider login skips required credential prompt

## Summary

Running `provider login <id>` with root `--dry-run --yes` and no available API key reports that it would save a credential, even though normal execution requires credential acquisition before it can perform that login. This reproduces for Cloudflare and Poe.

## Environment

- Date reproduced: 2026-05-24
- Repository branch: `main`
- Package version: `0.0.0-dev`
- Runtime: local TypeScript CLI entrypoint with separate disposable dry-run and normal home/project directories and provider credential environment variables unset

## Reproduction

From the repository root, run the same provider login without `--api-key` under dry-run and normal execution using disposable homes:

```sh
repo=$PWD
probe=$(mktemp -d)
mkdir -p "$probe/dry/home" "$probe/dry/project" "$probe/live/home" "$probe/live/project"
(
  cd "$probe/dry/project" &&
  HOME="$probe/dry/home" env -u CF_AIG_TOKEN \
    "$repo/node_modules/.bin/tsx" \
    --import "$repo/scripts/register-template-loader.mjs" \
    "$repo/src/index.ts" --dry-run --yes provider login cloudflare \
      --base-url https://gateway.example.test
) > "$probe/dry/out" 2>&1
(
  cd "$probe/live/project" &&
  HOME="$probe/live/home" env -u CF_AIG_TOKEN \
    "$repo/node_modules/.bin/tsx" \
    --import "$repo/scripts/register-template-loader.mjs" \
    "$repo/src/index.ts" --yes provider login cloudflare \
      --base-url https://gateway.example.test </dev/null
) > "$probe/live/out" 2>&1 || true
printf '%s\n' '=== dry-run output ==='
cat "$probe/dry/out"
printf '%s\n' '=== normal output without stdin credential ==='
cat "$probe/live/out"
printf '%s\n' '=== normal files without credential ==='
find "$probe/live/home" -type f -print | sort || true
(
  cd "$probe/dry/project" &&
  HOME="$probe/dry/home" env -u POE_API_KEY \
    "$repo/node_modules/.bin/tsx" \
    --import "$repo/scripts/register-template-loader.mjs" \
    "$repo/src/index.ts" --dry-run --yes provider login poe
)
```

## Observed Behavior

- Dry-run exits successfully and prints `Dry run: would save credential for cloudflare.` even though no API key was passed and `CF_AIG_TOKEN` is unset.
- The equivalent normal command displays the `Cloudflare AI Gateway token` prompt instead of reporting a saved credential.
- Without a supplied secret, normal execution creates no credential or provider configuration file.
- The equivalent dry-run `provider login poe` invocation with `POE_API_KEY` unset also exits successfully with `Dry run: would save credential for poe.` rather than entering or previewing Poe's preferred authentication flow.

## Expected Behavior

Dry-run must validate that required provider login inputs are available, or explicitly preview that an interactive credential prompt is required instead of reporting a credential save as completed.

## Impact

- CI and scripted previews can appear ready to apply even though live execution will block awaiting a credential.
- Users receive a false-success preview for an incomplete provider setup operation.
- Dry-run does not accurately model provider login prerequisites alongside its already omitted filesystem effects.

## Supporting Evidence

In `src/cli/commands/provider.ts`, the entire call to `container.providerRegistry.login(...)`, including its API-key resolution and secret prompt path, is skipped when `flags.dryRun` is true. The command then unconditionally calls `resources.context.complete(...)` with `Dry run: would save credential for ${id}.`.

## Suspected Area

Dry-run provider login must execute non-mutating credential availability validation or render an unresolved prompt requirement instead of unconditional success output.
