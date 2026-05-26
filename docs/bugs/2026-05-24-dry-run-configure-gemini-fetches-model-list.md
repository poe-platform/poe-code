# Dry-run configure Gemini fetches the model list

## Summary

Running `configure gemini-cli` with root `--dry-run` and a compatible Cloudflare provider sends an authenticated request to the configured Google-generations model endpoint while resolving a default model for preview output.

## Environment

- Date reproduced: 2026-05-24
- Repository branch: `main`
- Package version: `0.0.0-dev`
- Runtime: local TypeScript CLI entrypoint with disposable home/project directories and a preload `fetch` recorder

## Reproduction

From the repository root, preview Gemini CLI configuration against a disposable Cloudflare base URL while recording outbound requests:

```sh
repo=$PWD
probe=$(mktemp -d)
mkdir -p "$probe/home" "$probe/project"
cat > "$probe/fetch-preload.mjs" <<'EOF'
import { appendFileSync } from 'node:fs';
globalThis.fetch = async (url, init = {}) => {
  appendFileSync(process.env.FETCH_LOG, `${String(url)} ${init.method ?? 'GET'} ${init.headers?.Authorization ?? ''}\n`);
  return new Response(JSON.stringify({ models: [{ name: 'models/gemini-test' }] }), {
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
    "$repo/src/index.ts" --dry-run --yes configure gemini-cli \
      --provider cloudflare --api-key probe-key --base-url https://gateway.example.com
)
cat "$probe/fetch.log"
find "$probe/home" -type f -print | sort
```

## Observed Behavior

- The CLI resolves `Gemini model` and previews global and isolated Gemini settings, then prints `Dry run: would configure Gemini CLI.`
- The fetch recorder logs `https://gateway.example.com/google-ai-studio/v1beta/models GET Bearer probe-key`.
- No files are written, but the supplied provider credential is used in a live model-discovery request solely to create preview configuration.

## Expected Behavior

With root `--dry-run`, Gemini configuration must not issue authenticated model-list requests. It should show a static/default model preview or state that model discovery would occur in a real run.

## Impact

- A configuration preview transmits a supplied credential to a configured external gateway.
- Preview behavior depends on network availability and endpoint behavior even though no configuration is being applied.
- Users cannot safely examine Gemini settings output with sensitive gateway credentials in dry-run mode.

## Supporting Evidence

The root CLI advertises `--dry-run` as `Simulate commands without writing changes.` in `src/cli/program.ts`. In `src/cli/commands/configure-payload.ts`, dynamic model choices are resolved while constructing a payload regardless of `flags.dryRun`. In `src/providers/gemini-cli.ts`, the dynamic `choices(...)` callback sends `Authorization: Bearer <credential>` to `buildGoogleModelsUrl(provider.baseUrl)`, which produces the observed `/google-ai-studio/v1beta/models` request for the Cloudflare provider.

## Suspected Area

Dynamic model-choice resolution must expose a side-effect-free dry-run behavior rather than fetching model catalogs during previews.
