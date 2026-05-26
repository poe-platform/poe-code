# Provider login endpoint update leaves configured tools stale

## Summary

Updating stored provider endpoints through `provider login` changes the route used for future configurations but does not update already configured tools that still point to previous URLs. This reproduces for Cloudflare gateway replacement and for Poe shape-specific replacement.

## Environment

- Date reproduced: 2026-05-24
- Repository branch: `main`
- Package version: `0.0.0-dev`
- Runtime: local TypeScript CLI entrypoint with disposable home/project directories and a stubbed Poe authentication response

## Reproduction

From the repository root, configure tools through one Cloudflare gateway URL, update the provider URL, and configure another service afterward:

```sh
repo=$PWD
probe=$(mktemp -d)
mkdir -p "$probe/home" "$probe/project"
cat > "$probe/fetch-preload.mjs" <<'EOF'
globalThis.fetch = async () => new Response(
  JSON.stringify({ email: 'probe@example.invalid', current_point_balance: 1 }),
  { status: 200, headers: { 'content-type': 'application/json' } }
);
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
run provider login cloudflare --api-key endpoint-secret --base-url https://old-gateway.example.test
run configure codex --provider cloudflare --model endpoint-codex --reasoning-effort high
run configure claude-code --provider cloudflare --model endpoint-claude
run provider login cloudflare --api-key endpoint-secret --base-url https://new-gateway.example.test
run configure kimi --provider cloudflare --model endpoint-kimi
rg -n 'base_url|ANTHROPIC_BASE_URL|old-gateway|new-gateway' \
  "$probe/home/.codex/config.toml" \
  "$probe/home/.claude/settings.json" \
  "$probe/home/.kimi/config.toml"
cat "$probe/home/.poe-code/config.json"
cat "$probe/home/.config/poe-code/services.json"
run provider login poe --api-key poe-route-secret --shape-base-url openai-responses=https://poe-old.example.test/v1
run configure codex --provider poe --model poe-route-model --reasoning-effort high
run provider login poe --api-key poe-route-secret --shape-base-url openai-responses=https://poe-new.example.test/v1
rg -n 'base_url|poe-old|poe-new' "$probe/home/.codex/config.toml"
cat "$probe/home/.config/poe-code/services.json"
```

## Observed Behavior

- Codex configured before the update retains `base_url = "https://old-gateway.example.test/openai"`.
- Claude Code configured before the update retains `"ANTHROPIC_BASE_URL": "https://old-gateway.example.test/anthropic"`.
- Kimi configured after the same provider update receives `base_url = "https://new-gateway.example.test/compat"`.
- The tracked service metadata records all three tools as using the `cloudflare` provider, and `~/.config/poe-code/services.json` records the updated Cloudflare shape URLs, but existing services are not refreshed when its URL changes.
- Independently, after the stored Poe `openai-responses` URL changes from `https://poe-old.example.test/v1` to `https://poe-new.example.test/v1`, a previously configured Poe-backed Codex file still contains the old URL while provider metadata contains the new one.

## Expected Behavior

Updating a provider gateway or shape base URL must update the endpoint configuration for already configured tools using that provider, or clearly require and report manual reconfiguration for affected agents.

## Impact

- Existing tools continue routing requests to obsolete endpoints after the user changes provider configuration for multiple providers.
- Endpoint migrations, access-policy changes, and incident-response cutovers silently apply only to newly configured services.
- Different tools associated with one provider can unexpectedly use different gateway endpoints while provider configuration appears unified.

## Supporting Evidence

In `src/cli/commands/provider.ts`, `executeProviderLogin(...)` stores updated provider shape base URLs and completes without rerunning manifests for services recorded with that provider. Codex and Claude Code write resolved provider base URLs into their local configuration files during `configure`, leaving those copied values stale after a later Cloudflare or Poe provider update.

## Suspected Area

Provider endpoint updates need to refresh configured-service manifests by provider and API shape, or configured tools must resolve provider endpoints dynamically instead of copying them at setup time.
