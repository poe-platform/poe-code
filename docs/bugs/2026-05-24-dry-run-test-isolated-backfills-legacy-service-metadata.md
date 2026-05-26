# Dry-run isolated test backfills legacy service metadata

## Summary

Running `test opencode --isolated` with root `--dry-run` rewrites a valid legacy configured-service entry to add inferred `provider` and `apiShape` fields while reporting no filesystem changes.

## Environment

- Date reproduced: 2026-05-24
- Repository branch: `main`
- Package version: `0.0.0-dev`
- Runtime: local TypeScript CLI entrypoint with disposable home/project directories

## Reproduction

From the repository root, create a legacy OpenCode service record and existing isolated configuration probe, then preview its isolated health check:

```sh
repo=$PWD
probe=$(mktemp -d)
mkdir -p "$probe/home/.poe-code/opencode/.config/opencode" "$probe/project"
cat > "$probe/home/.poe-code/config.json" <<'EOF'
{"configured_services":{"opencode":{"files":[]}}}
EOF
printf '{}\n' > "$probe/home/.poe-code/opencode/.config/opencode/config.json"
printf '%s\n' '=== before ==='
cat "$probe/home/.poe-code/config.json"
(
  cd "$probe/project" &&
  POE_API_KEY=probe-key HOME="$probe/home" \
    "$repo/node_modules/.bin/tsx" \
    --import "$repo/scripts/register-template-loader.mjs" \
    "$repo/src/index.ts" --dry-run --yes test opencode --isolated
)
printf '%s\n' '=== after ==='
cat "$probe/home/.poe-code/config.json"
```

## Observed Behavior

- The CLI prints `Dry run: opencode run Output exactly: OPEN_CODE_OK --format json` and `Dry run: would test OpenCode CLI.` followed by `# no filesystem changes`.
- The config changes from `{"configured_services":{"opencode":{"files":[]}}}` to a formatted record containing `"provider": "poe"` and `"apiShape": "openai-chat-completions"`.
- No OpenCode process is launched, but isolated health-check preparation still persists a global metadata migration.

## Expected Behavior

With root `--dry-run`, an isolated test preview must not modify global configuration. Inferred metadata needed to resolve isolated settings should be kept in memory only.

## Impact

- An isolated diagnostic preview silently upgrades valid configuration while asserting no filesystem changes.
- Users cannot safely preview provider-backed health checks against legacy but supported service entries.
- Diagnostic automation can dirty managed config files without executing the actual health check.

## Supporting Evidence

The root CLI advertises `--dry-run` as `Simulate commands without writing changes.` in `src/cli/program.ts`. In `src/cli/commands/test.ts`, the `--isolated` path calls `ensureIsolatedConfigForService(...)` during dry-run. In `src/cli/commands/ensure-isolated-config.ts`, active-provider resolution reaches `loadConfiguredServices(...)`; `packages/poe-code-config/src/configured-services.ts` writes inferred legacy metadata while loading configured services.

## Suspected Area

Isolated health-check setup should resolve configured services through a non-persisting read mode in dry-run execution.
