# Dry-run configure validates a supplied Poe key over the network

## Summary

Running `configure` with root `--dry-run` and an explicit Poe `--api-key` sends that key to Poe's current-balance authentication endpoint before previewing configuration changes.

## Environment

- Date reproduced: 2026-05-24
- Repository branch: `main`
- Package version: `0.0.0-dev`
- Runtime: local TypeScript CLI entrypoint with disposable home/project directories and a preload `fetch` recorder

## Reproduction

From the repository root, configure OpenCode in dry-run mode while intercepting outbound validation requests:

```sh
repo=$PWD
probe=$(mktemp -d)
mkdir -p "$probe/home" "$probe/project"
cat > "$probe/fetch-preload.mjs" <<'EOF'
import { appendFileSync } from 'node:fs';
globalThis.fetch = async (url, init = {}) => {
  appendFileSync(process.env.FETCH_LOG, `${String(url)} ${init.method ?? 'GET'} ${init.headers?.Authorization ?? ''}\n`);
  return new Response(JSON.stringify({ email: 'probe@example.invalid', current_point_balance: 1 }), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  });
};
EOF
(
  cd "$probe/project" &&
  FETCH_LOG="$probe/fetch.log" HOME="$probe/home" \
    "$repo/node_modules/.bin/tsx" \
    --import "$probe/fetch-preload.mjs" \
    --import "$repo/scripts/register-template-loader.mjs" \
    "$repo/src/index.ts" --dry-run --yes configure opencode \
      --provider poe --api-key probe-configure-key --model test-model
)
cat "$probe/fetch.log"
find "$probe/home" -type f -print | sort
```

## Observed Behavior

- The CLI previews OpenCode configuration and credential file mutations, then prints `Dry run: would configure OpenCode CLI.`
- The fetch recorder logs `https://api.poe.com/usage/current_balance GET Bearer probe-configure-key`.
- No files are written in the disposable home, but the proposed credential is transmitted remotely during preview.

## Expected Behavior

With root `--dry-run`, `configure --provider poe --api-key ...` must not send the proposed API key over the network. It should compute and display configuration previews without causing authenticated external activity.

## Impact

- Previewing tool configuration discloses a provided secret to an external endpoint.
- Setup automation cannot safely validate proposed configuration with sensitive credentials in dry-run mode.
- Dry-run output indicates simulated mutations while omitting a real authenticated network side effect.

## Supporting Evidence

The root CLI advertises `--dry-run` as `Simulate commands without writing changes.` in `src/cli/program.ts`. In `src/cli/commands/configure-payload.ts`, Poe configuration always resolves `options.apiKey` through `container.options.resolveApiKey(...)`, including when `flags.dryRun` is true. In `src/cli/options.ts`, a supplied value is passed to `validateApiKey(...)`; `src/cli/container.ts` wires that validation to `checkAuth(...)`, and `packages/poe-oauth/src/check-auth.ts` sends a bearer-authenticated `GET` request to `https://api.poe.com/usage/current_balance`.

## Suspected Area

Poe payload creation during dry-run should avoid credential validation requests and restrict itself to generating redacted configuration previews.
