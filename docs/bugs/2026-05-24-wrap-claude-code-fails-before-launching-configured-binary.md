# Wrap claude-code fails before launching the configured binary

## Summary

Running `wrap claude-code` for a Poe-configured Claude Code service fails with `Cannot resolve "agentBaseUrl": no active provider on context.` before it invokes the Claude binary.

## Environment

- Date reproduced: 2026-05-24
- Repository branch: `main`
- Package version: `0.0.0-dev`
- Runtime: local TypeScript CLI entrypoint with disposable home/project directories and a fake `claude` executable

## Reproduction

From the repository root, create current-format configured-service metadata for `claude-code`, provide a Poe API key, and substitute a fake Claude executable that would record any launch:

```sh
probe=$(mktemp -d)
mkdir -p "$probe/bin" "$probe/home/.config/poe-code" "$probe/project"
cat > "$probe/home/.config/poe-code/services.json" <<'EOF'
{"configured_services":{"claude-code":{"provider":"poe","apiShape":"anthropic-messages","files":[]}}}
EOF

cat > "$probe/bin/claude" <<'EOF'
#!/bin/sh
printf '%s\n' "$*" >> "$FAKE_CLAUDE_LOG"
printf 'FAKE_CLAUDE_OK\n'
exit 0
EOF
chmod +x "$probe/bin/claude"

(
  cd "$probe/project"
  PATH="$probe/bin:$PATH" POE_API_KEY="probe-key" FAKE_CLAUDE_LOG="$probe/claude.log" HOME="$probe/home" \
    /path/to/poe-code/node_modules/.bin/tsx \
    --import /path/to/poe-code/scripts/register-template-loader.mjs \
    /path/to/poe-code/src/index.ts wrap claude-code -- --version
)

test -f "$probe/claude.log" && cat "$probe/claude.log" || printf 'claude was not invoked\n'
```

Replace `/path/to/poe-code` with the repository checkout path.

## Observed Behavior

- The CLI exits with an error: `Cannot resolve "agentBaseUrl": no active provider on context.`
- The fake `claude` executable is never invoked.
- The failure occurs even though `claude-code` is configured for Poe and `POE_API_KEY` is provided.

## Expected Behavior

`wrap claude-code` should resolve the configured Poe provider context, populate its isolated Claude environment/settings, and launch the requested Claude CLI command.

## Impact

- The advertised Claude Code isolated wrapper is unusable for a normally configured Poe service.
- Users cannot run Claude Code through the wrapper even when authentication and service metadata are present.
- Any workflow relying on `poe-code wrap claude-code` fails before reaching the agent process.

## Supporting Evidence

In `src/providers/claude-code.ts`, the wrapper's `cliSettings.env.ANTHROPIC_BASE_URL` value is declared as `{ kind: "agentBaseUrl" }`, which requires an active provider. In `src/cli/commands/wrap.ts`, the command resolves an adapter and calls `isolatedEnvRunner(...)` without passing provider context. In `src/cli/isolated-env-runner.ts`, `resolveCliSettings(input.env, input.isolated, input.providerName)` is called without an `activeProvider`, so `src/cli/isolated-env.ts` throws when resolving `agentBaseUrl`.

## Suspected Area

The wrapper runner path must resolve and forward the active provider when isolated environment or CLI setting values depend on provider credentials or endpoint URLs.
