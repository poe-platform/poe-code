# MCP configure ignores root yes for agent selection

## Summary

Running `poe-code --yes mcp configure` while already authenticated still renders the interactive agent-selection prompt instead of accepting the documented default client selection.

## Environment

- Date reproduced: 2026-05-24
- Repository branch: `main`
- Package version: `0.0.0-dev`
- Runtime: local TypeScript CLI entrypoint with a disposable home/project directory and stubbed Poe identity response

## Reproduction

From the repository root, create a stored Poe login and invoke MCP configuration with the root non-interactive option but no explicit agent:

```sh
repo=$PWD
probe=$(mktemp -d)
mkdir -p "$probe/home" "$probe/project"
cat > "$probe/fetch-preload.mjs" <<'EOF'
globalThis.fetch = async () => new Response(
  JSON.stringify({ email: 'probe@example.invalid', current_point_balance: 1 }),
  { status: 200, headers: { 'content-type': 'application/json' } }
);
EOF
(
  cd "$probe/project" &&
  HOME="$probe/home" \
    "$repo/node_modules/.bin/tsx" \
    --import "$probe/fetch-preload.mjs" \
    --import "$repo/scripts/register-template-loader.mjs" \
    "$repo/src/index.ts" --yes login --api-key stored-mcp-key
)
(
  cd "$probe/project" &&
  HOME="$probe/home" \
    "$repo/node_modules/.bin/tsx" \
    --import "$probe/fetch-preload.mjs" \
    --import "$repo/scripts/register-template-loader.mjs" \
    "$repo/src/index.ts" --yes mcp configure </dev/null
)
find "$probe/home" "$probe/project" -type f -print | sort
```

## Observed Behavior

- Authentication is already present, so the command reaches agent selection rather than login.
- Despite the root `--yes` option, output renders `Select agent to configure:` with interactive choices headed by `claude-code`.
- The command exits without writing an MCP configuration file when input is unavailable, rather than applying the declared default selection.

## Expected Behavior

The root `--yes` flag, documented as accepting defaults without prompting, must select the default MCP client (`claude-code`) when no agent is specified and complete configuration non-interactively.

## Impact

- Non-interactive MCP setup hangs or exits without configuration in CI and automation unless callers know to repeat a subcommand-specific `--yes` position or pass an explicit agent.
- Global CLI non-interactive behavior is inconsistent across configuration commands.
- Users cannot rely on the root-level default acceptance contract for MCP installation.

## Supporting Evidence

In `src/cli/commands/mcp.ts`, the command obtains root flags through `resolveCommandFlags(program)`, but chooses `DEFAULT_MCP_AGENT` only when the local action option `options.yes` is true. It does not use `flags.assumeYes` for agent selection, so root `--yes` is ignored at that decision point.

## Suspected Area

MCP client selection should consistently honor resolved command flags rather than reading only the subcommand-local `--yes` option.
