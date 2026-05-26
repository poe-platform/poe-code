# Configure Poe ignores Poe base URL override

## Summary

Running `configure <agent> --provider poe` with `POE_BASE_URL` set writes default `api.poe.com` endpoints into Poe-backed agent configurations instead of using the documented Poe endpoint override. This reproduces for Claude Code, Codex, Goose, and Kimi; Goose additionally fetches its model catalog from the default endpoint during configuration.

## Environment

- Date reproduced: 2026-05-24
- Repository branch: `main`
- Package version: `0.0.0-dev`
- Runtime: local TypeScript CLI entrypoint with disposable home/project directories, stored Poe authentication, and stubbed `fetch` recording requests

## Reproduction

From the repository root, store a Poe credential separately for each agent, configure each one under a Poe base URL override, and inspect the resulting endpoint settings:

```sh
repo=$PWD
probe=$(mktemp -d)
mkdir -p "$probe/project"
cat > "$probe/fetch-preload.mjs" <<'EOF_FETCH'
import fs from 'node:fs';
globalThis.fetch = async (url, init = {}) => {
  const headers = init?.headers instanceof Headers ? init.headers : new Headers(init?.headers ?? {});
  fs.appendFileSync(
    process.env.FETCH_LOG,
    `${String(url)} auth=${headers.get('authorization') ?? '<none>'}\n`
  );
  if (String(url).includes('/usage/current_balance')) {
    return new Response(JSON.stringify({ current_point_balance: 1 }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    });
  }
  return new Response(JSON.stringify({ object: 'list', data: [] }), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  });
};
EOF_FETCH
while IFS='|' read -r agent model; do
  home="$probe/home-$agent"
  mkdir -p "$home"
  (
    cd "$probe/project" &&
    HOME="$home" FETCH_LOG="$probe/$agent-login.log" \
      "$repo/node_modules/.bin/tsx" \
      --import "$probe/fetch-preload.mjs" \
      --import "$repo/scripts/register-template-loader.mjs" \
      "$repo/src/index.ts" --yes login --api-key stored-poe-key
  )
  (
    cd "$probe/project" &&
    HOME="$home" FETCH_LOG="$probe/$agent-configure.log" \
    POE_BASE_URL=https://gateway.example.invalid/v1 \
      "$repo/node_modules/.bin/tsx" \
      --import "$probe/fetch-preload.mjs" \
      --import "$repo/scripts/register-template-loader.mjs" \
      "$repo/src/index.ts" --yes configure "$agent" --provider poe --model "$model"
  )
  printf '\nagent=%s requests:\n' "$agent"
  cat "$probe/$agent-configure.log" 2>/dev/null || printf '<no requests>\n'
  rg -n 'api\.poe|gateway\.example|base_url|ANTHROPIC_BASE_URL' "$home" \
    -g '*' --glob '!*.enc' || true
done <<'EOF_AGENTS'
claude-code|anthropic/claude-sonnet-4.6
codex|openai/gpt-5.5
goose|anthropic/claude-opus-4.7
kimi|novitaai/kimi-k2.5
EOF_AGENTS
```

## Observed Behavior

- Claude Code is written with `ANTHROPIC_BASE_URL: "https://api.poe.com"` rather than the configured gateway.
- Codex global and isolated configuration are written with `base_url = "https://api.poe.com/v1"` rather than the configured gateway.
- Kimi global and isolated configuration are written with `base_url = "https://api.poe.com/v1"` rather than the configured gateway.
- Goose global and isolated provider configuration are written with `"base_url": "https://api.poe.com/v1/chat/completions"` rather than the configured gateway.
- During Goose configuration, the model catalog is also requested from `https://api.poe.com/v1/models auth=Bearer stored-poe-key` instead of the gateway endpoint.

## Expected Behavior

When `POE_BASE_URL=https://gateway.example.invalid/v1` is configured, Poe-backed agent configuration should deploy endpoint values derived from that Poe route, and any configure-time Poe model discovery should use the same configured endpoint.

## Impact

- Users cannot configure supported coding agents to route Poe traffic through a documented proxy, gateway, test endpoint, or enterprise endpoint using `POE_BASE_URL`.
- Deployed tools continue sending authenticated traffic to the default Poe endpoint even though the CLI environment requests another route.
- Goose configuration sends its stored credential to the wrong model-catalog endpoint during setup as well as writing the wrong runtime URL.

## Supporting Evidence

In `src/services/config.ts` and `src/cli/environment.ts`, `POE_BASE_URL` is declared and resolved as the Poe API base URL. However, `packages/providers/src/providers/poe.ts` defines fixed default shape URLs without declaring a `baseUrlEnvVar`, so `buildActiveProvider(...)` in `src/cli/commands/shared.ts` cannot obtain the Poe environment override through `resolveProviderBaseUrlEnv(...)` and falls back to hard-coded defaults. The current `src/cli/commands/configure.test.ts` suite explicitly asserts that Poe configuration does not read `POE_BASE_URL`, documenting the implemented inconsistency rather than correcting it.

## Suspected Area

Poe provider endpoint resolution should consume the same `POE_BASE_URL` configuration used by account and generation commands, applying it consistently to generated tool configuration and configure-time API discovery.
