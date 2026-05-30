---
name: "Unconfigure Goose does not restore overwritten user settings"
---

# Unconfigure Goose does not restore overwritten user settings

## Summary

Configuring Goose overwrites existing user `GOOSE_PROVIDER`, `GOOSE_MODEL`, and `CUSTOM_POE_API_KEY` values, and a later `unconfigure goose` deletes those keys rather than restoring the original user values.

## Environment

- Date reproduced: 2026-05-24
- Repository branch: `main`
- Package version: `0.0.0-dev`
- Runtime: local TypeScript CLI entrypoint with disposable home/project directories and a stubbed Goose model catalog response

## Reproduction

From the repository root, seed existing Goose settings/secrets, configure Goose through Poe Code, then unconfigure it:

```sh
repo=$PWD
probe=$(mktemp -d)
mkdir -p "$probe/home/.config/goose" "$probe/project"
cat > "$probe/home/.config/goose/config.yaml" <<'EOF'
GOOSE_PROVIDER: user_provider
GOOSE_MODEL: user_model
USER_SETTING: keep
EOF
cat > "$probe/home/.config/goose/secrets.yaml" <<'EOF'
CUSTOM_POE_API_KEY: user_existing_secret
USER_SECRET: keep
EOF
cat > "$probe/fetch-preload.mjs" <<'EOF'
globalThis.fetch = async () => new Response(JSON.stringify({ data: [
  { id: 'anthropic/claude-opus-4.7', context_window: { context_length: 200000 } },
  { id: 'anthropic/claude-sonnet-4.6', context_window: { context_length: 200000 } },
  { id: 'openai/gpt-5.3-codex', context_window: { context_length: 128000 } },
  { id: 'openai/gpt-5.5', context_window: { context_length: 1050000 } },
  { id: 'google/gemini-3.1-pro', context_window: { context_length: 1000000 } }
] }), { status: 200, headers: { 'content-type': 'application/json' } });
EOF
run() {
  (
    cd "$probe/project" &&
    HOME="$probe/home" \
      "$repo/node_modules/.bin/tsx" \
      --import "$probe/fetch-preload.mjs" \
      --import "$repo/scripts/register-template-loader.mjs" \
      "$repo/src/index.ts" --yes "$@"
  )
}
run configure goose --provider cloudflare --api-key cleanup-goose \
  --base-url https://gateway.example.test --model anthropic/claude-opus-4.7
cat "$probe/home/.config/goose/config.yaml"
cat "$probe/home/.config/goose/secrets.yaml"
run unconfigure goose
cat "$probe/home/.config/goose/config.yaml"
cat "$probe/home/.config/goose/secrets.yaml"
```

## Observed Behavior

- Configuration replaces `GOOSE_PROVIDER: user_provider`, `GOOSE_MODEL: user_model`, and `CUSTOM_POE_API_KEY: user_existing_secret` with Poe Code-managed values.
- Unconfigure preserves unrelated `USER_SETTING` and `USER_SECRET` keys.
- Unconfigure removes the overwritten provider/model/API-key keys entirely; it does not restore any of their original user values.

## Expected Behavior

If configuration overwrites pre-existing Goose values, unconfigure must restore those original values or avoid destructive replacement of configuration it does not own.

## Impact

- Users lose prior Goose provider, model, and secret configuration after trying and removing Poe Code setup.
- Restoration requires manual recreation of secret and routing state that existed before configuration.
- Top-level logout inherits this destructive cleanup behavior because it delegates to service unconfigure.

## Supporting Evidence

In `src/providers/goose.ts`, configure merges managed values into `~/.config/goose/config.yaml` and `secrets.yaml`. Its unconfigure manifest prunes `GOOSE_PROVIDER`, `GOOSE_MODEL`, `GOOSE_DISABLE_KEYRING`, and `CUSTOM_POE_API_KEY` when the current provider is `custom_poe`, without persisting or restoring overwritten pre-existing values.

## Suspected Area

Goose configuration needs backup/restore semantics for replaced user-owned fields, or it must write isolated managed state without overwriting existing configuration.
