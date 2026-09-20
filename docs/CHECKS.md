# Running repository checks

Use `npm test` for the root and every declared workspace unit task, including
required builds and npm lifecycle hooks. Use `npm run build` for the complete
workspace and root build. Use `npm run lint` for ESLint, typechecking, and workflows.

Native arithmetic oracle cases that require Bash 4.4 report explicit skips on
older host Bash versions. Their paired product arithmetic checks always run.

Successful ordinary workspace builds and compatible workspace unit results use a
machine cache by default. Root tests, non-Vitest native tasks, lifecycle-dependent builds,
and workspaces with directory symlink inputs still execute. Compatible unit
cache misses execute in fresh subprocesses of at most 100 files, retaining
per-file isolation and validating exact completion before caching results.

The cache lives in `$XDG_CACHE_HOME/poe-code/checks-v1`, or
`~/.cache/poe-code/checks-v1` when XDG_CACHE_HOME is unset. Set
`POE_CHECK_CACHE_DIR` to choose another directory. Content, dependency closure,
commands, runtime, and relevant environment changes invalidate results. Checkout
paths in npm's local executable search entries do not prevent cache reuse.

To run fresh checks:

```sh
npm test -- --no-cache
npm run build:workspaces -- --no-cache
npm run lint:eslint -- --no-cache
```

`TURBO_FORCE=true` also forces fresh maintained workspace builds and unit checks.
ESLint's diagnostic cache only stores clean ordinary results; authenticated input
reads and boundary receipts run every time. Processor and type-aware checks run
fresh. Root TypeScript noEmit checks retain incremental state in `.turbo/types`.

For a focused build closure:

```sh
npm run build:workspaces -- --workspace=@poe-code/frontmatter
npm run build:workspaces -- --affected=origin/main
npm test -- --affected=origin/main
```

Affected selection includes changed workspace owners and their declared
transitive consumers. Root or unowned changes select all workspaces. Dirty and
untracked nonignored files count as changes. Root tests remain included.

To evaluate the native TypeScript lint route:

```sh
npm run lint:eslint -- --engine=oxlint --no-cache
```

This opt-in backend runs supported ordinary module TypeScript rules on snapshots
of authenticated bytes. Unsupported rules, TypeScript scripts needing strict
module octal checks, JavaScript, processors, and type-aware checks retain ESLint.
Positive native findings are confirmed by ESLint for matching diagnostics;
uncertain native execution falls back to ESLint. The default engine remains
ESLint while broader rule equivalence is evaluated. Oxlint's development runtime
requirement is Node 20.19 or Node 22.12 and newer; unavailable native execution
falls back to ESLint and does not change the product runtime requirement.
