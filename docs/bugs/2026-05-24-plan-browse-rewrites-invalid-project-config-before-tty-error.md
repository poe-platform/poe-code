# Plan browse rewrites invalid project config before TTY error

## Summary

Running `plan browse` without a terminal rewrites malformed project configuration before reporting that the interactive explorer requires a TTY.

## Environment

- Date reproduced: 2026-05-24
- Repository branch: `main`
- Package version: `0.0.0-dev`
- Runtime: local TypeScript CLI entrypoint with stdin redirected

## Reproduction

From the repository root, create a disposable project with malformed configuration and a plan, then invoke the interactive browser non-interactively:

```sh
probe=$(mktemp -d)
mkdir -p "$probe/home" "$probe/project/.poe-code" "$probe/project/docs/plans"
printf '{ invalid json\n' > "$probe/project/.poe-code/config.json"
printf '# One\n' > "$probe/project/docs/plans/one.md"

(
  cd "$probe/project"
  HOME="$probe/home" npx --prefix /path/to/poe-code tsx \
    --import /path/to/poe-code/scripts/register-template-loader.mjs \
    /path/to/poe-code/src/index.ts plan browse </dev/null
)

find "$probe/project/.poe-code" -maxdepth 1 -type f -print -exec cat {} \;
```

Replace `/path/to/poe-code` with the repository checkout path.

## Observed Behavior

- The command fails with `Error: explorer requires a TTY`.
- Before returning that error, `.poe-code/config.json` is overwritten with `{}`.
- `.poe-code/config.json.invalid-<timestamp>.json` is created containing the malformed original.

## Expected Behavior

If interactive browsing cannot run without a TTY, it should fail before performing any persistent config repair. Inspecting plans through an aborted browser startup must not modify project files.

## Impact

- Headless callers attempting to detect browser availability unexpectedly dirty the project.
- A failing inspection command can replace malformed configuration before diagnostics are shown.
- Scripts cannot safely attempt the browser command as a capability check.

## Supporting Evidence

`src/cli/commands/plan.ts` invokes `runPlanBrowser` for `plan browse`, and plan-browser discovery reads merged configuration through `packages/plan-browser/src/discovery.ts`. Invalid-document recovery in `packages/poe-code-config/src/store.ts` writes replacement and backup files during that discovery, before the non-TTY failure is surfaced.

## Suspected Area

The plan browser should validate terminal requirements before discovery, and read-only discovery needs non-mutating config handling.
