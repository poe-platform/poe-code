# Generate rejects Poe environment credential

## Summary

Running `generate` with `POE_API_KEY` set but no stored credential exits with `Poe API key not found`, preventing generation commands from using environment-provided authentication.

## Environment

- Date reproduced: 2026-05-24
- Repository branch: `main`
- Package version: `0.0.0-dev`
- Runtime: local TypeScript CLI entrypoint with a disposable home/project directory and stubbed `fetch` recording request authentication headers

## Reproduction

From the repository root, provide a Poe environment credential, then compare it with a stored-login run:

```sh
repo=$PWD
probe=$(mktemp -d)
mkdir -p "$probe/home" "$probe/project"
cat > "$probe/fetch-preload.mjs" <<'EOF_FETCH'
import fs from 'node:fs';
globalThis.fetch = async (url, init = {}) => {
  const auth = init?.headers?.Authorization ?? '<none>';
  fs.appendFileSync(process.env.FETCH_LOG, `${url} auth=${auth}\n`);
  return new Response(
    JSON.stringify({ choices: [{ message: { content: 'stub response' } }] }),
    { status: 200, headers: { 'content-type': 'application/json' } }
  );
};
EOF_FETCH
(
  cd "$probe/project" &&
  FETCH_LOG="$probe/env-fetch.log" HOME="$probe/home" POE_API_KEY=environment-generate-key \
    "$repo/node_modules/.bin/tsx" \
    --import "$probe/fetch-preload.mjs" \
    --import "$repo/scripts/register-template-loader.mjs" \
    "$repo/src/index.ts" generate text 'hello'
)
echo "environment exit=$?"
cat "$probe/env-fetch.log" 2>/dev/null || printf '<no requests>\n'
(
  cd "$probe/project" &&
  FETCH_LOG="$probe/login-fetch.log" HOME="$probe/home" \
    "$repo/node_modules/.bin/tsx" \
    --import "$probe/fetch-preload.mjs" \
    --import "$repo/scripts/register-template-loader.mjs" \
    "$repo/src/index.ts" --yes login --api-key stored-generate-key
)
(
  cd "$probe/project" &&
  FETCH_LOG="$probe/stored-fetch.log" HOME="$probe/home" \
    "$repo/node_modules/.bin/tsx" \
    --import "$probe/fetch-preload.mjs" \
    --import "$repo/scripts/register-template-loader.mjs" \
    "$repo/src/index.ts" generate text 'hello'
)
cat "$probe/stored-fetch.log"
```

## Observed Behavior

- The environment-only `generate text 'hello'` invocation exits with status `1` and prints `Error: Poe API key not found. Run 'poe-code login' first.`.
- No Poe API request is made while `POE_API_KEY=environment-generate-key` is present.
- After storing a credential through `login --api-key`, the same generation command succeeds and the fetch recorder captures `https://api.poe.com/v1/chat/completions auth=Bearer stored-generate-key`.

## Expected Behavior

`generate` and its media/text subcommands should accept an active `POE_API_KEY` environment credential consistently with supported Poe SDK/account flows, allowing generation in ephemeral sessions without persistent login state.

## Impact

- CI jobs, containers, and secret-injected environments cannot use `poe-code generate` without first persisting the Poe API key on disk.
- The CLI rejects a valid authentication mechanism that other Poe entry points already advertise or support.
- All generation modalities share the same client-resolution path, so text, image, video, and audio generation are affected.

## Supporting Evidence

In `src/cli/commands/generate.ts`, `resolveClient(...)` initializes the Poe client only after `container.readApiKey()` returns a stored key, and throws when that lookup is empty. It does not inspect `container.env.getVariable("POE_API_KEY")` or use an environment-aware credential resolver before creating the client.

## Suspected Area

Generation should resolve Poe authentication through the same environment-aware credential path used by supported authenticated SDK and account flows rather than requiring stored credentials exclusively.
