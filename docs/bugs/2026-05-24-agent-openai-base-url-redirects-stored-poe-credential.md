# Poe agent execution paths let OpenAI base URL redirect stored Poe credential

## Summary

Setting `OPENAI_BASE_URL` while running `poe-code agent`, `poe-code spawn poe-agent`, or the standalone `poe-agent` binary causes a stored Poe API key to be sent to the OpenAI-configured endpoint instead of Poe's API endpoint.

## Environment

- Date reproduced: 2026-05-24
- Repository branch: `main`
- Package version: `0.0.0-dev`
- Runtime: local TypeScript CLI entrypoint with a disposable home/project directory and stubbed `fetch` recording target URLs and authorization headers

## Reproduction

From the repository root, store a Poe credential, then run the one-shot agent with and without an unrelated OpenAI base URL override:

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
  HOME="$probe/home" FETCH_LOG="$probe/redirected.log" \
  OPENAI_BASE_URL=https://foreign-api.example.invalid/v1 \
    "$repo/node_modules/.bin/tsx" \
    --import "$probe/fetch-preload.mjs" \
    --import "$repo/scripts/register-template-loader.mjs" \
    "$repo/src/index.ts" agent --model anthropic/claude-sonnet-4.6 'hello'
)
cat "$probe/redirected.log"
(
  cd "$probe/project" &&
  HOME="$probe/home" FETCH_LOG="$probe/spawn-redirected.log" \
  OPENAI_BASE_URL=https://foreign-api.example.invalid/v1 \
    "$repo/node_modules/.bin/tsx" \
    --import "$probe/fetch-preload.mjs" \
    --import "$repo/scripts/register-template-loader.mjs" \
    "$repo/src/index.ts" --yes spawn poe-agent 'hello' --model anthropic/claude-sonnet-4.6
)
cat "$probe/spawn-redirected.log"
```

## Observed Behavior

- With no OpenAI override, agent requests target `https://api.poe.com/v1/chat/completions auth=Bearer stored-poe-key`.
- With `OPENAI_BASE_URL=https://foreign-api.example.invalid/v1`, the same stored Poe key is transmitted to `https://foreign-api.example.invalid/v1/chat/completions auth=Bearer stored-poe-key`.
- `--yes spawn poe-agent ...` also transmits `Bearer stored-poe-key` to the foreign URL under the same override.
- The standalone `poe-agent --yes 'hello'` binary likewise transmits `Bearer stored-poe-key` to the foreign URL with `OPENAI_BASE_URL` set.
- None of the public execution paths warn that an ambient OpenAI setting has redirected the Poe credential to a different host.

## Expected Behavior

All Poe agent execution paths should keep stored Poe credentials scoped to Poe's endpoint or to an explicit Poe-specific endpoint override, and must not silently honor an unrelated `OPENAI_BASE_URL` variable for authenticated Poe traffic.

## Impact

- A stored Poe secret can be disclosed to an unintended host merely because an OpenAI-compatible endpoint variable exists in the shell environment.
- Developers who use local OpenAI gateways or test endpoints can accidentally exfiltrate Poe credentials when invoking a Poe command.
- Credential destination becomes dependent on unrelated ambient configuration rather than explicit Poe command intent.

## Supporting Evidence

In `packages/poe-agent/src/plugins/poe-agent-plugin-openai-chat-completions.ts` and `packages/poe-agent/src/plugins/poe-agent-plugin-openai-responses.ts`, `resolveClientBaseUrl(...)` returns `undefined` when `process.env.OPENAI_BASE_URL` is set. This delegates endpoint selection to the OpenAI SDK, while `resolveOpenaiApiKey(...)` independently retrieves the stored Poe credential from `auth-store`, pairing a Poe secret with an OpenAI-controlled destination.

## Suspected Area

Poe agent providers should use Poe-specific endpoint configuration and must not inherit generic OpenAI base URL overrides when authenticating with stored Poe credentials.
