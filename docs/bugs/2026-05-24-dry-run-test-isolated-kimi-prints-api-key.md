# Dry-run isolated Kimi test prints the API key

## Summary

Running `test kimi --isolated` with root `--dry-run` for a Poe-configured Kimi service prints the available Poe API key in plaintext while previewing isolated setup.

## Environment

- Date reproduced: 2026-05-24
- Repository branch: `main`
- Package version: `0.0.0-dev`
- Runtime: local TypeScript CLI entrypoint with disposable home/project directories, an environment probe key, and a fake `kimi` executable on `PATH`

## Reproduction

From the repository root, declare a Poe-backed Kimi service and preview its isolated health check with an environment credential:

```sh
repo=$PWD
probe=$(mktemp -d)
mkdir -p "$probe/bin" "$probe/home/.poe-code" "$probe/project"
cat > "$probe/home/.poe-code/config.json" <<'EOF'
{"configured_services":{"kimi":{"provider":"poe","apiShape":"openai-chat-completions","files":[]}}}
EOF
cat > "$probe/bin/kimi" <<'EOF'
#!/bin/sh
printf 'invoked\n' >> "$FAKE_LOG"
exit 0
EOF
chmod +x "$probe/bin/kimi"
(
  cd "$probe/project" &&
  PATH="$probe/bin:$PATH" FAKE_LOG="$probe/fake.log" POE_API_KEY=test-kimi-secret HOME="$probe/home" \
    "$repo/node_modules/.bin/tsx" \
    --import "$repo/scripts/register-template-loader.mjs" \
    "$repo/src/index.ts" --dry-run --yes test kimi --isolated
) > "$probe/out" 2>&1
grep -nE 'api_key|test-kimi-secret|Dry run:' "$probe/out"
cat "$probe/fake.log" 2>/dev/null || true
```

## Observed Behavior

- The isolated Kimi TOML setup diff includes `+api_key = "test-kimi-secret"` in plaintext.
- The CLI then prints a dry-run Kimi health-check invocation and `Dry run: would test Kimi.`.
- The fake executable is not invoked, but the environment credential is exposed while preparing the preview.

## Expected Behavior

An isolated health-check preview must redact API-key values while displaying proposed setup. Credentials provided through environment variables must not be printed.

## Impact

- Diagnostic previews can leak a live environment credential even without running the underlying CLI.
- Captured test output may disclose credentials in CI, shell history attachments, or bug reports.
- Users cannot safely preview isolated Kimi health-check setup with authentication enabled.

## Supporting Evidence

In `src/cli/commands/test.ts`, the `--isolated` dry-run path calls `ensureIsolatedConfigForService(...)`. In `src/providers/kimi.ts`, isolated configuration includes the provider credential under the TOML field `api_key`. In `src/utils/dry-run.ts`, TOML diff redaction does not cover that key name, leaving it visible in preview output.

## Suspected Area

Isolated setup previews need comprehensive TOML credential redaction before any health-check output is displayed.
