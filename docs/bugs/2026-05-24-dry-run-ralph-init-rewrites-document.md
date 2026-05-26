# Dry-run ralph init rewrites the selected document

## Summary

Running `ralph init` with `--dry-run` still writes Ralph frontmatter into the selected markdown document. The command persists changes instead of simulating initialization.

## Environment

- Date reproduced: 2026-05-24
- Repository branch: `main`
- Package version: `0.0.0-dev`
- Runtime: local TypeScript CLI entrypoint

## Reproduction

From the repository root, run the command against a temporary document:

```sh
probe=$(mktemp -d)
mkdir -p "$probe/project/docs" "$probe/home"
printf '# Ralph document\n\nBody\n' > "$probe/project/docs/loop.md"

(
  cd "$probe/project"
  HOME="$probe/home" npx --prefix /path/to/poe-code tsx \
    --import /path/to/poe-code/scripts/register-template-loader.mjs \
    /path/to/poe-code/src/index.ts --dry-run --yes \
    ralph init docs/loop.md
)

cat "$probe/project/docs/loop.md"
```

Replace `/path/to/poe-code` with the repository checkout path.

## Observed Behavior

The CLI reports `Ralph config saved.`. The previously plain markdown file is rewritten to include generated Ralph frontmatter, including `$schema`, `kind`, `agent`, `iterations`, and `status` fields.

For example, the rewritten document begins with:

```yaml
---
$schema: https://poe-platform.github.io/poe-code/schemas/plans/ralph.schema.json
kind: ralph
version: 1
agent: claude-code
iterations: 3
status:
  state: open
  iteration: 0
---
```

## Expected Behavior

With `--dry-run`, `ralph init` must not rewrite the selected document. It should describe the frontmatter that would be initialized while preserving the original markdown file.

## Impact

- Previewing Ralph initialization unexpectedly edits documentation files.
- New schema and runtime state metadata are inserted without the user opting into writes.
- The global no-write mode is unreliable across planning workflows.

## Supporting Evidence

The root CLI documents `--dry-run` as `Simulate commands without writing changes.` in `src/cli/program.ts`. The `ralph init` action in `src/cli/commands/ralph.ts` resolves global flags, then unconditionally calls `container.fs.writeFile` after generating frontmatter.

## Suspected Area

The `ralph init` action needs a dry-run branch before writing the transformed document and should render its intended change without modifying the file.
