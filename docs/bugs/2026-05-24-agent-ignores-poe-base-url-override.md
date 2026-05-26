# Poe agent execution paths ignore Poe base URL override

## Summary

Running `poe-code agent`, `poe-code spawn poe-agent`, or the standalone `poe-agent` binary with `POE_BASE_URL` set still sends authenticated requests to the default Poe endpoint, ignoring the documented Poe API base URL override.

## Environment

- Date reproduced: 2026-05-24
- Repository branch: `main`
- Package version: `0.0.0-dev`
- Runtime: local TypeScript CLI entrypoint with a disposable home/project directory and stubbed `fetch` recording target URLs and authorization headers

## Reproduction

From the repository root, store a Poe credential and run the one-shot agent with a Poe base URL override:

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
  if (String(url).includes('/usage/current_balance')) {
    return new Response(JSON.stringify({ current_point_balance: 1 }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    });
  }
  return new Response(JSON.stringify({ error: { message: 'stub failure' } }), {
    status: 500,
    headers: { 'content-type': 'application/json' }
  });
};
EOF_FETCH
(
  cd "$probe/project" &&
  HOME="$probe/home" FETCH_LOG="$probe/login.log" \
    "$repo/node_modules/.bin/tsx" \
    --import "$probe/fetch-preload.mjs" \
    --import "$repo/scripts/register-template-loader.mjs" \
    "$repo/src/index.ts" --yes login --api-key stored-poe-key
)
(
  cd "$probe/project" &&
  HOME="$probe/home" FETCH_LOG="$probe/default.log" \
    "$repo/node_modules/.bin/tsx" \
    --import "$probe/fetch-preload.mjs" \
    --import "$repo/scripts/register-template-loader.mjs" \
    "$repo/src/index.ts" agent --model anthropic/claude-sonnet-4.6 'hello'
)
cat "$probe/default.log"
(
  cd "$probe/project" &&
  HOME="$probe/home" FETCH_LOG="$probe/override.log" \
  POE_BASE_URL=https://poe-base.example.invalid/v1 \
    "$repo/node_modules/.bin/tsx" \
    --import "$probe/fetch-preload.mjs" \
    --import "$repo/scripts/register-template-loader.mjs" \
    "$repo/src/index.ts" agent --model anthropic/claude-sonnet-4.6 'hello'
)
cat "$probe/override.log"
(
  cd "$probe/project" &&
  HOME="$probe/home" FETCH_LOG="$probe/spawn-override.log" \
  POE_BASE_URL=https://poe-base.example.invalid/v1 \
    "$repo/node_modules/.bin/tsx" \
    --import "$probe/fetch-preload.mjs" \
    --import "$repo/scripts/register-template-loader.mjs" \
    "$repo/src/index.ts" --yes spawn poe-agent 'hello' --model anthropic/claude-sonnet-4.6
)
cat "$probe/spawn-override.log"
```

## Observed Behavior

- The baseline invocation sends requests to `https://api.poe.com/v1/chat/completions auth=Bearer stored-poe-key`.
- With `POE_BASE_URL=https://poe-base.example.invalid/v1`, requests still go to `https://api.poe.com/v1/chat/completions auth=Bearer stored-poe-key`.
- `--yes spawn poe-agent ...` also continues targeting `https://api.poe.com/v1/chat/completions` under the same Poe override.
- The standalone `poe-agent --yes 'hello'` binary also continues targeting `https://api.poe.com/v1/chat/completions` under the same Poe override.
- The Poe-specific endpoint override has no effect on any public Poe agent execution path.

## Expected Behavior

All Poe agent execution paths should use the configured Poe API base URL, including the documented `POE_BASE_URL` environment override, for their authenticated Poe requests.

## Impact

- Users cannot direct the one-shot agent command through Poe-compatible proxies, gateways, test servers, or enterprise endpoints using the repository's declared configuration mechanism.
- Endpoint behavior is inconsistent with other Poe configuration surfaces while unrelated `OPENAI_BASE_URL` is honored instead.
- Authentication may be sent to an unintended default destination despite explicit Poe routing configuration.

## Supporting Evidence

In `src/services/config.ts`, `core.poeBaseUrl` declares `POE_BASE_URL` as the Poe API base URL environment option. In `src/cli/commands/agent.ts`, the command passes only `model`, `apiKey`, and `cwd` to `createAgentSession(...)`, omitting any Poe base URL resolution. The provider consequently selects its hard-coded default Poe URL unless the unrelated OpenAI base URL environment setting is present.

## Suspected Area

The one-shot agent command should resolve Poe endpoint configuration through the shared Poe config path and pass the result explicitly into the agent session/provider runtime.
