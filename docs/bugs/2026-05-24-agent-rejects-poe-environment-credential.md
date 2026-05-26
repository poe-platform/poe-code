# Poe agent execution paths reject Poe environment credential

## Summary

Running `poe-code agent`, `poe-code spawn poe-agent`, or the standalone `poe-agent` binary with `POE_API_KEY` set but no stored credential fails with missing credentials instead of authenticating the Poe request from the active environment secret.

## Environment

- Date reproduced: 2026-05-24
- Repository branch: `main`
- Package version: `0.0.0-dev`
- Runtime: local TypeScript CLI entrypoint with a disposable home/project directory and stubbed `fetch` recording requests

## Reproduction

From the repository root, run the Poe agent runtime with only a Poe environment API key, then demonstrate that an ambient OpenAI key is accepted in its place; the same provider runtime is reached by `spawn poe-agent` and the standalone `poe-agent` binary:

```sh
repo=$PWD
probe=$(mktemp -d)
mkdir -p "$probe/home" "$probe/project"
cat > "$probe/fetch-preload.mjs" <<'EOF_FETCH'
import fs from 'node:fs';
globalThis.fetch = async (url, init = {}) => {
  const headers = init?.headers instanceof Headers ? init.headers : new Headers(init?.headers ?? {});
  fs.appendFileSync(
    process.env.FETCH_LOG,
    `${String(url)} auth=${headers.get('authorization') ?? '<none>'}\n`
  );
  return new Response(JSON.stringify({ error: { message: 'stub failure' } }), {
    status: 500,
    headers: { 'content-type': 'application/json' }
  });
};
EOF_FETCH
(
  cd "$probe/project" &&
  HOME="$probe/home" FETCH_LOG="$probe/poe-only.log" POE_API_KEY=environment-poe-key \
    "$repo/node_modules/.bin/tsx" \
    --import "$probe/fetch-preload.mjs" \
    --import "$repo/scripts/register-template-loader.mjs" \
    "$repo/src/index.ts" agent --model anthropic/claude-sonnet-4.6 'hello'
)
echo "poe-only exit=$?"
cat "$probe/poe-only.log" 2>/dev/null || printf '<no requests>\n'
(
  cd "$probe/project" &&
  HOME="$probe/home" FETCH_LOG="$probe/both.log" \
  POE_API_KEY=environment-poe-key OPENAI_API_KEY=ambient-openai-key \
    "$repo/node_modules/.bin/tsx" \
    --import "$probe/fetch-preload.mjs" \
    --import "$repo/scripts/register-template-loader.mjs" \
    "$repo/src/index.ts" agent --model anthropic/claude-sonnet-4.6 'hello'
)
echo "both exit=$?"
cat "$probe/both.log"
(
  cd "$probe/project" &&
  HOME="$probe/home" FETCH_LOG="$probe/spawn-poe-only.log" POE_API_KEY=environment-poe-key \
    "$repo/node_modules/.bin/tsx" \
    --import "$probe/fetch-preload.mjs" \
    --import "$repo/scripts/register-template-loader.mjs" \
    "$repo/src/index.ts" --yes spawn poe-agent 'hello' --model anthropic/claude-sonnet-4.6
)
echo "spawn-poe-only exit=$?"
cat "$probe/spawn-poe-only.log" 2>/dev/null || printf '<no requests>\n'
```

## Observed Behavior

- With only `POE_API_KEY=environment-poe-key`, the command exits `1` with `Missing credentials. Please pass an apiKey ... or set the OPENAI_API_KEY ... environment variable.` and sends no request.
- With the Poe variable still set plus `OPENAI_API_KEY=ambient-openai-key`, the command sends requests to `https://api.poe.com/v1/chat/completions` authenticated as `Bearer ambient-openai-key`.
- `--yes spawn poe-agent 'hello' --model anthropic/claude-sonnet-4.6` likewise exits `1` with missing credentials and sends no request when only `POE_API_KEY` is available.
- A standalone `poe-agent --yes 'hello'` run with `agent.model` configured also exits `1` with missing credentials and no request under environment-only Poe auth.
- The available Poe environment credential is not consumed by any public Poe agent execution path.

## Expected Behavior

All public Poe agent execution paths should recognize `POE_API_KEY` as their environment authentication mechanism and must not require or prefer an unrelated OpenAI credential for requests sent to Poe.

## Impact

- Environment-authenticated Poe usage fails in CI, containers, and secret-injected sessions unless users also set an unrelated OpenAI variable.
- When both variables exist, the command can send the wrong credential to Poe while the intended Poe key is ignored.
- Agent authentication behavior contradicts the repository's documented `POE_API_KEY` credential convention.

## Supporting Evidence

The repository README documents `POE_API_KEY` as a supported authentication source. In `packages/poe-agent/src/plugins/openai-auth.ts`, provider authentication resolves an explicit option or the Poe auth store only, then falls through to the OpenAI SDK when neither exists; it never resolves `POE_API_KEY`. `src/cli/commands/agent.ts`, `src/cli/commands/spawn-poe-agent.ts`, and `src/cli/poe-agent-main.ts` all ultimately reach this same provider authentication path.

## Suspected Area

The Poe agent CLI and provider authentication path should use the shared Poe environment-aware credential resolver and prevent ambient OpenAI credential fallback for Poe API traffic.
