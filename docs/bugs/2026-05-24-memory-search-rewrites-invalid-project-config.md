# Memory search rewrites invalid project configuration

## Summary

Running `memory search` rewrites malformed project configuration while searching existing memory pages for matching text.

## Environment

- Date reproduced: 2026-05-24
- Repository branch: `main`
- Package version: `0.0.0-dev`
- Runtime: local TypeScript CLI entrypoint

## Reproduction

From the repository root, create initialized disposable memory containing searchable text and malformed project config:

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
    /path/to/poe-code/src/index.ts memory search needle
)

find "$probe/project/.poe-code" -maxdepth 1 -type f -print -exec cat {} \;
```

Replace `/path/to/poe-code` with the repository checkout path.

## Observed Behavior

- The command successfully prints the match `probe.md:4: needle value`.
- `.poe-code/config.json` is overwritten with `{}`.
- `.poe-code/config.json.invalid-<timestamp>.json` is created containing the malformed original.

## Expected Behavior

Searching memory content must be read-only. Invalid configuration encountered while locating the memory root should not cause project-file mutations during search.

## Impact

- Querying memory silently changes project configuration.
- Search tooling can dirty a repository simply by reading persisted context.
- The automatic repair removes the malformed original from its expected path before diagnosis.

## Supporting Evidence

`src/cli/commands/memory.ts` resolves the configured memory root before executing search. `packages/memory/src/resolve-root.ts` reads configuration through the config package, whose invalid-document recovery in `packages/poe-code-config/src/store.ts` writes replacement and backup files.

## Suspected Area

Memory search needs side-effect-free root resolution for read-only operations.
