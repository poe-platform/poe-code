# Dry-run login reconfigures Goose and prints the API key

## Summary

Running `login --api-key` with root `--dry-run` when Goose is already configured prints the newly supplied Poe API key in plaintext while previewing dependent Goose reconfiguration.

## Environment

- Date reproduced: 2026-05-24
- Repository branch: `main`
- Package version: `0.0.0-dev`
- Runtime: local TypeScript CLI entrypoint with disposable home/project directories and a stubbed authentication response

## Reproduction

From the repository root, declare an existing Poe-backed Goose service and preview login with a recognizable replacement key:

```sh
repo=$PWD
probe=$(mktemp -d)
mkdir -p "$probe/home/.poe-code" "$probe/project"
cat > "$probe/home/.poe-code/config.json" <<'EOF'
{"configured_services":{"goose":{"provider":"poe","apiShape":"openai-chat-completions","files":[]}}}
EOF
cat > "$probe/fetch-preload.mjs" <<'EOF'
globalThis.fetch = async () => new Response(
  JSON.stringify({ email: 'probe@example.invalid', current_point_balance: 1 }),
  { status: 200, headers: { 'content-type': 'application/json' } }
);
EOF
(
  cd "$probe/project" &&
  HOME="$probe/home" \
    "$repo/node_modules/.bin/tsx" \
    --import "$probe/fetch-preload.mjs" \
    --import "$repo/scripts/register-template-loader.mjs" \
    "$repo/src/index.ts" --dry-run --yes login --api-key probe-login-secret
) > "$probe/out" 2>&1
grep -nE 'CUSTOM_POE_API_KEY|probe-login-secret|redacted' "$probe/out"
```

## Observed Behavior

- The command prints `Dry run: would save API key.` and reports `# no filesystem changes` after previewing existing Goose reconfiguration.
- The global Goose secrets diff includes `+CUSTOM_POE_API_KEY: probe-login-secret`.
- The isolated Goose secrets diff also includes the plaintext replacement key, exposing it twice during a login preview.

## Expected Behavior

A login dry-run must never render the supplied API key in dependent service configuration previews. Secret-bearing Goose reconfiguration output should be redacted just like other credential previews.

## Impact

- A user previewing a credential rotation can disclose the replacement API key in logs before choosing to save it.
- Existing Goose configuration turns a login simulation into a plaintext secret-output path.
- The key is exposed in both global and isolated reconfiguration diffs, expanding accidental leak opportunities.

## Supporting Evidence

In `src/cli/commands/login.ts`, dry-run login builds a provider payload with the supplied key and calls configured services' `configure(...)` implementations for Poe-backed entries. In `src/providers/goose.ts`, Goose writes `CUSTOM_POE_API_KEY` into its secrets YAML. In `src/cli/context.ts`, the dry-run filesystem records and formats proposed file writes through `formatDryRunOperations(...)`, which outputs the Goose YAML key value without redaction during login-driven reconfiguration.

## Suspected Area

Login-driven service reconfiguration needs the same secret-aware diff redaction required by direct Goose configuration previews.
