# MC-001: documented nonfinite globals rejected by lint

## Scope

- Work only in `packages/safejs/src/lint/**` and this document.
- Preserve concurrent changes, runtime implementations, parser, README, and master ledger.
- Original audit is read-only. Bootstrap the exact 38 excluded paths from
  `inventory-verification.json#/archiveReadPolicy/excludedPaths`; exclude the whole
  audit `security/` directory before reading payloads. No archived payloads or
  security probes are read or executed.

## Contract and cause

The README explicitly lists global `Infinity` and `NaN` and promises lint knows
the documented built-ins by default. `createMathGlobals()` already provides both.
The shared declarative `KNOWN_RUNTIME_GLOBALS` list omits both names, affecting
unknown-name validation and shadow warnings. No runtime change is necessary.

The original MC-001 review uses the unchanged 134-line `graph-compatible.safejs`
workflow with two Infinity references, at lines 85 and 92. Its existing callable
Error adaptation avoids intentional constructor lint errors. MC-003 numeric
properties and MC-002 namespace identity remain separate findings.

## Steps

1. Add focused default-lint, shadowing, unknown-name, and memfs harness regressions;
   derive math-global parity cases from the existing runtime factory.
2. Observe failures, then correct only the shared declarative lint global list.
   Avoid importing runtime factories into production lint solely to enumerate names.
3. Run focused and broader lint/harness tests, static checks, and the unchanged
   substantial graph with in-memory host modules and bounded execution.
4. Record exact red/green evidence and remaining scope qualifications here.

## Validation

### Focused red/green

Command:

```sh
node_modules/.bin/vitest run packages/safejs/src/lint/known-globals-mc-001.test.ts --reporter=verbose
```

- Before implementation: **6 failed, 8 passed**, 1.65 seconds total, 63 ms tests.
  Failures cover Infinity and NaN name recognition, nonfinite expressions,
  both shadow warnings, and the actual default harness gate (`LintError/AS003`).
- After adding the two names: **14 passed**, 1.58 seconds total, 49 ms tests.
- Tests use memfs only for harness input; no files or LLM calls are created by tests.
- `Number.POSITIVE_INFINITY`, `Number.NEGATIVE_INFINITY`, and `Number.NaN` are
  lint-only controls, not runtime assertions about the separately owned MC-003 fix.

### Unchanged substantial MC-001 case

Read-only source in the original repository:
`out/safejs-audit-2026-08-27/module-composition-review/examples/graph-compatible.safejs`.
The original 134-line source remains unmodified, SHA-256
`f6717b8018d0e438867796c24ffa102dafca5fedb714b7707af73071d6c1c70e`.

Executed current TypeScript through `node --import tsx --input-type=module`,
importing this workspace's lint, runtime-module metadata adapter, `runHarness`,
`makeHarnessModule`, `makeMetricModule`, and `Budget` directly from `src`.
No historical driver was executed, and no SafeJS `dist` entry was used.

The read-only review fixtures and `results.json` supply both four-node graphs,
factory configuration, expected outputs, and expected calls. The host registry
uses the original object/object shape and alias wiring: `planA`, `planB`,
`metricA`, `metricB`. Metric callbacks only return fixture strings in memory.
Frontmatter title edits after factory creation preserve the original copy checks.
No guest external I/O, LLM calls, snapshots, or entry-point arguments are supplied.

Limits: 100,000 steps, call depth 64, string length 32,768, array length 4,096,
data size 2,097,152, 2.5-second budget deadline, 3-second abort signal, and a
12-second host-process timeout.

| Observation              | Before fix, both attempts             | After fix, both attempts                   |
| ------------------------ | ------------------------------------- | ------------------------------------------ |
| Lint errors              | AS003 at 85:44 and 92:35 for Infinity | Zero                                       |
| Retained warning         | Unused `betaPlan` import at 5:8       | Same warning                               |
| Actual harness           | `LintError`, zero runtime steps       | `ok: true`, 4,302 steps                    |
| Metric calls             | None                                  | Four, exactly matching the retained ledger |
| Alpha distances          | Not executed                          | `[0, 6, 2, 8]`                             |
| Beta distances           | Not executed                          | `[0, 9, 6, 15]`                            |
| Alpha adjusted distances | Not executed                          | `[1, 7, 3, 9]`                             |
| Beta adjusted distances  | Not executed                          | `[2, 11, 8, 17]`                           |
| Final alpha route        | Not executed                          | `[a, c, b, d]`                             |
| Final beta route         | Not executed                          | `[s, u, t, v]`                             |

The four calls remain alpha-scale, beta-scale, alpha-bias, beta-bias, with
per-instance counters 1, 1, 2, 2 and returned metrics `[2, 3, 1, 2]`.
Complete serialized graph payloads, all per-node routes, labels, titles, and alias
controls match the retained native oracle except the already documented MC-002
`namespaceContainerSame: false` versus native `true`. This is not a claim of full
native equivalence. Comparisons use JSON-normalized data: an initial raw
`isDeepStrictEqual` comparison also distinguished object prototypes; after
normalization, only the known namespace boolean differs.

### Broader checks

- Lint-directory and actual harness suite: **37 files, 515 tests passed**,
  7.59 seconds total, 2.62 seconds tests.
- Expanded final run including the public lint facade and runtime math tests:
  **38 files, 551 tests passed**, 7.41 seconds total, 2.34 seconds tests:

  ```sh
  node_modules/.bin/vitest run packages/safejs/src/lint packages/safejs/src/lint.test.ts packages/safejs/src/runner/run-harness.test.ts packages/safejs/src/interp/globals/math.test.ts --reporter=dot
  ```

- `node_modules/.bin/eslint packages/safejs/src/lint`: passed.
- `node_modules/.bin/tsc -p packages/safejs/tsconfig.json --noEmit`: passed.
- Prettier checks for all three owned paths: passed.
- `git diff --check` for owned paths: passed.

## Changed paths and risk

- `packages/safejs/src/lint/rules/known-globals.ts`: two declarative entries only.
- `packages/safejs/src/lint/known-globals-mc-001.test.ts`: dedicated regressions.
- `docs/plans/safejs-fix-mc-001.md`: scope and evidence.

Risk is limited to name recognition, typo suggestions, and appropriate shadow
warnings for two already supported globals. Existing unknown-name controls,
import handling, and custom `allowedGlobals` behavior pass. No runtime numeric
change, parser change, CLI layout change, dependency change, or security finding
is included. No commits, pushes, branches, master-ledger edits, or writes to the
original repository were performed. Concurrent owners' changes were left intact.
