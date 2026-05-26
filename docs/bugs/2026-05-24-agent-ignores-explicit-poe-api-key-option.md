# Agent ignores explicit Poe API key option

## Summary

`agent --api-key <key> --model <model> <prompt>` does not pass the supplied Poe API key into the model provider: it fails with missing credentials when no `OPENAI_API_KEY` exists, and uses `OPENAI_API_KEY` instead when that unrelated variable is set.

## Environment

- Date reproduced: 2026-05-24
- Repository branch: `main`
- Package version: `0.0.0-dev`
- Runtime: local TypeScript CLI entrypoint with a disposable home/project directory and stubbed `fetch` recording authorization headers

## Reproduction

From the repository root, invoke the agent with an explicit Poe key, first alone and then while exposing a distinguishable `OPENAI_API_KEY`:

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
  HOME="$probe/home" FETCH_LOG="$probe/explicit-only.log" \
    "$repo/node_modules/.bin/tsx" \
    --import "$probe/fetch-preload.mjs" \
    --import "$repo/scripts/register-template-loader.mjs" \
    "$repo/src/index.ts" agent \
      --model anthropic/claude-sonnet-4.6 \
      --api-key explicit-poe-key \
      'hello'
)
echo "explicit-only exit=$?"
cat "$probe/explicit-only.log" 2>/dev/null || printf '<no requests>\n'
(
  cd "$probe/project" &&
  HOME="$probe/home" FETCH_LOG="$probe/with-openai.log" OPENAI_API_KEY=fallback-openai-key \
    "$repo/node_modules/.bin/tsx" \
    --import "$probe/fetch-preload.mjs" \
    --import "$repo/scripts/register-template-loader.mjs" \
    "$repo/src/index.ts" agent \
      --model anthropic/claude-sonnet-4.6 \
      --api-key explicit-poe-key \
      'hello'
)
echo "with-openai exit=$?"
cat "$probe/with-openai.log"
```

## Observed Behavior

- With only `--api-key explicit-poe-key`, the command exits `1` with `Missing credentials. Please pass an apiKey ... or set the OPENAI_API_KEY ... environment variable.` and makes no request.
- With the same explicit option plus `OPENAI_API_KEY=fallback-openai-key`, requests are sent to `https://api.poe.com/v1/chat/completions` using `Authorization: Bearer fallback-openai-key`.
- The supplied `explicit-poe-key` is never used for the Poe API request.

## Expected Behavior

The documented `--api-key <key>` option should take precedence and authenticate the one-shot Poe agent request with the supplied value, independently of any unrelated OpenAI environment variable.

## Impact

- Users cannot use the command's explicit secret option to authenticate a one-shot agent invocation.
- Sessions can unintentionally send the wrong credential to the Poe endpoint when `OPENAI_API_KEY` exists in the environment.
- Credential selection violates explicit-option precedence and risks authentication failures or disclosure of an unintended API key to another endpoint.

## Supporting Evidence

In `src/cli/commands/agent.ts`, the option is passed into `createAgentSession({ apiKey: options.apiKey, ... })`. In `packages/poe-agent/src/agent-session.ts`, it is placed on the per-run options object, but `packages/poe-agent/src/agent.ts` creates the provider using only `getResolvedProviderOptions(provider)` and never merges the run-level `apiKey` or `baseUrl` into that provider context. The provider therefore falls through to the OpenAI client's ambient credential handling instead of using the explicit Poe key.

## Suspected Area

One-shot agent session credentials and endpoint overrides must be propagated into provider creation, with explicit Poe CLI options taking precedence over ambient environment fallback.
