---
name: "Unconfigure Gemini CLI does not restore backed-up user settings"
---

# Unconfigure Gemini CLI does not restore backed-up user settings

## Summary

Configuring Gemini CLI backs up and replaces existing user auth/model settings, but `unconfigure gemini-cli` strips the managed values from the live file instead of restoring the backed-up original configuration.

## Environment

- Date reproduced: 2026-05-24
- Repository branch: `main`
- Package version: `0.0.0-dev`
- Runtime: local TypeScript CLI entrypoint with disposable home/project directories

## Reproduction

From the repository root, seed an existing Gemini settings file, configure Gemini CLI, then unconfigure it:

```sh
repo=$PWD
probe=$(mktemp -d)
mkdir -p "$probe/home/.gemini" "$probe/project"
cat > "$probe/home/.gemini/settings.json" <<'EOF'
{
  "security": {"auth": {"selectedType": "oauth-personal"}},
  "model": {"name": "user-original-model"},
  "theme": "keep"
}
EOF
run() {
  (
    cd "$probe/project" &&
    HOME="$probe/home" \
      "$repo/node_modules/.bin/tsx" \
      --import "$repo/scripts/register-template-loader.mjs" \
      "$repo/src/index.ts" --yes "$@"
  )
}
run configure gemini-cli --provider cloudflare --api-key cleanup-gemini \
  --base-url https://gateway.example.test --model gemini-clean
find "$probe/home/.gemini" -type f -print | sort
cat "$probe/home/.gemini/settings.json"
run unconfigure gemini-cli
find "$probe/home/.gemini" -type f -print | sort
cat "$probe/home/.gemini/settings.json"
```

## Observed Behavior

- Configuration creates a timestamped `settings.json.backup-*` file and replaces the live settings with `selectedType: "gemini-api-key"` plus `model.name: "gemini-clean"`, retaining unrelated `theme` state.
- Unconfigure preserves the backup file but leaves the live `settings.json` as `{ "theme": "keep" }`.
- The original user auth selection `oauth-personal` and model `user-original-model` are not restored to the active settings file despite the available backup.

## Expected Behavior

When Gemini configuration backs up an existing settings file before replacing auth/model values, unconfigure must restore the original managed fields or restore the backup while preserving subsequent unrelated user changes safely.

## Impact

- Users lose their previous Gemini login method and model preference after trying and removing Poe Code configuration.
- A backup exists but is not automatically applied, requiring manual recovery of active settings.
- Top-level logout inherits the same incomplete restoration because it invokes service unconfigure.

## Supporting Evidence

In `src/providers/gemini-cli.ts`, configure performs `fileMutation.backup({ target: "~/.gemini/settings.json" })` before merging managed auth/model fields. Its unconfigure transform removes managed `security.auth.selectedType` and `model.name` values from the current document but never restores the backup or the prior overwritten values.

## Suspected Area

Gemini unconfigure should restore the prior settings snapshot or maintain field-level backup metadata so removed managed configuration returns the user to their original active auth/model state.
