# Dry-run isolated Goose test prints the API key

## Summary

Running `test goose --isolated` with root `--dry-run` for a Poe-configured Goose service prints the available Poe API key in plaintext while previewing isolated test setup.

## Environment

- Date reproduced: 2026-05-24
- Repository branch: `main`
- Package version: `0.0.0-dev`
- Runtime: local TypeScript CLI entrypoint with disposable home/project directories, an environment probe key, and stubbed Poe API responses

## Reproduction

From the repository root, declare a Poe-backed Goose service and preview its isolated health check using an environment credential:

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
  POE_API_KEY=test-preview-secret HOME="$probe/home" \
    "$repo/node_modules/.bin/tsx" \
    --import "$probe/fetch-preload.mjs" \
    --import "$repo/scripts/register-template-loader.mjs" \
    "$repo/src/index.ts" --dry-run --yes test goose --isolated
) > "$probe/out" 2>&1
grep -nE 'CUSTOM_POE_API_KEY|test-preview-secret|Dry run:' "$probe/out"
```

## Observed Behavior

- The isolated setup diff prints `+CUSTOM_POE_API_KEY: test-preview-secret` in plaintext.
- Setup also performs authenticated API-key validation and Poe model-catalog requests before the health-check command preview.
- The CLI subsequently prints `Dry run: goose run --text "Reply with exactly: GOOSE_OK" --output-format text` and `# no filesystem changes`, despite already exposing the credential.

## Expected Behavior

An isolated health-check preview must redact credentials and avoid authenticated remote enrichment while rendering proposed setup. No API key should be printed to terminal output.

## Impact

- Diagnostic dry-runs can leak credentials in local logs, CI output, or shared troubleshooting captures.
- A user testing an already configured Goose environment may disclose an environment key without running Goose itself.
- The explicit no-filesystem-change result conceals a separate high-risk information disclosure side effect.

## Supporting Evidence

In `src/cli/commands/test.ts`, the `--isolated` dry-run path calls `ensureIsolatedConfigForService(...)`. In `src/cli/commands/ensure-isolated-config.ts`, this applies the Goose configuration through mutation previews. In `src/providers/goose.ts`, isolated secrets include `CUSTOM_POE_API_KEY`, and the preview renderer outputs its value without redaction before reporting the dry-run health check.

## Suspected Area

Isolated-test configuration previews require secret-aware redaction and a no-network dry-run contract for provider enrichment.
