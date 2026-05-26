# Login API-key rotation resets configured models and reasoning

## Summary

Running `login --api-key` to replace a Poe API key silently rewrites existing Poe-backed tool configuration with default models, and clears Codex reasoning effort, instead of updating credentials only.

## Environment

- Date reproduced: 2026-05-24
- Repository branch: `main`
- Package version: `0.0.0-dev`
- Runtime: local TypeScript CLI entrypoint with disposable home/project directories and stubbed Poe API responses

## Reproduction

From the repository root, configure several Poe-backed tools with explicitly chosen non-default model/settings values, then rotate the login key:

```sh
repo=$PWD
probe=$(mktemp -d)
mkdir -p "$probe/home" "$probe/project"
cat > "$probe/fetch-preload.mjs" <<'EOF'
globalThis.fetch = async (url) => String(url).includes('/usage/current_balance')
  ? new Response(JSON.stringify({ email: 'probe@example.invalid', current_point_balance: 1 }), { status: 200, headers: { 'content-type': 'application/json' } })
  : new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
EOF
run() {
  (
    cd "$probe/project" &&
    HOME="$probe/home" \
      "$repo/node_modules/.bin/tsx" \
      --import "$probe/fetch-preload.mjs" \
      --import "$repo/scripts/register-template-loader.mjs" \
      "$repo/src/index.ts" --yes "$@"
  ) >/dev/null
}
run configure opencode --provider poe --api-key old-key --model custom-opencode-model
run configure kimi --provider poe --api-key old-key --model custom-kimi-model
run configure claude-code --provider poe --api-key old-key --model anthropic/custom-claude-model
run configure codex --provider poe --api-key old-key --model openai/custom-codex-model --reasoning-effort high
run configure goose --provider poe --api-key old-key --model custom-goose-model

printf '%s\n' '=== before login ==='
grep -n '"model"' "$probe/home/.config/opencode/config.json" "$probe/home/.claude/settings.json"
grep -nE '^default_model|^model =|^model_reasoning_effort|^GOOSE_MODEL' \
  "$probe/home/.kimi/config.toml" "$probe/home/.codex/config.toml" "$probe/home/.config/goose/config.yaml"

run login --api-key replacement-key

printf '%s\n' '=== after login ==='
grep -n '"model"' "$probe/home/.config/opencode/config.json" "$probe/home/.claude/settings.json"
grep -nE '^default_model|^model =|^model_reasoning_effort|^GOOSE_MODEL' \
  "$probe/home/.kimi/config.toml" "$probe/home/.codex/config.toml" "$probe/home/.config/goose/config.yaml"
```

## Observed Behavior

- Before login, the configured values include `custom-opencode-model`, `custom-kimi-model`, `custom-claude-model`, `custom-codex-model`, Codex `model_reasoning_effort = "high"`, and `custom-goose-model`.
- After running `login --api-key replacement-key`, OpenCode becomes `poe/anthropic/claude-opus-4.7`, Kimi becomes `poe/kimi-k2.5`, Claude Code becomes `claude-sonnet-4-6`, Codex becomes `gpt-5.5` with `model_reasoning_effort = ""`, and Goose becomes `anthropic/claude-opus-4.7`.
- The credentials update succeeds, but every demonstrated user-selected model is overwritten and the Codex reasoning selection is erased.

## Expected Behavior

Rotating the Poe API key with `login --api-key` should update authentication-dependent values only. Existing configured models, reasoning effort, and other user choices must be preserved unless the user explicitly requests reconfiguration.

## Impact

- A credential rotation silently destroys user configuration across multiple installed tools.
- Subsequent agent runs can use different models and reasoning behavior than the user selected, affecting output quality, cost, and workflow expectations.
- Users must manually rediscover and restore settings after an authentication maintenance action.

## Supporting Evidence

In `src/cli/commands/login.ts`, `reconfigureServices(...)` loops over configured Poe-backed services after login and invokes each adapter's `configure(...)` function with a payload containing `env` and `provider`, but no preserved `model` or `reasoningEffort`. Provider manifests in `src/providers/opencode.ts`, `src/providers/kimi.ts`, `src/providers/claude-code.ts`, `src/providers/codex.ts`, and `src/providers/goose.ts` fill missing settings with their defaults when reconfigured, producing the observed resets.

## Suspected Area

Login-driven credential refresh must either update credential fields without full reconfiguration or first load and pass through each service's existing non-credential settings.
