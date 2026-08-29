# MC-002: execution-local module namespace identity

## Scope and base

- Isolated publisher-origin clone on `main`:
  `/Users/kjopek/Workspace/poe-code-safejs-module-identity`.
- Cloned and immediately pulled `origin main` before investigation or edits.
- Base: `ecfd838abd37fb061d66dc8721bc3f86067139ad`.
- Original clone and audit captures are read-only. Bootstrap the exact 38 paths
  from `inventory-verification.json#/archiveReadPolicy/excludedPaths`, plus the
  entire audit `security/` directory. Read only explicit metadata-linked allowlisted
  nonexcluded paths; do not search the audit recursively or read excluded bytes.
- Preserve upstream MC-001 lint, MC-003 numeric constants, and contextual syntax.
- No provider changes, global mutable cache, source rewrites, dependency changes,
  README additions, commits, pushes, feature branches, or other-clone writes.

## Plan

1. Save base preimages and reproduce the unmodified original weighted graph with
   in-memory host factories and the retained native ESM projection.
2. Add failing tests for repeated namespace identity, imported aliases, module and
   execution isolation, and snapshot/replay behavior.
3. Fix namespace identity at the package import-resolution boundary using its
   existing execution-local module cache.
4. Run focused and broader tests, configured and new-test type checks, lint, and
   formatting; compare every graph field and metric call against native execution.
5. Freeze exact publishable files, base preimages, evidence, and a hash manifest in
   ignored `out/safejs-remediation/mc-002/` for independent validation.

## Implementation

`resolveModuleImports()` already owns an execution-local map keyed by module name.
The bug was that `resolveImportSpecifier()` copied its cached exports for every
namespace import. Build the null-prototype export record once when adding a module
to that existing cache, then return it for each namespace specifier. Named and
default imports continue to resolve the same wrapped exported values.

No additional cache, global mutable state, wrapper proxy, provider branch, runtime
numeric change, parser change, or caller workaround is introduced. Distinct module
names still produce distinct namespaces, including when the caller reuses one host
exports object under multiple names. Separate executions keep independent copied
data. Namespace read-only/live-binding semantics are not expanded by this fix.

## Red/green evidence

```sh
env -u TERM node_modules/.bin/vitest run packages/safejs/src/modules/namespace-identity-mc-002.test.ts --reporter=verbose
```

- Corrected focused RED, with `registry.ts` byte-equal to its saved base preimage:
  **10 failed**, all on namespace equality; 839 ms total, 102 ms tests.
- Focused GREEN: **10 passed**, 842 ms total, 113 ms tests.
- Final formatted-file rerun: **10 passed**, 866 ms total, 92 ms tests.
- Initial authoring attempts are retained separately. Four parameterized fixtures
  initially used unsupported combined default/named import syntax. Their imports
  were split into separate declarations, and the corrected tests were rerun against
  the byte-verified base before reapplying the production fix. No original audit
  source was modified, and those four initial parse failures are not counted as
  identity reproduction evidence.

The dedicated tests cover all four object/Map registry/export combinations,
default/named/function aliases, undefined exports, empty null-prototype namespaces,
distinct module IDs, per-resolution allocation, concurrent and subsequent execution
isolation, three completed replays with changed host capabilities and omitted saved
data, and recovery from a 100-step checkpoint with a larger 5,000-step budget.
Completed host operations are not repeated during either replay scenario. Unit
tests create no files, invoke no LLM, and perform no network or guest filesystem I/O.

## Original full-graph validation

Only explicitly allowlisted paths located through the audit report, selected review,
commands, and case metadata were read. The full 38-path exclusion list and the entire
security-directory exclusion were established before payload reads. The frozen
read-policy artifact enumerates all actual paths; no excluded file was read, hashed,
or executed. No recursive audit search or security research was performed.

Sources are original read-only captures under
`out/safejs-audit-2026-08-27/module-composition-review/` in the original clone:

| Case                                 | Source SHA-256                                                     | Retained native projection SHA-256                                 |
| ------------------------------------ | ------------------------------------------------------------------ | ------------------------------------------------------------------ |
| `examples/graph-original.safejs`     | `ad3ff24fe77d0813d0e24def6984d52c1c6014e36fa9b3a5dfd5c0d795b7fc9b` | `d4514704f9cce57ee740fa06b2d4cb5ba0e64586c76e5d927668224b30649119` |
| `examples/graph-compatible.safejs`   | `f6717b8018d0e438867796c24ffa102dafca5fedb714b7707af73071d6c1c70e` | `1ad79db9081676e10501f675aaac8b0c4457c27a0febc68aec7f26d98165f51b` |
| `examples/namespace-identity.safejs` | `4f2abc071ed8ee802624752668de535baaeda20b6f40818677795e9766ce6a84` | `a4cb46a38885d12f0b54f004173ac9d72cfa9f1aa4ec0a5b8fa187b883180e88` |

The primary witness is the unchanged 134-line **original** graph, including its
`Number.POSITIVE_INFINITY` sentinels and original error-construction syntax. Current
upstream lint accepts it with only the unused `betaPlan` warning. The pre-existing
compatibility capture is an additional MC-001 guard, not a newly authored rewrite.
Native runs execute the already-retained ESM projections; no source adaptation was
created for this fix.

Each child imports current SafeJS TypeScript directly, constructs fresh
`makeHarnessModule` and `makeMetricModule` factories from the recorded fixtures, and
uses only in-memory host responses. Native execution uses a fresh VM context and a
module-name-keyed `SyntheticModule` cache with an explicit four-module allowlist.
The original alias wiring, post-factory title edits, and both weighted DAGs remain
unchanged. No snapshot path or guest I/O capability is registered. Harness checks
read only the exact allowlisted original source path.

Bounds for every child: 192 MiB old-space, 10-second host timeout with SIGKILL,
8 MiB output cap, 2-second native evaluation timeout, and a 3-second abort signal
for SafeJS. Interpreter budgets: 100,000 steps, depth 64, string length 32,768,
array length 4,096, data size 2,097,152, and a 2.5-second deadline.

- RED: three native references match every retained expected field. Two direct
  runs per case and two default-harness runs per graph match every field except
  `namespaceContainerSame`, which is `false` instead of native `true`.
- GREEN: repeat the same 13 child observations. Every direct and harness return
  matches every native/retained expected field, including namespace identity;
  all metric ledgers match. Comparisons normalize serialized data before strict
  equality so host object prototypes are not confused with output values.
- Original graph: 4,316 interpreter steps; compatibility graph: 4,302; reduction: 26.
- Both graph lint results retain exactly the unused `betaPlan` warning at 5:8;
  neither has lint errors. The reduction has no diagnostics.

| Output             | Alpha          | Beta             |
| ------------------ | -------------- | ---------------- |
| Distances          | `[0, 6, 2, 8]` | `[0, 9, 6, 15]`  |
| Adjusted distances | `[1, 7, 3, 9]` | `[2, 11, 8, 17]` |
| Final route        | `[a, c, b, d]` | `[s, u, t, v]`   |

All per-node routes, titles, labels, and import-alias fields match, not just these
summaries. Each graph has exactly four metric calls: alpha-scale, beta-scale,
alpha-bias, beta-bias; per-instance counters are 1, 1, 2, 2 and results are
`[2, 3, 1, 2]`. The reduction has zero metric calls.

## Broader validation

- Installation: `env -u TERM SKIP_SYNC_SKILLS=1 HUSKY=0 npm ci --no-audit --no-fund`.
- Build: `env -u TERM node_modules/.bin/turbo run build --filter=@poe-code/safejs...`;
  all 67 package tasks passed. Dependencies and generated assets stay local.
- Broader tests: `env -u TERM node_modules/.bin/vitest run packages/safejs/src --reporter=dot`;
  **147 files passed, 1 skipped; 4,492 tests passed, 34 skipped** in 26.45 seconds.
  This includes upstream MC-001, MC-003, contextual-from, module, replay, and harness
  regressions. Existing opt-in/skipped cases were not enabled or changed.
- Package types: `env -u TERM node_modules/.bin/tsc -p packages/safejs/tsconfig.json --noEmit`.
- Configured types: `env -u TERM npm run lint:types`.
- New-test types, which the package build excludes:

  ```sh
  env -u TERM node_modules/.bin/tsc --noEmit --strict --target ES2022 --module NodeNext --moduleResolution NodeNext --esModuleInterop --skipLibCheck --resolveJsonModule --types node,vitest/globals packages/safejs/src/modules/namespace-identity-mc-002.test.ts
  ```

- Configured ESLint: `env -u TERM npm run lint:eslint`.
- Configured workflow lint: `env -u TERM npm run lint:workflows`.
- Prettier checks cover all three publishable paths; whitespace checks use
  `git diff --check`. No visual CLI layout changes require screenshots.

## Freeze and handoff

Exactly three publishable paths:

1. `packages/safejs/src/modules/registry.ts`
2. `packages/safejs/src/modules/namespace-identity-mc-002.test.ts`
3. `docs/plans/safejs-fix-mc-002.md`

Ignored `out/safejs-remediation/mc-002/` holds immutable copies of these files,
the base preimage (with absent-at-base metadata for the two new files), exact
red/green logs and original-case observations, commands/limits, an audit read-policy
record, and a SHA-256 manifest. The artifact directory is locally excluded through
this clone's `.git/info/exclude`; no repository ignore rules are published.
Build-generated terminal font files are not publishable changes.

Risk is limited to namespace aliasing within one execution/module. Existing data
copying, host capabilities, cancellation wiring, namespace null prototypes, and
snapshot machinery are unchanged. No global cross-run namespace state is added.
This repairs the scoped P3 identity observation; it is not a claim of complete ESM
live-binding or namespace immutability conformance. No commits or pushes were made.
