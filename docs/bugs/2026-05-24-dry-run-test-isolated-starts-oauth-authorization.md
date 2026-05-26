# Dry-run isolated test starts OAuth authorization

## Summary

Running `test opencode --isolated` with root `--dry-run` for a Poe-configured service and no available credential starts an interactive OAuth authorization flow instead of completing its health-check preview.

## Environment

- Date reproduced: 2026-05-24
- Repository branch: `main`
- Package version: `0.0.0-dev`
- Runtime: local TypeScript CLI entrypoint with disposable home/project directories and a bounded probe terminated after observing OAuth startup

## Reproduction

From the repository root, configure service metadata without credentials, then preview the isolated test. The process waits for authorization, so terminate it after observing the output:

```sh
repo=$PWD
probe=$(mktemp -d)
mkdir -p "$probe/home/.poe-code" "$probe/project"
cat > "$probe/home/.poe-code/config.json" <<'EOF'
{"configured_services":{"opencode":{"provider":"poe","apiShape":"openai-chat-completions","files":[]}}}
EOF
(
  cd "$probe/project" &&
  HOME="$probe/home" \
    "$repo/node_modules/.bin/tsx" \
    --import "$repo/scripts/register-template-loader.mjs" \
    "$repo/src/index.ts" --dry-run --yes test opencode --isolated
)
```

## Observed Behavior

- The CLI begins `Poe - test opencode`, then prints a Poe OAuth authorization URL using a local callback endpoint.
- It waits for authorization rather than displaying and completing the dry-run health-check command.
- The operation must be interrupted after live authentication startup.

## Expected Behavior

With root `--dry-run`, an isolated test preview must not initiate OAuth. It should report that provider credentials are required, or preview the command with redacted/unresolved authentication values without external interaction.

## Impact

- A diagnostic preview can unexpectedly enter a browser-based login flow and block automation.
- Users cannot safely inspect isolated test behavior for configured but currently logged-out services.
- Dry-run diagnostics become externally interactive rather than observational.

## Supporting Evidence

The root CLI advertises `--dry-run` as `Simulate commands without writing changes.` in `src/cli/program.ts`. In `src/cli/commands/test.ts`, the `--isolated` path invokes `ensureIsolatedConfigForService(...)` during dry-run. In `src/cli/commands/ensure-isolated-config.ts`, creating the Poe-backed configure payload reaches `container.options.resolveApiKey(...)`; `src/cli/options.ts` invokes OAuth when no credential is available without suppressing it for dry-run execution.

## Suspected Area

Provider-backed isolated test preparation must not acquire credentials while executing in preview mode.
