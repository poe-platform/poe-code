# Dry-run login backfills legacy service metadata

## Summary

Running `login` with root `--dry-run` rewrites a valid legacy configured-service record to add inferred `provider` and `apiShape` fields while stating that no filesystem changes occurred.

## Environment

- Date reproduced: 2026-05-24
- Repository branch: `main`
- Package version: `0.0.0-dev`
- Runtime: local TypeScript CLI entrypoint with disposable home/project directories and a preload response stub for API-key validation

## Reproduction

From the repository root, create a valid legacy OpenCode service record, then preview logging in with an accepted probe key:

```sh
repo=$PWD
probe=$(mktemp -d)
mkdir -p "$probe/home/.poe-code" "$probe/project"
cat > "$probe/home/.poe-code/config.json" <<'EOF'
{"configured_services":{"opencode":{"files":[]}}}
EOF
cat > "$probe/fetch-preload.mjs" <<'EOF'
globalThis.fetch = async () => new Response(
  JSON.stringify({ email: 'probe@example.invalid', current_point_balance: 1 }),
  { status: 200, headers: { 'content-type': 'application/json' } }
);
EOF
printf '%s\n' '=== before ==='
cat "$probe/home/.poe-code/config.json"
(
  cd "$probe/project" &&
  HOME="$probe/home" \
    "$repo/node_modules/.bin/tsx" \
    --import "$probe/fetch-preload.mjs" \
    --import "$repo/scripts/register-template-loader.mjs" \
    "$repo/src/index.ts" --dry-run --yes login --api-key probe-key
)
printf '%s\n' '=== after ==='
cat "$probe/home/.poe-code/config.json"
```

## Observed Behavior

- The CLI previews reconfiguring OpenCode and prints `Dry run: would save API key.` followed by `# no filesystem changes`.
- The global config changes from `{"configured_services":{"opencode":{"files":[]}}}` to a formatted record that contains `"provider": "poe"` and `"apiShape": "openai-chat-completions"`.
- Login persists configured-service normalization even though the reconfiguration and key storage operations are presented as preview-only.

## Expected Behavior

With root `--dry-run`, `login` must not migrate existing configured-service entries. It should use inferred metadata only in memory while previewing affected service reconfiguration.

## Impact

- A login preview mutates valid configuration while expressly reporting no filesystem changes.
- Users inspecting credential-dependent reconfiguration can trigger unintended format upgrades.
- Managed or tracked config files become dirty from a command intended to be non-invasive.

## Supporting Evidence

The root CLI advertises `--dry-run` as `Simulate commands without writing changes.` in `src/cli/program.ts`. In `src/cli/commands/login.ts`, `executeLogin(...)` calls `loadConfiguredServices(...)` before previewing dependent reconfiguration. The configured-service loader in `packages/poe-code-config/src/configured-services.ts` normalizes legacy entries and persists changes when metadata is inferred, as also exercised in `src/services/services.test.ts`.

## Suspected Area

Dry-run login needs a non-persisting configured-services load path for discovering reconfiguration targets.
