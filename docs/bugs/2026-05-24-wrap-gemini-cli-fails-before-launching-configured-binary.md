# Wrap gemini-cli fails before launching the configured binary

## Summary

Running `wrap gemini-cli` for a Poe-configured Gemini CLI service fails with `Cannot resolve "providerCredential": no active provider on context.` before it invokes the Gemini binary.

## Environment

- Date reproduced: 2026-05-24
- Repository branch: `main`
- Package version: `0.0.0-dev`
- Runtime: local TypeScript CLI entrypoint with disposable home/project directories and a fake `gemini` executable

## Reproduction

From the repository root, create current-format configured-service metadata and the expected isolated config probe for `gemini-cli`, provide a Poe API key, and substitute a fake Gemini executable:

```sh
probe=$(mktemp -d)
mkdir -p "$probe/bin" "$probe/home/.config/poe-code" "$probe/home/.poe-code/gemini-cli" "$probe/project"
cat > "$probe/home/.config/poe-code/services.json" <<'EOF'
{"configured_services":{"gemini-cli":{"provider":"poe","apiShape":"google-generative-ai","files":[]}}}
EOF
printf '{}\n' > "$probe/home/.poe-code/gemini-cli/settings.json"

cat > "$probe/bin/gemini" <<'EOF'
#!/bin/sh
printf '%s\n' "$*" >> "$FAKE_GEMINI_LOG"
printf 'FAKE_GEMINI_OK\n'
exit 0
EOF
chmod +x "$probe/bin/gemini"

(
  cd "$probe/project"
  PATH="$probe/bin:$PATH" POE_API_KEY="probe-key" FAKE_GEMINI_LOG="$probe/gemini.log" HOME="$probe/home" \
    /path/to/poe-code/node_modules/.bin/tsx \
    --import /path/to/poe-code/scripts/register-template-loader.mjs \
    /path/to/poe-code/src/index.ts wrap gemini-cli -- --version
)

test -f "$probe/gemini.log" && cat "$probe/gemini.log" || printf 'gemini was not invoked\n'
```

Replace `/path/to/poe-code` with the repository checkout path.

## Observed Behavior

- The CLI exits with an error: `Cannot resolve "providerCredential": no active provider on context.`
- The fake `gemini` executable is never invoked.
- The failure occurs even though `gemini-cli` is configured for Poe, its isolated config probe exists, and `POE_API_KEY` is supplied.

## Expected Behavior

`wrap gemini-cli` should resolve the configured Poe provider context, provide the isolated Gemini credential/base URL environment values, and launch the requested Gemini CLI command.

## Impact

- The advertised Gemini CLI isolated wrapper is unusable for a configured Poe service.
- Users cannot execute Gemini CLI through `poe-code wrap` even after configuring authentication and service metadata.
- Any workflow relying on the wrapped Gemini binary fails before the underlying command starts.

## Supporting Evidence

In `src/providers/gemini-cli.ts`, the isolated environment requires `{ kind: "providerCredential" }` and `{ kind: "providerBaseUrl" }`. In `src/cli/commands/wrap.ts`, the wrapper calls `isolatedEnvRunner(...)` without passing an active provider. In `src/cli/isolated-env-runner.ts`, `resolveIsolatedEnvDetails(...)` is invoked without provider context, causing `src/cli/isolated-env.ts` to throw while resolving `providerCredential`.

## Suspected Area

The wrapper runner path must resolve and forward the active configured provider for services whose isolated environments depend on provider credential or endpoint values.
