# Unconfigure Gemini CLI deletes untracked user settings

## Summary

Running `unconfigure gemini-cli` removes user-created Gemini API-key auth selection and model settings even when Gemini CLI was never configured or tracked by Poe Code.

## Environment

- Date reproduced: 2026-05-24
- Repository branch: `main`
- Package version: `0.0.0-dev`
- Runtime: local TypeScript CLI entrypoint with disposable home/project directories and a manually seeded Gemini settings file only

## Reproduction

From the repository root, create an independent Gemini settings file and run unconfigure without a prior Poe Code configure operation:

```sh
repo=$PWD
probe=$(mktemp -d)
mkdir -p "$probe/home/.gemini" "$probe/project"
cat > "$probe/home/.gemini/settings.json" <<'EOF'
{"security":{"auth":{"selectedType":"gemini-api-key"}},"model":{"name":"user-gemini"},"theme":"keep"}
EOF
(
  cd "$probe/project" &&
  HOME="$probe/home" \
    "$repo/node_modules/.bin/tsx" \
    --import "$repo/scripts/register-template-loader.mjs" \
    "$repo/src/index.ts" --yes unconfigure gemini-cli
)
cat "$probe/home/.gemini/settings.json"
find "$probe/home/.poe-code" -type f -print 2>/dev/null || true
```

## Observed Behavior

- No Poe Code configured-service metadata or backup exists; the Gemini file is manually seeded user configuration only.
- `unconfigure gemini-cli` reports `Removed Gemini CLI configuration.`.
- It removes the user-selected `security.auth.selectedType: "gemini-api-key"` and `model.name: "user-gemini"`, leaving only unrelated `theme` state.

## Expected Behavior

Unconfigure must remove only Gemini settings installed and tracked by Poe Code. It must not delete independent user settings simply because they use the same Gemini auth mode and model shape.

## Impact

- Users can lose manually configured Gemini authentication mode and model preferences without ever configuring Gemini through Poe Code.
- Ownership is incorrectly inferred from generic configuration values used by ordinary Gemini setups.
- Restoring active auth/model settings requires manual recovery after the cleanup command.

## Supporting Evidence

In `src/cli/commands/unconfigure.ts`, the Gemini unconfigure manifest is invoked even without configured-service metadata. In `src/providers/gemini-cli.ts`, its transform treats any `selectedType === "gemini-api-key"` as managed and deletes associated auth/model settings without an ownership marker or prior backup requirement.

## Suspected Area

Gemini unconfigure must require tracked ownership or an explicit Poe Code marker/backup before deleting settings that may belong to the user.
