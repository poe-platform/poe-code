# Unconfigure isolated failure leaves split secret-bearing state

## Summary

If global removal succeeds but required isolated removal fails, `unconfigure` exits with an error after deleting the global configuration while leaving the isolated credential-bearing configuration and configured-service metadata in place. This reproduces with Codex configured through Cloudflare AI Gateway.

## Environment

- Date reproduced: 2026-05-24
- Repository branch: `main`
- Package version: `0.0.0-dev`
- Runtime: local TypeScript CLI entrypoint with a disposable home/project directory and write-protected isolated Codex directory

## Reproduction

From the repository root, configure Codex, then deny deletion from the isolated configuration directory before unconfiguring:

```sh
repo=$PWD
probe=$(mktemp -d)
mkdir -p "$probe/home" "$probe/project"
(
  cd "$probe/project" &&
  HOME="$probe/home" \
    "$repo/node_modules/.bin/tsx" \
    --import "$repo/scripts/register-template-loader.mjs" \
    "$repo/src/index.ts" --yes configure codex --provider cloudflare \
      --api-key retained-isolated-secret \
      --base-url https://gateway.example.test \
      --model cleanup-model --reasoning-effort high
)
chmod 444 "$probe/home/.poe-code/codex/config.toml"
chmod 555 "$probe/home/.poe-code/codex"
(
  cd "$probe/project" &&
  HOME="$probe/home" \
    "$repo/node_modules/.bin/tsx" \
    --import "$repo/scripts/register-template-loader.mjs" \
    "$repo/src/index.ts" --yes unconfigure codex
) > "$probe/unconfigure.out" 2>&1 || true
cat "$probe/unconfigure.out"
test -e "$probe/home/.codex/config.toml" || echo 'global config removed'
cat "$probe/home/.poe-code/codex/config.toml"
cat "$probe/home/.poe-code/config.json"
chmod 755 "$probe/home/.poe-code/codex"
chmod 644 "$probe/home/.poe-code/codex/config.toml"
```

## Observed Behavior

- `unconfigure codex` fails with `EACCES: permission denied, unlink '~/.poe-code/codex/config.toml'`.
- The global `~/.codex/config.toml` has already been removed before the command fails.
- The isolated `~/.poe-code/codex/config.toml` remains and still contains `experimental_bearer_token = "retained-isolated-secret"`.
- `~/.poe-code/config.json` still records Codex as configured because metadata removal occurs only after both mutation passes succeed.

## Expected Behavior

Unconfiguration must be atomic across global config, isolated config, and metadata: a cleanup failure should either leave the prior installed state intact or complete removal without retaining secret-bearing fragments and stale configuration records.

## Impact

- A command that appears to be removing a configured integration can fail after leaving an accessible isolated plaintext credential behind.
- Global and isolated executions disagree about whether Codex remains configured.
- Stored metadata reports a configured service whose primary global configuration was already removed, complicating recovery and automated cleanup.

## Supporting Evidence

In `src/cli/commands/unconfigure.ts`, `entry.unconfigure(...)` is invoked first against the global filesystem and then invoked a second time with an isolated path mapper. Only after both calls return does `unconfigureService(...)` remove configured-service metadata. There is no staging or rollback when the isolated invocation throws after global removal.

## Suspected Area

Unconfigure execution needs transactional staging/rollback across global files, isolated files, and configured-service metadata, particularly where service manifests remove copied credentials.
