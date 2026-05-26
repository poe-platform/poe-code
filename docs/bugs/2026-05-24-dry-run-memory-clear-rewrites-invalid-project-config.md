# Dry-run memory clear rewrites invalid project configuration

## Summary

Running `memory clear` with `--dry-run --yes` rewrites malformed project configuration while only previewing deletion and re-initialization of memory contents.

## Environment

- Date reproduced: 2026-05-24
- Repository branch: `main`
- Package version: `0.0.0-dev`
- Runtime: local TypeScript CLI entrypoint

## Reproduction

From the repository root, create initialized disposable memory and preview clearing it:

```sh
probe=$(mktemp -d)
mkdir -p "$probe/home" "$probe/project/.poe-code/memory/pages"
printf '{ invalid json\n' > "$probe/project/.poe-code/config.json"
printf '# Memory Index\n' > "$probe/project/.poe-code/memory/INDEX.md"
printf '# Memory Log\n' > "$probe/project/.poe-code/memory/LOG.md"
printf -- '---\ndescription: Probe page\n---\nneedle value\n' > "$probe/project/.poe-code/memory/pages/probe.md"

(
  cd "$probe/project"
  HOME="$probe/home" npx --prefix /path/to/poe-code tsx \
    --import /path/to/poe-code/scripts/register-template-loader.mjs \
    /path/to/poe-code/src/index.ts --dry-run --yes memory clear
)

find "$probe/project/.poe-code" -maxdepth 1 -type f -print -exec cat {} \;
```

Replace `/path/to/poe-code` with the repository checkout path.

## Observed Behavior

- The command reports `Would clear memory at .../.poe-code/memory`.
- `.poe-code/config.json` is overwritten with `{}`.
- `.poe-code/config.json.invalid-<timestamp>.json` is created containing the malformed original.

## Expected Behavior

With `--dry-run`, clearing memory must not repair configuration files or otherwise mutate project state while previewing the destructive action.

## Impact

- A destructive-operation preview is not safe to run for inspection.
- The dry-run alters project state even though memory pages remain untouched.
- Users can lose malformed configuration at its original path before consenting to an action.

## Supporting Evidence

The root CLI advertises `--dry-run` as `Simulate commands without writing changes.` in `src/cli/program.ts`. `src/cli/commands/memory.ts` resolves the configured root before its dry-run return for `memory clear`, and invalid-document recovery reached through `packages/memory/src/resolve-root.ts` writes replacement and backup files in `packages/poe-code-config/src/store.ts`.

## Suspected Area

Dry-run memory actions need non-mutating root resolution before rendering previews.
