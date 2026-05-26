# MCP invalid or unsupported agent errors exit successfully

## Summary

The `mcp configure` and `mcp unconfigure` commands print error messages for unknown or unsupported agents but return exit status `0`, causing failed MCP operations to appear successful to scripts and CI.

## Environment

- Date reproduced: 2026-05-24
- Repository branch: `main`
- Package version: `0.0.0-dev`
- Runtime: local TypeScript CLI entrypoint with a disposable home/project directory and stored Poe credential for the configure validation path

## Reproduction

From the repository root, create stored Poe authentication so MCP configure reaches agent validation, then invoke invalid and unsupported target agents:

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
run() {
  (
    cd "$probe/project" &&
    HOME="$probe/home" \
      "$repo/node_modules/.bin/tsx" \
      --import "$probe/fetch-preload.mjs" \
      --import "$repo/scripts/register-template-loader.mjs" \
      "$repo/src/index.ts" --yes "$@"
  )
}
run login --api-key stored-key
run mcp configure not-a-real-agent --yes; echo "configure unknown exit=$?"
run mcp configure gemini-cli --yes; echo "configure unsupported exit=$?"
run mcp unconfigure not-a-real-agent; echo "unconfigure unknown exit=$?"
run mcp unconfigure gemini-cli; echo "unconfigure unsupported exit=$?"
```

## Observed Behavior

- `mcp configure not-a-real-agent --yes` prints `Unknown agent: not-a-real-agent` but exits `0`.
- `mcp configure gemini-cli --yes` prints `MCP not supported for gemini-cli.` but exits `0`.
- `mcp unconfigure not-a-real-agent` prints `Unknown agent: not-a-real-agent` but exits `0`.
- `mcp unconfigure gemini-cli` prints `MCP not supported for gemini-cli.` but exits `0`.

## Expected Behavior

When an MCP command cannot proceed because its target agent is unknown or unsupported, it must exit non-zero after printing the error.

## Impact

- Scripts and CI treat invalid MCP setup or cleanup commands as successful.
- Misspelled or unsupported agent selections silently skip intended configuration work.
- Error output and process status contradict each other, making automated diagnosis unreliable.

## Supporting Evidence

In `src/cli/commands/mcp.ts`, both configure and unconfigure handlers call `resources.logger.error(...)` and immediately `return` for `unknown` or `unsupported` support results. They do not throw, call `this.error(...)`, or set `process.exitCode`, so Commander completes successfully with exit status `0`.

## Suspected Area

MCP command validation failures need standard CLI error propagation and non-zero exit status handling.
