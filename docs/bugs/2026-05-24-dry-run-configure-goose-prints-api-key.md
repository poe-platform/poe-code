# Dry-run configure Goose prints the API key

## Summary

Running `configure goose` with root `--dry-run` prints the supplied Poe API key in plaintext inside the preview diff for Goose secrets files.

## Environment

- Date reproduced: 2026-05-24
- Repository branch: `main`
- Package version: `0.0.0-dev`
- Runtime: local TypeScript CLI entrypoint with disposable home/project directories and a stubbed API response

## Reproduction

From the repository root, preview Goose configuration using a recognizable probe key and inspect the emitted diff:

```sh
repo=$PWD
probe=$(mktemp -d)
mkdir -p "$probe/home" "$probe/project"
cat > "$probe/fetch-preload.mjs" <<'EOF'
globalThis.fetch = async (url) => String(url).includes('/usage/current_balance')
  ? new Response(JSON.stringify({ email: 'probe@example.invalid', current_point_balance: 1 }), { status: 200, headers: { 'content-type': 'application/json' } })
  : new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
EOF
(
  cd "$probe/project" &&
  HOME="$probe/home" \
    "$repo/node_modules/.bin/tsx" \
    --import "$probe/fetch-preload.mjs" \
    --import "$repo/scripts/register-template-loader.mjs" \
    "$repo/src/index.ts" --dry-run --yes configure goose \
      --provider poe --api-key probe-goose-secret --model test-model
) > "$probe/out" 2>&1
grep -nE 'CUSTOM_POE_API_KEY|probe-goose-secret|redacted' "$probe/out"
```

## Observed Behavior

- The dry-run diff for `~/.config/goose/secrets.yaml` includes `+CUSTOM_POE_API_KEY: probe-goose-secret`.
- The same plaintext secret is printed again for the isolated Goose secrets-file preview under `~/.poe-code/goose/.../secrets.yaml`.
- Unlike the OpenCode auth preview, which renders `<redacted>`, Goose preview output exposes the full supplied credential.

## Expected Behavior

Dry-run configuration output must redact secrets in all generated file previews, including YAML secret values used by Goose. A supplied API key must never be rendered to terminal output.

## Impact

- Credentials can be copied into terminal scrollback, CI logs, shell captures, or support transcripts during a preview command.
- The key is exposed twice, increasing disclosure risk for users validating configuration before applying it.
- Provider-specific output violates the redaction behavior users can observe in other configuration previews.

## Supporting Evidence

In `src/providers/goose.ts`, the Goose configure manifest writes `CUSTOM_POE_API_KEY` into `~/.config/goose/secrets.yaml`. In `src/cli/commands/configure.ts`, dry-run still executes configuration mutations through `providerContext.command.fs`. In `src/cli/context.ts`, a dry-run command context wraps the filesystem in `createDryRunFileSystem(...)` and prints the recorder's formatted operations through `formatDryRunOperations(...)`; the resulting YAML preview does not redact the key value, even though other provider previews redact credential values.

## Suspected Area

Mutation diff rendering needs secret-aware redaction for Goose secrets targets or secret-bearing manifest values generally.
