# Dry-run unconfigure backfills legacy service metadata

## Summary

Running `unconfigure` with root `--dry-run` rewrites an otherwise valid legacy configured-service record to add inferred `provider` and `apiShape` metadata while reporting no filesystem changes.

## Environment

- Date reproduced: 2026-05-24
- Repository branch: `main`
- Package version: `0.0.0-dev`
- Runtime: local TypeScript CLI entrypoint with disposable home/project directories

## Reproduction

From the repository root, create a valid legacy OpenCode service entry that predates provider metadata, then preview removing it:

```sh
repo=$PWD
probe=$(mktemp -d)
mkdir -p "$probe/home/.poe-code" "$probe/project"
cat > "$probe/home/.poe-code/config.json" <<'EOF'
{"configured_services":{"opencode":{"files":[]}}}
EOF
printf '%s\n' '=== before ==='
cat "$probe/home/.poe-code/config.json"
(
  cd "$probe/project" &&
  HOME="$probe/home" \
    "$repo/node_modules/.bin/tsx" \
    --import "$repo/scripts/register-template-loader.mjs" \
    "$repo/src/index.ts" --dry-run unconfigure opencode
)
printf '%s\n' '=== after ==='
cat "$probe/home/.poe-code/config.json"
```

## Observed Behavior

- The CLI prints `Dry run: would remove OpenCode CLI configuration.` and `# no filesystem changes`.
- The input document changes from `{"configured_services":{"opencode":{"files":[]}}}` to a formatted record containing `"provider": "poe"` and `"apiShape": "openai-chat-completions"`.
- The command therefore persists an inferred metadata migration during a preview-only removal operation.

## Expected Behavior

With root `--dry-run`, `unconfigure` must not rewrite existing configured-service metadata. Any legacy metadata upgrade needed to describe the preview should remain in memory only.

## Impact

- Previewing removal mutates a valid user configuration despite explicitly reporting no filesystem changes.
- Users can no longer inspect how unconfigure would behave without implicitly upgrading their config format.
- Automation that checks unconfiguration plans can dirty tracked or managed configuration state.

## Supporting Evidence

The root CLI advertises `--dry-run` as `Simulate commands without writing changes.` in `src/cli/program.ts`. In `src/cli/commands/unconfigure.ts`, `createUnconfigurePayload(...)` calls `loadConfiguredServices(...)` even for dry-run execution. The configured-service loader in `@poe-code/poe-code-config`, exercised by the expectations in `src/services/services.test.ts`, infers missing `provider` and `apiShape` fields and writes those back during load.

## Suspected Area

Configured-service normalization must support a non-persisting read mode and dry-run unconfigure should use it.
