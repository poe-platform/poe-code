---
name: "Unconfigure Kimi deletes untracked user provider config"
---

# Unconfigure Kimi deletes untracked user provider config

## Summary

Running `unconfigure kimi` removes a user-created `[providers.poe]` configuration block even when Kimi was never configured or tracked by Poe Code.

## Environment

- Date reproduced: 2026-05-24
- Repository branch: `main`
- Package version: `0.0.0-dev`
- Runtime: local TypeScript CLI entrypoint with disposable home/project directories and manually seeded Kimi files only

## Reproduction

From the repository root, create a Kimi Poe-compatible configuration without invoking any Poe Code configure command, then run unconfigure:

```sh
repo=$PWD
probe=$(mktemp -d)
mkdir -p "$probe/home/.kimi/credentials" "$probe/project"
cat > "$probe/home/.kimi/config.toml" <<'EOF'
default_model = "poe/user-managed"
[providers.poe]
type = "openai_legacy"
base_url = "https://user.example.test/v1"
api_key = "user-own-secret"
EOF
cat > "$probe/home/.kimi/credentials/kimi-code.json" <<'EOF'
{"access_token":"user-own-token","token_type":"Bearer","expires_at":2094999999}
EOF
(
  cd "$probe/project" &&
  HOME="$probe/home" \
    "$repo/node_modules/.bin/tsx" \
    --import "$repo/scripts/register-template-loader.mjs" \
    "$repo/src/index.ts" --yes unconfigure kimi
)
cat "$probe/home/.kimi/config.toml"
cat "$probe/home/.kimi/credentials/kimi-code.json"
find "$probe/home/.poe-code" -type f -print 2>/dev/null || true
```

## Observed Behavior

- No Poe Code configuration metadata exists before the command; the Kimi files are user-seeded only.
- `unconfigure kimi` reports `Removed Kimi configuration.`.
- The user-created `[providers.poe]` block, including its custom base URL and API key, is deleted from `~/.kimi/config.toml`; unrelated `default_model` and the user token file remain.

## Expected Behavior

Unconfigure must remove only configuration owned or tracked by Poe Code. It must not delete a user's independently created Kimi Poe provider block solely because it uses the provider id `poe`.

## Impact

- Users can lose working independently managed Kimi provider credentials and endpoint settings by running a cleanup command for Poe Code.
- Ownership cannot be inferred from provider names alone; compatible user configurations are destructive false positives.
- The command reports successful cleanup without warning that user-managed state was removed.

## Supporting Evidence

In `src/cli/commands/unconfigure.ts`, the service manifest is invoked even when no configured-service metadata exists. In `src/providers/kimi.ts`, the unconfigure transform removes any `providers.poe` entry it finds, without requiring proof that Poe Code created or owns that block.

## Suspected Area

Kimi unconfigure must require tracked ownership or durable marker metadata before removing an existing provider block, and it must avoid targeting user-managed compatible configurations.
