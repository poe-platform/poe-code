# Dry-run configure Kimi prints the API key

## Summary

Running `configure kimi` with root `--dry-run` prints the supplied Poe API key in plaintext inside the preview diff for Kimi TOML configuration files.

## Environment

- Date reproduced: 2026-05-24
- Repository branch: `main`
- Package version: `0.0.0-dev`
- Runtime: local TypeScript CLI entrypoint with disposable home/project directories and a stubbed authentication response

## Reproduction

From the repository root, preview Kimi configuration using a recognizable probe key and inspect the generated TOML diff:

```sh
repo=$PWD
probe=$(mktemp -d)
mkdir -p "$probe/home" "$probe/project"
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
    "$repo/src/index.ts" --dry-run --yes configure kimi \
      --provider poe --api-key preview-kimi-secret --model test-model
) > "$probe/out" 2>&1
grep -nE 'api_key|preview-kimi-secret|redacted' "$probe/out"
```

## Observed Behavior

- The global Kimi config preview includes `+api_key = "preview-kimi-secret"` in plaintext.
- The isolated Kimi config preview includes the same plaintext API key a second time.
- The CLI otherwise reports `Dry run: would configure Kimi.` without writing the files.

## Expected Behavior

Dry-run configuration output must redact API-key values in Kimi TOML previews. A supplied credential must never be printed in terminal output.

## Impact

- Credentials can leak into terminal scrollback, CI output, command transcripts, and support logs during a preview operation.
- Kimi exposes the key twice because global and isolated configuration diffs are both rendered.
- Redaction behavior is inconsistent with Codex TOML and OpenCode JSON previews, which conceal credentials.

## Supporting Evidence

In `src/providers/kimi.ts`, the Kimi manifest writes `provider?.credential` to `providers.poe.api_key` in `~/.kimi/config.toml`. In `src/cli/context.ts`, dry-run renders recorded file operations using `formatDryRunOperations(...)`. In `src/utils/dry-run.ts`, TOML redaction recognizes `experimental_bearer_token` but not Kimi's `api_key`, so the generated diff exposes the credential.

## Suspected Area

TOML dry-run redaction must recognize Kimi API-key fields, or redact secret-bearing values independently of provider-specific key names.
