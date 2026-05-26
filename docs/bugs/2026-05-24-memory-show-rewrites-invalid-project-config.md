# Memory show rewrites invalid project configuration

## Summary

Running `memory show` rewrites malformed project configuration while reading and printing an existing memory page.

## Environment

- Date reproduced: 2026-05-24
- Repository branch: `main`
- Package version: `0.0.0-dev`
- Runtime: local TypeScript CLI entrypoint

## Reproduction

From the repository root, create initialized disposable memory containing a page and malformed project config:

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
    /path/to/poe-code/src/index.ts memory show probe
)

find "$probe/project/.poe-code" -maxdepth 1 -type f -print -exec cat {} \;
```

Replace `/path/to/poe-code` with the repository checkout path.

## Observed Behavior

- The command successfully prints the contents of `probe.md`.
- `.poe-code/config.json` is overwritten with `{}`.
- `.poe-code/config.json.invalid-<timestamp>.json` is created containing the malformed original.

## Expected Behavior

Displaying a memory page must be read-only. A malformed project configuration should not be repaired or backed up merely to locate and print existing memory content.

## Impact

- Reading a page silently modifies unrelated project state.
- Inspection can replace the configuration file before the user chooses any repair action.
- Consumers using memory pages as a read-only knowledge source can dirty repositories.

## Supporting Evidence

`src/cli/commands/memory.ts` resolves the configured memory root before reading the selected page. That resolution flows through `packages/memory/src/resolve-root.ts` to config reads, and invalid-document recovery in `packages/poe-code-config/src/store.ts` writes replacement and backup files.

## Suspected Area

Read-only memory access commands need non-mutating configuration resolution.
