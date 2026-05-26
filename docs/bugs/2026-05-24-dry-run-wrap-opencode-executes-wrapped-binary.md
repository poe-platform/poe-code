# Dry-run wrap opencode executes the wrapped binary

## Summary

Running `wrap opencode` with the root `--dry-run` option still launches the OpenCode executable after previewing isolated configuration changes.

## Environment

- Date reproduced: 2026-05-24
- Repository branch: `main`
- Package version: `0.0.0-dev`
- Runtime: local TypeScript CLI entrypoint with disposable home/project directories and a fake `opencode` executable

## Reproduction

From the repository root, create an already configured OpenCode service with stored Poe credentials and substitute a fake executable that records launches:

```sh
probe=$(mktemp -d)
mkdir -p "$probe/bin" "$probe/home/.poe-code" "$probe/home/.poe-code/opencode/.config/opencode" "$probe/project"
cat > "$probe/home/.poe-code/config.json" <<'EOF'
{"configured_services":{"opencode":{"provider":"poe","apiShape":"openai-chat-completions","files":[]}}}
EOF
printf '{}\n' > "$probe/home/.poe-code/opencode/.config/opencode/config.json"

HOME="$probe/home" /path/to/poe-code/node_modules/.bin/tsx -e \
  "import { EncryptedFileStore } from '/path/to/poe-code/packages/auth-store/src/encrypted-file-store.ts'; void (async () => { const store = new EncryptedFileStore({ filePath: process.env.HOME + '/.poe-code/credentials.poe.enc', salt: 'poe-code:encrypted-file-auth-store:v1' }); await store.set('stored-probe-key'); })();"

cat > "$probe/bin/opencode" <<'EOF'
#!/bin/sh
printf 'argv:' >> "$FAKE_OPENCODE_LOG"
printf ' <%s>' "$@" >> "$FAKE_OPENCODE_LOG"
printf '\nXDG_CONFIG_HOME:%s\n' "$XDG_CONFIG_HOME" >> "$FAKE_OPENCODE_LOG"
printf 'OPENCODE_EXECUTED_UNDER_DRY_RUN\n'
exit 0
EOF
chmod +x "$probe/bin/opencode"

(
  cd "$probe/project"
  PATH="$probe/bin:$PATH" FAKE_OPENCODE_LOG="$probe/opencode.log" HOME="$probe/home" \
    /path/to/poe-code/node_modules/.bin/tsx \
    --import /path/to/poe-code/scripts/register-template-loader.mjs \
    /path/to/poe-code/src/index.ts --dry-run wrap opencode -- --version
)

cat "$probe/opencode.log"
```

Replace `/path/to/poe-code` with the repository checkout path.

## Observed Behavior

- The CLI renders dry-run previews for isolated OpenCode configuration mutations.
- It then prints `OPENCODE_EXECUTED_UNDER_DRY_RUN` from the fake executable.
- The launch marker records `argv: <--version>` and an isolated `XDG_CONFIG_HOME`, proving the wrapped binary is run while dry-run is enabled.

## Expected Behavior

With root `--dry-run`, `wrap opencode` must not execute the wrapped external binary. It should preview configuration refresh and the proposed invocation only.

## Impact

- A preview command can execute arbitrary agent CLI behavior, including network calls, billing, or user-defined hooks.
- Output misleadingly mixes simulated configuration operations with a real process execution.
- Users cannot safely validate wrapper arguments or isolated setup before launching the agent.

## Supporting Evidence

The root CLI advertises `--dry-run` as `Simulate commands without writing changes.` in `src/cli/program.ts`. In `src/cli/commands/wrap.ts`, the command resolves root flags only for `ensureIsolatedConfigForService(...)`, then unconditionally calls `isolatedEnvRunner(...)`. In `src/cli/isolated-env-runner.ts`, `spawn(details.agentBinary, args, ...)` launches the wrapped executable without a dry-run guard.

## Suspected Area

Direct wrapper execution must short-circuit or preview the wrapped command when root dry-run mode is enabled.
