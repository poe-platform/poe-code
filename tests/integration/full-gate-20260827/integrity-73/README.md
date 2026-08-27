# Protected-tree admission and phase integrity

2026-08-27. Author source `0abce394`; different review pending. No whole gate ran.

## Scope and setup boundaries

`tree.mjs` records deterministic directory, file and symlink entries, including
empty directories and the root. File entries bind mode, size and SHA256; links
bind their target without following them. Added, removed, changed or unreadable
entries reject. The private baseline cannot be changed through a returned copy.
Named guards cannot be silently resealed.

The external `combined-8670ebe8/run.mjs` now checks protected trees before and
after each child phase, in addition to its existing original-input checks:

- After authorized archive/native setup: `src`, `tests`, `scripts`, `docs`,
  `benchmarks` and staged native tools are protected.
- After the authorized build, prior guards must still pass; the entire prepared
  source directory is sealed, including legitimate build/dependency outputs.
- After installation and public-fixture setup, the entire installed consumer
  directory is sealed. New package/source/artifact entries are not allowlisted.

Consumer capture allocation in `tests/plugins/qualified-current-release/snapshot.mjs`
uses unique canonical OS-temp directories, not source-local `.runs`. The runner
no longer replaces authenticated staged rg with ambient `command -v rg` bytes.
No previous native hash was changed. Strict-live admission remains intact.

These runner changes are an external harness revision. Its existing candidate
binding is still8670; a future candidate is not selected or launched here, and
the historical8670 captures are not rewritten or rescored.

## Author checks

`controls.tap`: **34/34**, zero skips. This comprises27 tree controls (twelve
mutations for each source/package role plus deterministic/setup and restored-byte
cases) and7 integration controls. Four integration cases execute the actual
runner's extracted pre/post-phase functions against a stub child supervisor;
the others check reseal rejection, staging/setup source policies, and the actual
capture allocator. This is not execution of the complete product runner.

`mutants.json`: **2/2 detected** through actual child test processes: suppressing
added entries and bypassing comparison. Negative TAP is preserved, not counted
as product failures. Temporary control/mutant resources were removed.

Reproduce without a product suite:

```sh
node --test --test-reporter=tap tests/integration/full-gate-20260827/integrity-73/controls.test.mjs tests/integration/full-gate-20260827/integrity-73/runner-controls.test.mjs
node tests/integration/full-gate-20260827/integrity-73/mutations.mjs
```

## Limits

This is a before/after inventory, not filesystem write-attempt tracing or an
atomic snapshot. A transient modification restored byte-for-byte before checking
is not detected; an explicit characterization preserves that limitation. The
in-read stat check is not a universal concurrent-host-JavaScript safety guarantee.
Legitimate build/setup outputs are sealed after their authorized creation, not
certified as harmless solely because they exist. No full-run acceptance follows.
