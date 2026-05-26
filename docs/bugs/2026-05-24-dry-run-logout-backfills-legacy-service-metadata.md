# Dry-run logout backfills legacy service metadata

## Summary

Running `logout` with root `--dry-run` rewrites an otherwise valid legacy configured-service record to add inferred `provider` and `apiShape` metadata while reporting no filesystem changes.

## Environment

- Date reproduced: 2026-05-24
- Repository branch: `main`
- Package version: `0.0.0-dev`
- Runtime: local TypeScript CLI entrypoint with disposable home/project directories

## Reproduction

From the repository root, create a valid legacy OpenCode service entry that predates provider metadata, then preview logging out:

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
    "$repo/src/index.ts" --dry-run logout
)
printf '%s\n' '=== after ==='
cat "$probe/home/.poe-code/config.json"
```

## Observed Behavior

- The CLI previews unconfiguring OpenCode and deleting the global config, then prints `# no filesystem changes` for each dry-run operation.
- The input document changes from `{"configured_services":{"opencode":{"files":[]}}}` to a formatted record containing `"provider": "poe"` and `"apiShape": "openai-chat-completions"`.
- The logout preview therefore persists a configured-service metadata migration without deleting the config it claims only to preview deleting.

## Expected Behavior

With root `--dry-run`, `logout` must not rewrite or migrate configuration content. It should report intended service/config deletion without any persisted mutation.

## Impact

- A logout preview silently modifies valid configuration while assuring users no filesystem changes occurred.
- Users may trigger format upgrades or repository dirtiness simply by inspecting logout consequences.
- The behavior makes dry-run unsuitable for non-invasive validation of credential/config cleanup.

## Supporting Evidence

The root CLI advertises `--dry-run` as `Simulate commands without writing changes.` in `src/cli/program.ts`. In `src/cli/commands/logout.ts`, `executeLogout(...)` loads configured services before checking `flags.dryRun`, and invokes unconfiguration previews for each service. The configured-service loader in `@poe-code/poe-code-config`, exercised by the expectations in `src/services/services.test.ts`, infers missing `provider` and `apiShape` fields and writes those back during load.

## Suspected Area

Logout must use non-persisting configured-service reads in dry-run mode, including reads performed while constructing nested unconfiguration previews.
