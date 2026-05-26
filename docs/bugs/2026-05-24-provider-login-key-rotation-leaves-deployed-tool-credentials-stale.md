# Provider login key rotation leaves deployed tool credentials stale

## Summary

Replacing a stored provider API key with `provider login <id> --api-key ...` updates provider login state but leaves previously configured tool files using the old key. This reproduces for Cloudflare across Claude Code, Codex, Goose, Kimi, and OpenCode, and for Poe-backed Kimi.

## Environment

- Date reproduced: 2026-05-24
- Repository branch: `main`
- Package version: `0.0.0-dev`
- Runtime: local TypeScript CLI entrypoint with disposable home/project directories and stubbed Poe authentication / Goose model catalog responses

## Reproduction

From the repository root, configure tools using a stored Cloudflare credential, replace that provider credential, and inspect deployed configs:

```sh
repo=$PWD
probe=$(mktemp -d)
mkdir -p "$probe/home" "$probe/project"
cat > "$probe/fetch-preload.mjs" <<'EOF'
globalThis.fetch = async (url) => String(url).includes('/models')
  ? new Response(JSON.stringify({ data: [
      { id: 'anthropic/claude-opus-4.7', context_window: { context_length: 200000 } },
      { id: 'anthropic/claude-sonnet-4.6', context_window: { context_length: 200000 } },
      { id: 'openai/gpt-5.3-codex', context_window: { context_length: 128000 } },
      { id: 'openai/gpt-5.5', context_window: { context_length: 1050000 } },
      { id: 'google/gemini-3.1-pro', context_window: { context_length: 1000000 } }
    ] }), { status: 200, headers: { 'content-type': 'application/json' } })
  : new Response(JSON.stringify({ email: 'probe@example.invalid', current_point_balance: 1 }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    });
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
run provider login cloudflare --api-key stored-old-secret --base-url https://gateway.example.test
run configure claude-code --provider cloudflare --model stored-claude
run configure codex --provider cloudflare --model stored-codex --reasoning-effort high
run configure goose --provider cloudflare --model anthropic/claude-opus-4.7
run configure kimi --provider cloudflare --model stored-kimi
run configure opencode --provider cloudflare --model stored-open
printf '%s\n' '=== before credential replacement ==='
rg -n 'ANTHROPIC_CUSTOM_HEADERS|CUSTOM_POE_API_KEY|experimental_bearer_token|api_key|"key"' \
  "$probe/home/.claude/settings.json" \
  "$probe/home/.codex/config.toml" \
  "$probe/home/.config/goose/secrets.yaml" \
  "$probe/home/.kimi/config.toml" \
  "$probe/home/.local/share/opencode/auth.json"
run provider login cloudflare --api-key stored-new-secret --base-url https://gateway.example.test
printf '%s\n' '=== after credential replacement ==='
rg -n 'ANTHROPIC_CUSTOM_HEADERS|CUSTOM_POE_API_KEY|experimental_bearer_token|api_key|"key"' \
  "$probe/home/.claude/settings.json" \
  "$probe/home/.codex/config.toml" \
  "$probe/home/.config/goose/secrets.yaml" \
  "$probe/home/.kimi/config.toml" \
  "$probe/home/.local/share/opencode/auth.json"
mkdir -p "$probe/bin"
cat > "$probe/bin/opencode" <<'EOF'
#!/bin/sh
find "$XDG_DATA_HOME" -type f -print -exec cat {} \;
printf 'OPEN_CODE_OK\n'
EOF
chmod +x "$probe/bin/opencode"
(
  cd "$probe/project" &&
  HOME="$probe/home" PATH="$probe/bin:$PATH" \
    "$repo/node_modules/.bin/tsx" \
    --import "$probe/fetch-preload.mjs" \
    --import "$repo/scripts/register-template-loader.mjs" \
    "$repo/src/index.ts" --yes test opencode --isolated
)
(
  cd "$probe/project" &&
  HOME="$probe/home" \
    "$repo/node_modules/.bin/tsx" \
    --import "$repo/scripts/register-template-loader.mjs" \
    "$repo/src/index.ts" provider list
)
run provider login poe --api-key poe-old-secret
run configure kimi --provider poe --model poe-kimi
run provider login poe --api-key poe-new-secret
rg -n 'api_key|poe-old-secret|poe-new-secret' "$probe/home/.kimi/config.toml"
```

## Observed Behavior

- Claude Code, Codex, Goose, Kimi, and OpenCode are initially configured from the stored Cloudflare credential `stored-old-secret`.
- A subsequent `provider login cloudflare --api-key stored-new-secret` succeeds and `provider list` continues to report Cloudflare as `[logged in]`.
- All five deployed tool configuration files still contain `stored-old-secret`, including Claude Code's `ANTHROPIC_CUSTOM_HEADERS` bearer header and Goose's `CUSTOM_POE_API_KEY` YAML secret; none is refreshed to `stored-new-secret`.
- After rotation, `test opencode --isolated` still launches a fake OpenCode executable successfully using isolated auth JSON containing `stored-old-secret`, demonstrating the obsolete credential remains active for tool execution.
- Independently, after Kimi is configured for Poe with `poe-old-secret`, `provider login poe --api-key poe-new-secret` succeeds while Kimi's TOML config still contains `poe-old-secret`.

## Expected Behavior

Replacing credentials for a provider must refresh credential material deployed into configured tools using that provider, or require/announce explicit reconfiguration before reporting a completed replacement workflow.

## Impact

- Rotated credentials are not applied to existing tools across multiple providers, so configured agents can continue using revoked or compromised keys.
- Users see successful provider authentication while actual tool execution remains tied to stale secret material and can continue consuming the old key.
- Key rotation requires undocumented manual reconfiguration for every affected agent.

## Supporting Evidence

In `src/cli/commands/provider.ts`, `executeProviderLogin(...)` writes the provider credential and optional base URLs, then completes without locating configured services that use the provider or rerunning their manifest updates. The affected service manifests embed credentials in `src/providers/claude-code.ts`, `src/providers/codex.ts`, `src/providers/goose.ts`, `src/providers/kimi.ts`, and `src/providers/opencode.ts`.

## Suspected Area

Provider credential updates need a configured-service refresh path, or the CLI must avoid deploying copied provider credentials into tool-specific files that become stale after rotation.
