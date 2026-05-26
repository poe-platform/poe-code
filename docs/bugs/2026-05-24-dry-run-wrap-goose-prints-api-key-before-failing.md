# Dry-run wrap Goose prints the API key before failing

## Summary

Running `wrap goose` with root `--dry-run` for a Poe-configured Goose service prints the available Poe API key in plaintext while previewing isolated secrets configuration, then fails because the previewed configuration was not persisted.

## Environment

- Date reproduced: 2026-05-24
- Repository branch: `main`
- Package version: `0.0.0-dev`
- Runtime: local TypeScript CLI entrypoint with disposable home/project directories, an environment probe key, and stubbed Poe API responses

## Reproduction

From the repository root, declare a Poe-backed Goose service and preview wrapping it with an environment credential:

```sh
repo=$PWD
probe=$(mktemp -d)
mkdir -p "$probe/home/.poe-code" "$probe/project"
cat > "$probe/home/.poe-code/config.json" <<'EOF'
{"configured_services":{"goose":{"provider":"poe","apiShape":"openai-chat-completions","files":[]}}}
EOF
cat > "$probe/fetch-preload.mjs" <<'EOF'
globalThis.fetch = async (url) => String(url).includes('/usage/current_balance')
  ? new Response(JSON.stringify({ email: 'probe@example.invalid', current_point_balance: 1 }), { status: 200, headers: { 'content-type': 'application/json' } })
  : new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
EOF
(
  cd "$probe/project" &&
  POE_API_KEY=wrap-preview-secret HOME="$probe/home" \
    "$repo/node_modules/.bin/tsx" \
    --import "$probe/fetch-preload.mjs" \
    --import "$repo/scripts/register-template-loader.mjs" \
    "$repo/src/index.ts" --dry-run --yes wrap goose -- --version
) > "$probe/out" 2>&1 || true
grep -nE 'CUSTOM_POE_API_KEY|wrap-preview-secret|Error:' "$probe/out"
```

## Observed Behavior

- The isolated Goose secrets preview prints `+CUSTOM_POE_API_KEY: wrap-preview-secret` in plaintext.
- The preparation path also performs authenticated dry-run requests to Poe API-key validation and model-catalog endpoints.
- After exposing the secret in terminal output, the command errors with `goose is not configured. Run 'poe-code login' or 'poe-code configure goose'.` because the dry-run preview does not create the configuration it immediately expects for execution.

## Expected Behavior

With root `--dry-run`, `wrap goose` must not reveal credentials, make authenticated setup requests, or attempt a configuration-dependent execution after only previewing configuration. It should display a redacted, coherent invocation preview.

## Impact

- A wrapper preview discloses an environment-provided API key in terminal or CI output even though it does not successfully run Goose.
- Users can leak credentials while attempting to diagnose why the wrapper cannot launch.
- The command combines secret exposure with a misleading failure caused by its own preview-only setup sequence.

## Supporting Evidence

In `src/cli/commands/wrap.ts`, dry-run still invokes `ensureIsolatedConfigForService(...)` before continuing toward wrapper execution. In `src/cli/commands/ensure-isolated-config.ts`, Goose configuration is applied through the mutation preview path. In `src/providers/goose.ts`, the generated isolated secrets YAML stores `CUSTOM_POE_API_KEY`; that value is printed without redaction in the preview diff before wrapper execution fails.

## Suspected Area

Goose wrapper dry-run needs secret-redacted preview rendering and must short-circuit before execution or post-preview configuration checks.
