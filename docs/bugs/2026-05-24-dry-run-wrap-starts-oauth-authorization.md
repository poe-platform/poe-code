# Dry-run wrap starts OAuth authorization

## Summary

Running `wrap opencode` with root `--dry-run` for a Poe-configured service and no available credential starts an interactive OAuth authorization flow before reaching the wrapped executable.

## Environment

- Date reproduced: 2026-05-24
- Repository branch: `main`
- Package version: `0.0.0-dev`
- Runtime: local TypeScript CLI entrypoint with disposable home/project directories and a bounded probe terminated after observing OAuth startup

## Reproduction

From the repository root, configure OpenCode service metadata without credentials, then preview a wrapped command. The process waits for authorization, so terminate it after observing the output:

```sh
repo=$PWD
probe=$(mktemp -d)
mkdir -p "$probe/home/.poe-code" "$probe/project"
cat > "$probe/home/.poe-code/config.json" <<'EOF'
{"configured_services":{"opencode":{"provider":"poe","apiShape":"openai-chat-completions","files":[]}}}
EOF
(
  cd "$probe/project" &&
  HOME="$probe/home" \
    "$repo/node_modules/.bin/tsx" \
    --import "$repo/scripts/register-template-loader.mjs" \
    "$repo/src/index.ts" --dry-run --yes wrap opencode -- --version
)
```

## Observed Behavior

- Before invoking OpenCode, the wrapper prints a Poe OAuth authorization URL with a local callback endpoint.
- It waits for authorization rather than completing a dry-run invocation preview.
- The behavior occurs on the isolated-configuration preparation path and is distinct from dry-run wrapper process execution when credentials are already available.

## Expected Behavior

With root `--dry-run`, wrapper preparation must not initiate OAuth authorization. It should preview the isolated setup and proposed external command without authenticating or launching the wrapped process.

## Impact

- A wrapper preview can open authentication UI and block automation before reaching the requested tool.
- Users cannot safely evaluate isolated wrapper setup for logged-out Poe-configured services.
- Dry-run wrapper behavior can perform either live authentication or live process execution depending on existing credential state.

## Supporting Evidence

The root CLI advertises `--dry-run` as `Simulate commands without writing changes.` in `src/cli/program.ts`. In `src/cli/commands/wrap.ts`, dry-run still calls `ensureIsolatedConfigForService(...)`. In `src/cli/commands/ensure-isolated-config.ts`, Poe-backed payload creation reaches `container.options.resolveApiKey(...)`; `src/cli/options.ts` calls `init.loginViaOAuth()` when no credential exists without suppressing it under dry-run, and `src/cli/oauth-login.ts` starts the authorization workflow.

## Suspected Area

Dry-run isolated wrapper preparation must short-circuit credential acquisition before generating invocation previews.
