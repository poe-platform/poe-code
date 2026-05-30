---
name: "Unconfigure Kimi leaves Poe model and managed token files"
---

# Unconfigure Kimi leaves Poe model and managed token files

## Summary

Running `unconfigure kimi` after Poe-backed Kimi configuration reports `Removed Kimi configuration.` but leaves Poe-added default model/model catalog entries and a Poe-managed credential token file in both global and isolated Kimi configuration locations; a prior user default model is not restored.

## Environment

- Date reproduced: 2026-05-24
- Repository branch: `main`
- Package version: `0.0.0-dev`
- Runtime: local TypeScript CLI entrypoint with disposable home/project directories and a stubbed Poe authentication response

## Reproduction

From the repository root, configure and unconfigure Kimi in a disposable home, then inspect its remaining files:

```sh
repo=$PWD
probe=$(mktemp -d)
mkdir -p "$probe/home/.kimi" "$probe/project"
cat > "$probe/home/.kimi/config.toml" <<'EOF'
default_model = "user/original-kimi"
custom_setting = true
EOF
cat > "$probe/fetch-preload.mjs" <<'EOF'
globalThis.fetch = async () => new Response(
  JSON.stringify({ email: 'probe@example.invalid', current_point_balance: 1 }),
  { status: 200, headers: { 'content-type': 'application/json' } }
);
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
run configure kimi --provider poe --api-key cleanup-secret --model cleanup-kimi
cat "$probe/home/.kimi/config.toml"
cat "$probe/home/.kimi/credentials/kimi-code.json"
run unconfigure kimi
run unconfigure kimi
run test kimi --isolated || true
find "$probe/home" -type f -print | sort
cat "$probe/home/.kimi/config.toml"
cat "$probe/home/.kimi/credentials/kimi-code.json"
cat "$probe/home/.poe-code/kimi/.kimi/config.toml"
cat "$probe/home/.poe-code/kimi/.kimi/credentials/kimi-code.json"
```

## Observed Behavior

- Kimi configuration overwrites the pre-existing user default model `user/original-kimi` with `poe/cleanup-kimi`, while writing a Poe provider block with `api_key = "cleanup-secret"`, Poe model entries, and `credentials/kimi-code.json` containing a `poe-managed` access token marker.
- `unconfigure kimi` prints `Removed Kimi configuration.` and removes the plaintext `providers.poe.api_key` block.
- After unconfigure, global and isolated `config.toml` files remain with the Poe default model and Poe model catalog entries, the original user default is not restored, and both `credentials/kimi-code.json` files remain containing the Poe-managed token data.
- A second `unconfigure kimi` prints `No Kimi configuration found.` even though those Poe Code-created residual files and model settings are still present.
- A subsequent `test kimi --isolated` attempts to use the residual isolated file and fails with `Provider poe not found in providers` because the retained Poe models/default reference the removed provider block.

## Expected Behavior

Unconfiguring Kimi must remove the Poe Code-owned Kimi provider configuration, model/default state, and managed credential-token files from both global and isolated configuration locations, or report that cleanup is only partial.

## Impact

- Users are told Kimi was removed while Poe-managed authentication/configuration artifacts remain on disk.
- Subsequent Kimi use can still be influenced by Poe-added model defaults and token markers after an apparent unconfigure, instead of the user's original default model.
- Logout cleanup that delegates to `unconfigure kimi` likewise leaves service-owned artifacts behind.
- Once configured-service metadata is removed, later cleanup attempts deny that residual managed state exists.
- The partial cleanup leaves an invalid Kimi configuration that causes later health-check execution to fail before meaningful tool validation.

## Supporting Evidence

In `src/providers/kimi.ts`, the configure manifest writes Kimi default/model configuration and a `~/.kimi/credentials/kimi-code.json` managed-token file. Its unconfigure manifest removes the Poe provider entry from TOML but does not remove the generated model/default values or the credentials file; the same manifest is applied for the isolated Kimi configuration.

## Suspected Area

Kimi unconfigure needs ownership-aware pruning for Poe-added default/model state plus removal of its generated managed-token files in global and isolated locations.
