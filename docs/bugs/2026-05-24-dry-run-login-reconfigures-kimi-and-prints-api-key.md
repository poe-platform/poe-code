# Dry-run login reconfigures Kimi and prints the API key

## Summary

Running `login --api-key` with root `--dry-run` when Kimi is configured prints the newly supplied Poe API key in plaintext while previewing dependent Kimi reconfiguration.

## Environment

- Date reproduced: 2026-05-24
- Repository branch: `main`
- Package version: `0.0.0-dev`
- Runtime: local TypeScript CLI entrypoint with disposable home/project directories and a stubbed authentication response

## Reproduction

From the repository root, declare an existing Poe-backed Kimi service, then preview login with a recognizable replacement key:

```sh
repo=$PWD
probe=$(mktemp -d)
mkdir -p "$probe/home/.poe-code" "$probe/project"
cat > "$probe/home/.poe-code/config.json" <<'EOF'
{"configured_services":{"kimi":{"provider":"poe","apiShape":"openai-chat-completions","files":[]}}}
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
    "$repo/src/index.ts" --dry-run --yes login --api-key login-kimi-secret
) > "$probe/out" 2>&1
grep -nE 'api_key|login-kimi-secret|redacted' "$probe/out"
```

## Observed Behavior

- Login previews global and isolated Kimi configuration updates before printing `Dry run: would save API key.`
- Each Kimi TOML preview includes `+api_key = "login-kimi-secret"` in plaintext.
- The command reports `# no filesystem changes`, but discloses the proposed replacement secret twice through output.

## Expected Behavior

A dry-run login must redact the supplied API key in every dependent service reconfiguration preview. Kimi configuration output must not reveal credential values.

## Impact

- Previewing an API-key rotation for an existing Kimi setup leaks the new secret before it is stored.
- Logs collected for setup validation or troubleshooting can capture the credential twice.
- A command presented as safe simulation becomes an information-disclosure path based on configured services.

## Supporting Evidence

In `src/cli/commands/login.ts`, dry-run login passes the supplied key to configured Poe-backed services' `configure(...)` implementations. In `src/providers/kimi.ts`, configuration writes that credential as `api_key` in TOML. In `src/utils/dry-run.ts`, TOML redaction does not include `api_key`, so both global and isolated preview diffs reveal the value.

## Suspected Area

Login reconfiguration previews require provider-independent secret redaction for TOML output.
