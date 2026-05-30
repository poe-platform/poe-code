---
name: "Provider login endpoint write failure leaves credential installed"
---

# Provider login endpoint write failure leaves credential installed

## Summary

When `provider login cloudflare` stores the credential successfully but cannot persist the provider endpoint mapping, the command exits with an error while leaving the Cloudflare token installed and usable by later configuration commands.

## Environment

- Date reproduced: 2026-05-24
- Repository branch: `main`
- Package version: `0.0.0-dev`
- Runtime: local TypeScript CLI entrypoint with a disposable home/project directory and a blocker file at the provider services-config parent path

## Reproduction

From the repository root, prevent creation of `~/.config/poe-code/services.json`, run Cloudflare provider login, and then use the failed login's stored credential without passing another API key:

```sh
repo=$PWD
probe=$(mktemp -d)
mkdir -p "$probe/home/.config" "$probe/project"
printf 'blocking-parent\n' > "$probe/home/.config/poe-code"
run() {
  (
    cd "$probe/project" &&
    HOME="$probe/home" \
      "$repo/node_modules/.bin/tsx" \
      --import "$repo/scripts/register-template-loader.mjs" \
      "$repo/src/index.ts" --yes "$@"
  )
}
run provider login cloudflare \
  --api-key partial-provider-secret \
  --base-url https://gateway.example.test || true
run provider list
run configure codex --provider cloudflare \
  --base-url https://gateway.example.test \
  --model after-failed-login --reasoning-effort high
cat "$probe/home/.codex/config.toml"
find "$probe/home/.poe-code" -type f -print | sort
```

## Observed Behavior

- `provider login cloudflare` fails with `ENOTDIR: not a directory, open '~/.config/poe-code/services.json'`.
- Despite the failed command, `provider list` reports Cloudflare as `[logged in]` and `~/.poe-code/credentials.cloudflare.enc` exists.
- A later `configure codex --provider cloudflare ...` invocation succeeds without `--api-key` and writes `experimental_bearer_token = "partial-provider-secret"`, proving that the credential from the failed login was retained and consumed.
- The configured command must receive a manual `--base-url` because the endpoint mapping part of the failed login was not installed.

## Expected Behavior

Provider login must be atomic across credential storage and provider endpoint persistence: if endpoint mapping cannot be saved, the newly written credential must be rolled back or the command must not commit either mutation until all required writes can succeed.

## Impact

- A command that reports login failure can still install a live provider credential on disk.
- Automation may retry or request another token unnecessarily while a secret has already been persisted.
- The provider enters a split state: authenticated but missing the required saved endpoint mapping, requiring manual repair and increasing the risk of routing misconfiguration.

## Supporting Evidence

In `src/cli/commands/provider.ts`, `executeProviderLogin(...)` calls `container.providerRegistry.login(...)` before resolving and writing shape base URLs through `saveProviderShapeBaseUrls(...)`. There is no rollback if the later services-config write throws, allowing the encrypted provider credential to survive a failed login command.

## Suspected Area

Provider login needs transactional staging/rollback across encrypted credential writes and provider endpoint configuration persistence.
