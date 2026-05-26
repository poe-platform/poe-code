# Dry-run wrap Kimi prints the API key before failing

## Summary

Running `wrap kimi` with root `--dry-run` for a Poe-configured Kimi service prints the available Poe API key in plaintext while previewing isolated setup, then fails before launching Kimi.

## Environment

- Date reproduced: 2026-05-24
- Repository branch: `main`
- Package version: `0.0.0-dev`
- Runtime: local TypeScript CLI entrypoint with disposable home/project directories, an environment probe key, and a fake `kimi` executable

## Reproduction

From the repository root, declare a Poe-backed Kimi service and preview a wrapped invocation using an environment key:

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
  PATH="$probe/bin:$PATH" FAKE_LOG="$probe/fake.log" POE_API_KEY=wrap-kimi-secret HOME="$probe/home" \
    "$repo/node_modules/.bin/tsx" \
    --import "$repo/scripts/register-template-loader.mjs" \
    "$repo/src/index.ts" --dry-run --yes wrap kimi -- --version
) > "$probe/out" 2>&1 || true
grep -nE 'api_key|wrap-kimi-secret|Error:' "$probe/out"
cat "$probe/fake.log" 2>/dev/null || true
```

## Observed Behavior

- The isolated Kimi setup preview prints `+api_key = "wrap-kimi-secret"` in plaintext.
- It then fails with `kimi is not configured. Run 'poe-code login' or 'poe-code configure kimi'.` because previewed isolated configuration was not written.
- The fake Kimi executable is not launched, but the environment key has already been disclosed in the output.

## Expected Behavior

With root `--dry-run`, `wrap kimi` must redact credentials and provide a coherent invocation preview without requiring the configuration it only simulated creating.

## Impact

- Attempting to diagnose wrapper behavior through dry-run can reveal a live API key before any external binary runs.
- The preview leaks sensitive data and then errors, encouraging users to share output that contains credentials.
- Kimi wrapper simulation is neither safe nor usable for logged-in configurations lacking isolated files.

## Supporting Evidence

In `src/cli/commands/wrap.ts`, dry-run calls `ensureIsolatedConfigForService(...)` and then proceeds toward wrapper execution. In `src/providers/kimi.ts`, isolated TOML configuration stores the credential as `api_key`. In `src/utils/dry-run.ts`, TOML preview redaction omits `api_key`, so the secret is exposed before the wrapper detects that previewed configuration does not exist on disk.

## Suspected Area

Kimi wrapper previews need TOML secret redaction and must not proceed into configuration-dependent execution after simulated setup.
