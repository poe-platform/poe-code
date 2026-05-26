# Provider login yes prompts for missing secret and exits successfully

## Summary

Running `provider login <id>` with `--yes` and no available API key still renders an interactive password prompt, then exits successfully on closed stdin without configuring the provider. This reproduces for Anthropic and Cloudflare.

## Environment

- Date reproduced: 2026-05-24
- Repository branch: `main`
- Package version: `0.0.0-dev`
- Runtime: local TypeScript CLI entrypoint with disposable home/project directories, provider credential environment variables unset, and stdin closed to emulate non-interactive execution

## Reproduction

From the repository root, invoke Anthropic provider login in `--yes` mode without any credential input:

```sh
repo=$PWD
probe=$(mktemp -d)
mkdir -p "$probe/home" "$probe/project"
(
  cd "$probe/project" &&
  HOME="$probe/home" env -u ANTHROPIC_API_KEY \
    "$repo/node_modules/.bin/tsx" \
    --import "$repo/scripts/register-template-loader.mjs" \
    "$repo/src/index.ts" --yes provider login anthropic </dev/null
) > "$probe/login.out" 2>&1
printf 'exit_code=%s\n' "$?"
cat "$probe/login.out"
find "$probe/home" -type f -print | sort || true
(
  cd "$probe/project" &&
  HOME="$probe/home" \
    "$repo/node_modules/.bin/tsx" \
    --import "$repo/scripts/register-template-loader.mjs" \
    "$repo/src/index.ts" provider list
)
(
  cd "$probe/project" &&
  HOME="$probe/home" env -u CF_AIG_TOKEN \
    "$repo/node_modules/.bin/tsx" \
    --import "$repo/scripts/register-template-loader.mjs" \
    "$repo/src/index.ts" --yes provider login cloudflare \
      --base-url https://gateway.example.test </dev/null
)
```

## Observed Behavior

- Despite `--yes`, the command displays an interactive `Anthropic API key` password prompt.
- With stdin closed, the process exits with status `0` without printing a login error or success completion.
- No credential file is written, and `provider list` still reports Anthropic as `[-]`.
- `provider login cloudflare --base-url https://gateway.example.test` reproduces the same behavior with a `Cloudflare AI Gateway token` prompt, status `0`, and no stored credential.

## Expected Behavior

In `--yes` non-interactive mode, provider login without a required API key must fail clearly with a non-zero exit status and instructions to pass `--api-key` or set `ANTHROPIC_API_KEY`; it must not prompt.

## Impact

- CI and scripts can interpret an unconfigured provider login as successful.
- The `--yes` contract is violated by an interactive prompt in non-interactive automation.
- Subsequent commands fail later because no provider credential was stored despite the successful exit code.

## Supporting Evidence

In `src/cli/commands/provider.ts`, `executeProviderLogin(...)` always passes `promptForSecret: createSecretPrompter(container)` to `container.providerRegistry.login(...)`, even when `flags.assumeYes` is true. In `packages/providers/src/auth/api-key.ts`, a missing API key calls that prompt rather than rejecting non-interactive execution.

## Suspected Area

Provider login must suppress secret prompts under `--yes` when no credential is available and return a clear non-zero validation error instead.
