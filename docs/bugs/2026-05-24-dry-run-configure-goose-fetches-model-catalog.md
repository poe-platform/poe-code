# Dry-run configure Goose fetches the model catalog

## Summary

Running `configure goose` with root `--dry-run` sends an authenticated request to Poe's model catalog while calculating Goose configuration preview content.

## Environment

- Date reproduced: 2026-05-24
- Repository branch: `main`
- Package version: `0.0.0-dev`
- Runtime: local TypeScript CLI entrypoint with disposable home/project directories and a preload `fetch` recorder

## Reproduction

From the repository root, preview Goose configuration while recording authentication validation and model-catalog traffic:

```sh
repo=$PWD
probe=$(mktemp -d)
mkdir -p "$probe/home" "$probe/project"
cat > "$probe/fetch-preload.mjs" <<'EOF'
import { appendFileSync } from 'node:fs';
globalThis.fetch = async (url, init = {}) => {
  appendFileSync(process.env.FETCH_LOG, `${String(url)} ${init.method ?? 'GET'} ${init.headers?.Authorization ?? ''}\n`);
  if (String(url).includes('/usage/current_balance')) {
    return new Response(JSON.stringify({ email: 'probe@example.invalid', current_point_balance: 1 }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    });
  }
  return new Response(JSON.stringify({ data: [] }), {
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
    "$repo/src/index.ts" --dry-run --yes configure goose \
      --provider poe --api-key probe-goose-key --model test-model
)
cat "$probe/fetch.log"
find "$probe/home" -type f -print | sort
```

## Observed Behavior

- The CLI previews global and isolated Goose configuration file contents and prints `Dry run: would configure Goose.`
- The fetch recorder logs both `https://api.poe.com/usage/current_balance GET Bearer probe-goose-key` and `https://api.poe.com/v1/models GET Bearer probe-goose-key`.
- The `/v1/models` request is an additional authenticated remote read used only to build previewed Goose context limits; no files are written.

## Expected Behavior

With root `--dry-run`, Goose configuration must not fetch remote model metadata. It should generate a preview from static/fallback configuration information or report that model metadata would be retrieved during a real configuration run.

## Impact

- A Goose configuration preview generates authenticated network traffic beyond basic key handling.
- Dry-run can disclose credential usage and rely on network availability merely to render prospective config contents.
- Automation cannot safely preview Goose configuration in restricted or offline environments.

## Supporting Evidence

The root CLI advertises `--dry-run` as `Simulate commands without writing changes.` in `src/cli/program.ts`. In `src/cli/commands/configure-payload.ts`, `adapter.extendConfigurePayload(...)` is called regardless of `flags.dryRun`. In `src/providers/goose.ts`, `extendConfigurePayload(...)` invokes `fetchGooseModelContextLimits(...)`, which sends an authenticated request to `${provider.baseUrl}/models`; for Poe this resolves to `https://api.poe.com/v1/models`.

## Suspected Area

Dry-run payload extensions need an explicit simulation contract so providers do not perform remote enrichment calls while constructing previews.
