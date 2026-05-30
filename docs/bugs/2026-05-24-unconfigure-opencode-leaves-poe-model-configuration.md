---
name: "Unconfigure OpenCode leaves Poe model configuration"
---

# Unconfigure OpenCode leaves Poe model configuration

## Summary

Running `unconfigure opencode` after Poe Code configuration reports `Removed OpenCode CLI configuration.` but leaves Poe-selected OpenCode model configuration in both global and isolated config files; when configuration replaced an existing user model, that prior value is not restored.

## Environment

- Date reproduced: 2026-05-24
- Repository branch: `main`
- Package version: `0.0.0-dev`
- Runtime: local TypeScript CLI entrypoint with disposable home/project directories

## Reproduction

From the repository root, configure and unconfigure OpenCode with a disposable home, then inspect remaining configuration files:

```sh
repo=$PWD
probe=$(mktemp -d)
mkdir -p "$probe/home" "$probe/project"
mkdir -p "$probe/home/.config/opencode"
printf '{\n  "model": "user/original",\n  "theme": "light"\n}\n' > "$probe/home/.config/opencode/config.json"
run() {
  (
    cd "$probe/project" &&
    HOME="$probe/home" \
      "$repo/node_modules/.bin/tsx" \
      --import "$repo/scripts/register-template-loader.mjs" \
      "$repo/src/index.ts" --yes "$@"
  )
}
run configure opencode --provider cloudflare --api-key cleanup-open \
  --base-url https://gateway.example.test --model cleanup-open
run unconfigure opencode
run unconfigure opencode
mkdir -p "$probe/bin"
cat > "$probe/bin/opencode" <<'EOF'
#!/bin/sh
find "$XDG_CONFIG_HOME" -type f -print -exec cat {} \;
printf 'OPEN_CODE_OK\n'
EOF
chmod +x "$probe/bin/opencode"
(
  cd "$probe/project" &&
  HOME="$probe/home" PATH="$probe/bin:$PATH" \
    "$repo/node_modules/.bin/tsx" \
    --import "$repo/scripts/register-template-loader.mjs" \
    "$repo/src/index.ts" --yes test opencode --isolated
)
find "$probe/home" -type f -print | sort
cat "$probe/home/.config/opencode/config.json"
cat "$probe/home/.poe-code/opencode/.config/opencode/config.json"
```

## Observed Behavior

- OpenCode configuration overwrites the pre-existing user model `user/original` with the Poe Code-managed model selection `poe/cleanup-open` while preserving unrelated `theme` state.
- `unconfigure opencode` reports successful removal and removes its auth configuration.
- After unconfigure, `~/.config/opencode/config.json` and the isolated OpenCode config both still contain `"$schema": "https://opencode.ai/config.json"` and `"model": "poe/cleanup-open"`; the original user model is not restored.
- A second `unconfigure opencode` reports `No OpenCode CLI configuration found.` even though both residual Poe-selected model files remain on disk.
- After unconfigure, `test opencode --isolated` still launches a fake OpenCode executable successfully using the residual isolated config containing `"model": "poe/cleanup-open"`.

## Expected Behavior

Unconfiguring OpenCode must remove Poe Code-owned model selection and provider/auth configuration from both global and isolated OpenCode config locations, or clearly report partial cleanup.

## Impact

- Users are told OpenCode was removed while Poe Code-selected runtime behavior remains configured.
- Later OpenCode launches may continue using the Poe-prefixed model selection after authentication/provider cleanup, instead of the model the user had before configuration.
- Top-level logout, which invokes service unconfigure, inherits this incomplete cleanup behavior.
- Once configured-service metadata is removed, later cleanup attempts no longer acknowledge the remaining managed model state.
- An agent reported unconfigured can still execute health checks with the retained Poe-selected model configuration.

## Supporting Evidence

In `src/providers/opencode.ts`, the configure manifest merges `$schema`, `model`, and `enabled_providers` into OpenCode config, plus auth data into `auth.json`. The unconfigure manifest prunes only `enabled_providers` and the auth provider entry; it does not remove the Poe Code-written `model` value from either global or isolated configuration.

## Suspected Area

OpenCode unconfigure needs ownership-aware removal of the Poe Code-selected model value in addition to provider and auth fields.
