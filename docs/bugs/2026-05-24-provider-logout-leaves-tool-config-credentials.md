---
name: "Provider logout leaves deployed tool credentials"
---

# Provider logout leaves deployed tool credentials

## Summary

Running `provider logout <id>` removes the provider's encrypted credential store but leaves the same API key embedded in configured tool files. This reproduces for Cloudflare across Claude Code, Codex, Goose, Kimi, and OpenCode, and for Poe-backed Kimi.

## Environment

- Date reproduced: 2026-05-24
- Repository branch: `main`
- Package version: `0.0.0-dev`
- Runtime: local TypeScript CLI entrypoint with disposable home/project directories and a stubbed Goose model catalog response

## Reproduction

From the repository root, configure three Cloudflare-backed tools in a disposable home, log out of the provider, and inspect tool configuration files:

```sh
repo=$PWD
probe=$(mktemp -d)
mkdir -p "$probe/home" "$probe/project"
cat > "$probe/fetch-preload.mjs" <<'EOF'
globalThis.fetch = async () => new Response(JSON.stringify({ data: [
  { id: 'anthropic/claude-opus-4.7', context_window: { context_length: 200000 } },
  { id: 'anthropic/claude-sonnet-4.6', context_window: { context_length: 200000 } },
  { id: 'openai/gpt-5.3-codex', context_window: { context_length: 128000 } },
  { id: 'openai/gpt-5.5', context_window: { context_length: 1050000 } },
  { id: 'google/gemini-3.1-pro', context_window: { context_length: 1000000 } }
] }), { status: 200, headers: { 'content-type': 'application/json' } });
EOF
run() {
  (
    cd "$probe/project" &&
    HOME="$probe/home" \
      "$repo/node_modules/.bin/tsx" \
      --import "$probe/fetch-preload.mjs" \
      --import "$repo/scripts/register-template-loader.mjs" \
      "$repo/src/index.ts" --yes "$@"
  ) >/dev/null 2>&1
}
run provider login cloudflare --api-key provider-secret --base-url https://gateway.example.test
run configure claude-code --provider cloudflare --api-key provider-secret --base-url https://gateway.example.test --model cf-claude
run configure codex --provider cloudflare --api-key provider-secret --base-url https://gateway.example.test --model cf-model --reasoning-effort high
run configure goose --provider cloudflare --api-key provider-secret --base-url https://gateway.example.test --model anthropic/claude-opus-4.7
run configure kimi --provider cloudflare --api-key provider-secret --base-url https://gateway.example.test --model cf-kimi
run configure opencode --provider cloudflare --api-key provider-secret --base-url https://gateway.example.test --model cf-open
printf '%s\n' '=== secret-bearing config before logout ==='
rg -n 'ANTHROPIC_CUSTOM_HEADERS|CUSTOM_POE_API_KEY|experimental_bearer_token|api_key|"key"' \
  "$probe/home/.claude/settings.json" \
  "$probe/home/.codex/config.toml" \
  "$probe/home/.config/goose/secrets.yaml" \
  "$probe/home/.kimi/config.toml" \
  "$probe/home/.local/share/opencode/auth.json"
run provider logout cloudflare
printf '%s\n' '=== provider list after logout ==='
(
  cd "$probe/project" &&
  HOME="$probe/home" \
    "$repo/node_modules/.bin/tsx" \
    --import "$repo/scripts/register-template-loader.mjs" \
    "$repo/src/index.ts" provider list
) 2>&1 | rg 'cloudflare|Provider|logged in|\[-\]'
printf '%s\n' '=== secret-bearing config after logout ==='
rg -n 'ANTHROPIC_CUSTOM_HEADERS|CUSTOM_POE_API_KEY|experimental_bearer_token|api_key|"key"' \
  "$probe/home/.claude/settings.json" \
  "$probe/home/.codex/config.toml" \
  "$probe/home/.config/goose/secrets.yaml" \
  "$probe/home/.kimi/config.toml" \
  "$probe/home/.local/share/opencode/auth.json"
printf '%s\n' '=== credential stores after logout ==='
find "$probe/home/.poe-code" -maxdepth 1 -type f -name 'credentials*' -print | sort || true
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
run provider login poe --api-key poe-provider-secret
run configure kimi --provider poe --model poe-kimi
run provider logout poe
rg -n 'api_key|poe-provider-secret' "$probe/home/.kimi/config.toml"
```

## Observed Behavior

- Before logout, Claude Code, Codex, Goose, Kimi, and OpenCode configuration files contain `provider-secret` in plaintext credential fields.
- After `provider logout cloudflare`, `provider list` shows Cloudflare as logged out and no `credentials*` provider store remains under `~/.poe-code`.
- The Claude Code bearer header, Codex `experimental_bearer_token`, Goose `CUSTOM_POE_API_KEY`, Kimi `api_key`, and OpenCode auth `key` fields still contain `provider-secret` after logout.
- After Cloudflare is reported logged out, `test opencode --isolated` still launches a fake OpenCode executable successfully using isolated auth JSON that contains the retained `provider-secret` key.
- Independently, `provider logout poe` removes Poe provider login state while a configured Kimi TOML file still contains `poe-provider-secret`.

## Expected Behavior

Logging out of a provider must revoke or remove credential material that the CLI deployed into configurations for tools using that provider, or clearly warn that configured tools retain reusable plaintext credentials.

## Impact

- Users can complete provider logout for multiple providers while working plaintext credentials remain on disk and usable by already configured tools.
- Credential rotation and incident-response cleanup may fail to eliminate compromised keys from tool configurations.
- Provider status reports logout successfully even though effective authentication material remains deployed locally and can still be consumed by configured tool execution.

## Supporting Evidence

In `src/cli/commands/provider.ts`, `executeProviderLogout(...)` calls `container.providerRegistry.logout(id)` and reports completion, but does not find configured services using that provider or remove their credential-bearing configuration. The affected manifests embed credentials in `src/providers/claude-code.ts` (`ANTHROPIC_CUSTOM_HEADERS`), `src/providers/codex.ts` (`experimental_bearer_token`), `src/providers/goose.ts` (`CUSTOM_POE_API_KEY`), `src/providers/kimi.ts` (`api_key`), and `src/providers/opencode.ts` (`key`).

## Suspected Area

Provider logout must coordinate with configured-service state and scrub or invalidate provider credentials already deployed into service configuration files.
