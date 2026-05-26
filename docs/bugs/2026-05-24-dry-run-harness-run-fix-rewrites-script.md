# Dry-run harness run --fix rewrites the harness script

## Summary

Running `harness run --fix` with `--dry-run` still applies lint autofixes directly to the `.ajs` source file. A disposable harness containing a fixable needless template is rewritten on disk during simulation.

## Environment

- Date reproduced: 2026-05-24
- Repository branch: `main`
- Package version: `0.0.0-dev`
- Runtime: local TypeScript CLI entrypoint

## Reproduction

From the repository root, create a disposable harness with a fixable script:

```sh
probe=$(mktemp -d)
mkdir -p "$probe/home" "$probe/project/harness"

cat > "$probe/project/harness/fix.md" <<'EOF'
---
kind: probe
version: 1
---
# Probe
EOF

cat > "$probe/project/harness/fix.ajs" <<'EOF'
export default () => `${1}`;
EOF

(
  cd "$probe/project"
  HOME="$probe/home" npx --prefix /path/to/poe-code tsx \
    --import /path/to/poe-code/scripts/register-template-loader.mjs \
    /path/to/poe-code/src/index.ts --dry-run --yes harness run harness/fix.md --fix
)

cat "$probe/project/harness/fix.ajs"
```

Replace `/path/to/poe-code` with the repository checkout path.

## Observed Behavior

The input script starts as:

```js
export default () => `${1}`;
```

After the dry-run command, it has been rewritten to:

```js
export default () => String(1);
```

## Expected Behavior

With `--dry-run`, `harness run --fix` must not persist lint fixes. It should report the edits that would be applied or execute against an in-memory fixed copy only.

## Impact

- Previewing harness fixes unexpectedly alters source-controlled scripts.
- Users cannot safely inspect autofix behavior before applying edits.
- Dry-run validation or CI invocations can dirty the worktree.

## Supporting Evidence

The root CLI describes `--dry-run` as `Simulate commands without writing changes.` in `src/cli/program.ts`. `src/cli/commands/harness.ts` passes `fix: true` through while ignoring dry-run execution semantics; `packages/agent-harness/src/loader/run.ts` writes `lintDiagnostics.fixed` to `pair.ajsPath` whenever it differs from source.

## Suspected Area

Harness dry-run execution must suppress persisted autofix writes or provide a dedicated preview-only lint path.
