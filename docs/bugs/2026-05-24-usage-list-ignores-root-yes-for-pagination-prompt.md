---
name: "Usage list ignores root yes for pagination prompt"
---

# Usage list ignores root yes for pagination prompt

## Summary

Running `poe-code --yes usage list` still displays an interactive `Load more?` prompt when additional usage-history pages are available, instead of completing non-interactively according to the root `--yes` contract.

## Environment

- Date reproduced: 2026-05-24
- Repository branch: `main`
- Package version: `0.0.0-dev`
- Runtime: local TypeScript CLI entrypoint with a disposable home/project directory, stored Poe authentication, and stubbed paginated usage-history response

## Reproduction

From the repository root, install a disposable stored credential and stub a usage-history page that reports additional results:

```sh
repo=$PWD
probe=$(mktemp -d)
mkdir -p "$probe/home" "$probe/project"
cat > "$probe/fetch-preload.mjs" <<'EOF'
globalThis.fetch = async (url) => {
  if (String(url).includes('/usage/current_balance')) {
    return new Response(
      JSON.stringify({ email: 'probe@example.invalid', current_point_balance: 1 }),
      { status: 200, headers: { 'content-type': 'application/json' } }
    );
  }
  return new Response(JSON.stringify({
    data: [{
      query_id: 'query-1',
      creation_time: 0,
      bot_name: 'model',
      cost_usd: '0.01',
      cost_points: 1
    }],
    has_more: true,
    next_cursor: 'next'
  }), { status: 200, headers: { 'content-type': 'application/json' } });
};
EOF
(
  cd "$probe/project" &&
  HOME="$probe/home" \
    "$repo/node_modules/.bin/tsx" \
    --import "$probe/fetch-preload.mjs" \
    --import "$repo/scripts/register-template-loader.mjs" \
    "$repo/src/index.ts" --yes login --api-key key
)
(
  cd "$probe/project" &&
  HOME="$probe/home" \
    perl -e 'alarm shift; exec @ARGV' 2 \
    "$repo/node_modules/.bin/tsx" \
    --import "$probe/fetch-preload.mjs" \
    --import "$repo/scripts/register-template-loader.mjs" \
    "$repo/src/index.ts" --yes usage list
) > "$probe/out" 2>&1 || true
cat "$probe/out"
```

## Observed Behavior

- `usage list` successfully renders the first mocked history row.
- Despite root `--yes`, it then renders the interactive prompt `Load more?` with `Yes / No` choices.
- The invocation cannot reliably complete unattended when the API reports additional pages unless callers know to pass a separate explicit `--pages` workaround.

## Expected Behavior

The root `--yes` option, documented as accepting defaults without prompting, must prevent interactive pagination prompts. The command should automatically apply a documented pagination default or require an explicit pages limit in non-interactive mode without waiting for input.

## Impact

- CI and shell automation can block while reading usage history even when invoked with the global non-interactive option.
- Users must know an undocumented workaround (`--pages`) to avoid prompts in a command already run with `--yes`.
- Global option behavior is inconsistent with other CLI prompt resolution paths.

## Supporting Evidence

In `src/cli/commands/usage.ts`, the handler resolves root command flags but consults only `commandOptions.pages` to avoid interactive pagination. When `has_more` is true and no page count was supplied, it directly calls `confirm({ message: "Load more?" })` without checking `flags.assumeYes`.

## Suspected Area

Usage-history pagination should honor `flags.assumeYes` or expose a deterministic non-interactive default behavior under root `--yes`.
