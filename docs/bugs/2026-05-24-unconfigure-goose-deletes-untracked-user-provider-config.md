# Unconfigure Goose deletes untracked user provider config

## Summary

Running `unconfigure goose` deletes a user-created `custom_poe` provider, API key, provider selection, and model selection even when Goose was never configured or tracked by Poe Code.

## Environment

- Date reproduced: 2026-05-24
- Repository branch: `main`
- Package version: `0.0.0-dev`
- Runtime: local TypeScript CLI entrypoint with disposable home/project directories and manually seeded Goose files only

## Reproduction

From the repository root, seed independent Goose configuration using the `custom_poe` provider name and run unconfigure:

```sh
repo=$PWD
probe=$(mktemp -d)
mkdir -p "$probe/home/.config/goose/custom_providers" "$probe/project"
cat > "$probe/home/.config/goose/config.yaml" <<'EOF'
GOOSE_PROVIDER: custom_poe
GOOSE_MODEL: user_model
USER_SETTING: keep
EOF
cat > "$probe/home/.config/goose/secrets.yaml" <<'EOF'
CUSTOM_POE_API_KEY: user-own-secret
USER_SECRET: keep
EOF
cat > "$probe/home/.config/goose/custom_providers/custom_poe.json" <<'EOF'
{"name":"custom_poe","base_url":"https://user.example.test/chat/completions"}
EOF
(
  cd "$probe/project" &&
  HOME="$probe/home" \
    "$repo/node_modules/.bin/tsx" \
    --import "$repo/scripts/register-template-loader.mjs" \
    "$repo/src/index.ts" --yes unconfigure goose
)
find "$probe/home/.config/goose" -type f -print | sort
cat "$probe/home/.config/goose/config.yaml"
cat "$probe/home/.config/goose/secrets.yaml"
```

## Observed Behavior

- No Poe Code configured-service metadata exists; all Goose files are user-seeded only.
- `unconfigure goose` reports `Removed Goose configuration.`.
- It removes `custom_providers/custom_poe.json`, deletes `GOOSE_PROVIDER: custom_poe`, `GOOSE_MODEL: user_model`, and `CUSTOM_POE_API_KEY: user-own-secret`, preserving only unrelated settings/secrets.

## Expected Behavior

Unconfigure must remove only Goose provider/state established and tracked by Poe Code. It must not assume ownership of a user-created provider just because it uses the `custom_poe` identifier.

## Impact

- Users can lose independent Goose provider routing, model configuration, and API secrets by running Poe Code cleanup.
- Compatible manual configuration is treated as Poe Code-owned without metadata or consent.
- The surviving Goose files no longer contain the user's previously working provider/model setup.

## Supporting Evidence

In `src/cli/commands/unconfigure.ts`, unconfigure runs service manifests even in the absence of configured-service metadata. In `src/providers/goose.ts`, unconfigure removes `CUSTOM_PROVIDER_FILE` unconditionally and prunes Goose keys whenever `GOOSE_PROVIDER` equals `custom_poe`, without establishing Poe Code ownership.

## Suspected Area

Goose unconfigure must require tracked ownership or use a non-colliding managed provider identifier and backup/restore strategy for user-created compatible configurations.
