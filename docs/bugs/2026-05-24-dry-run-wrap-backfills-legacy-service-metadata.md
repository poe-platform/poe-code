# Dry-run wrap backfills legacy service metadata

## Summary

Running `wrap opencode` with root `--dry-run` rewrites a valid legacy configured-service record to add inferred `provider` and `apiShape` fields while preparing the isolated wrapper configuration.

## Environment

- Date reproduced: 2026-05-24
- Repository branch: `main`
- Package version: `0.0.0-dev`
- Runtime: local TypeScript CLI entrypoint with disposable home/project directories and a fake `opencode` executable

## Reproduction

From the repository root, create a legacy OpenCode entry plus an existing isolated probe file, then execute the wrapped binary through a fake recorder:

```sh
repo=$PWD
probe=$(mktemp -d)
mkdir -p "$probe/bin" "$probe/home/.poe-code/opencode/.config/opencode" "$probe/project"
cat > "$probe/home/.poe-code/config.json" <<'EOF'
{"configured_services":{"opencode":{"files":[]}}}
EOF
printf '{}\n' > "$probe/home/.poe-code/opencode/.config/opencode/config.json"
cat > "$probe/bin/opencode" <<'EOF'
#!/bin/sh
printf 'launched\n' >> "$FAKE_LOG"
exit 0
EOF
chmod +x "$probe/bin/opencode"
printf '%s\n' '=== before ==='
cat "$probe/home/.poe-code/config.json"
(
  cd "$probe/project" &&
  PATH="$probe/bin:$PATH" FAKE_LOG="$probe/fake.log" POE_API_KEY=probe-key HOME="$probe/home" \
    "$repo/node_modules/.bin/tsx" \
    --import "$repo/scripts/register-template-loader.mjs" \
    "$repo/src/index.ts" --dry-run --yes wrap opencode -- --version
)
printf '%s\n' '=== after ==='
cat "$probe/home/.poe-code/config.json"
cat "$probe/fake.log"
```

## Observed Behavior

- The CLI previews isolated OpenCode configuration changes under dry-run and launches the fake wrapped binary.
- The global config changes from `{"configured_services":{"opencode":{"files":[]}}}` to a formatted record containing `"provider": "poe"` and `"apiShape": "openai-chat-completions"`.
- This persisted metadata migration is separate from the wrapped-process execution side effect: it occurs while resolving the provider for isolated configuration preparation.

## Expected Behavior

With root `--dry-run`, `wrap` must not migrate global configured-service metadata while preparing an invocation preview. Any inferred provider information should remain non-persisting.

## Impact

- Previewing wrapper setup changes valid global configuration in addition to executing the wrapped process.
- Users cannot safely inspect isolated wrapper behavior without upgrading stored service metadata.
- Dry-run wrapper workflows can dirty configuration state even when no isolated-config write is intended to be committed.

## Supporting Evidence

The root CLI advertises `--dry-run` as `Simulate commands without writing changes.` in `src/cli/program.ts`. In `src/cli/commands/wrap.ts`, the command calls `ensureIsolatedConfigForService(...)` during dry-run. In `src/cli/commands/ensure-isolated-config.ts`, provider resolution reaches `loadConfiguredServices(...)`; the configured-service loader in `packages/poe-code-config/src/configured-services.ts` normalizes legacy entries and persists inferred metadata during reads.

## Suspected Area

Isolated-config preparation must use side-effect-free configured-service reads whenever wrapper execution is being simulated.
