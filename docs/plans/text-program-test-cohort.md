# Text-program test cohort

## Scope and acceptance

The September 1, 2026 pilot owns only
`packages/safe-bash/tests/commands/text-programs/**` and this document.
Combine the ten text-program test entrypoints through static imports of
byte-identical, same-directory `.cases.ts` modules. Preserve all 42 test names,
cases, assertions, helpers, and case-local state. This deliberately changes
per-file process isolation to per-family process isolation. Other families keep
their existing isolation; no concurrency, runner, discovery exclusion, production,
historical evidence, Git, or release changes are authorized.

## Validation plan

1. Inspect mocks, mutable state, timers, fixtures, seals, and active importers.
2. Preserve original source hashes and three complete serial baseline sweeps.
3. Rename the case modules and add one static-import entrypoint.
4. Compare repeated serial old/new sweeps, exact names/counts, unchanged source
   bytes, same-process repeats, reversed ordering, and intentional failure
   attribution. Remove temporary probes before handoff.
5. Keep the cohort only if measured improvement and isolation checks pass;
   record measurements, commands, limitations, and every old/new path here.

## Preliminary inspection

All ten files register flat `node:test` tests. There are no global mocks, hooks,
environment changes, native oracle launches, or on-disk fixtures. `helpers.ts`
creates fresh memory filesystems, command definitions, buffers, and abort
controllers for each invocation. Filesystem method overrides and producer state
are instance-local. Cancellation timers are cleared in `finally`; the getline
late-rejection case explicitly settles its private rejected read. Text-program
module-level tables are read-only in use, with no mutable test singleton.

Authenticated discovery initially selects ten files in this directory. No fixture
boundary mentions this directory. A bounded scan of 632 active test, script, and
package configuration files finds no literal `text-programs/<old-name>.test.ts`
consumers. Historical captures are not rewritten to follow these renames.

The first three serial baseline runs each pass all 42 cases with no failures,
cancellations, skips, or TODOs. Wall times: 4800.255, 4531.072, 4881.039 ms.
The completed validation and decision follow.

## Decision and measurements

Keep the bounded cohort. Six counterbalanced serial runs per layout have median
wall times of 4.138 s (ten processes) and 0.747 s (one family process):
81.95% less wall time, 5.54x faster, and 3.391 s saved per family run.
This is a local family result, not a full-workspace or release benchmark.

Environment: September 1, 2026; live, concurrently used worktree
`/tmp/poe-test-speed-push-20260901`; Darwin arm64; Node v22.22.2;
resolved package-local tsx 4.23.12 (the unused root copy is 4.22.4).
The frozen benchmark checkout was not modified.
No cache-clearing or host-load control was imposed. Initial runs include their
observed warm-up effects. Counterbalanced runs use the same renamed case bytes
and paths in both layouts to avoid a filename/cache confound.

Initial old runs use the ten original `.test.ts` paths. Counterbalanced old
runs explicitly pass the ten `.cases.ts` paths as ten Node entrypoints,
retaining default per-file process isolation. New runs pass only
`text-programs.test.ts`. Both use the existing serial setting
`--test-concurrency=1`, not a concurrency modification.

All 18 measured sweeps execute exactly the same ordered 42 names below, with
42 passes, zero failures/cancellations/skips/TODOs, exit 0, and no stderr.
Wall time includes child startup and exit, measured with `performance.now()`.
Node duration is TAP `duration_ms`, not the sum of case durations.

| Sweep | Wall ms | Node duration ms |
| --- | ---: | ---: |
| old-initial-1 | 4800.255 | 4755.153 |
| old-initial-2 | 4531.072 | 4479.618 |
| old-initial-3 | 4881.039 | 4833.247 |
| new-initial-1 | 805.111 | 762.058 |
| new-initial-2 | 665.418 | 623.537 |
| new-initial-3 | 672.993 | 631.867 |
| balanced-1-new | 726.175 | 682.782 |
| balanced-2-old | 3839.850 | 3795.956 |
| balanced-3-old | 4063.467 | 4016.375 |
| balanced-4-new | 696.119 | 651.207 |
| balanced-5-new | 678.049 | 631.315 |
| balanced-6-old | 4199.484 | 4157.461 |
| balanced-7-old | 4373.338 | 4324.320 |
| balanced-8-new | 797.501 | 747.097 |
| balanced-9-new | 767.305 | 716.735 |
| balanced-10-old | 4488.262 | 4439.814 |
| balanced-11-old | 4076.846 | 4027.272 |
| balanced-12-new | 774.057 | 729.739 |

## Files and case preservation

Paths below are relative to
`packages/safe-bash/tests/commands/text-programs/`. Each renamed file is
byte-for-byte identical to its original, including every assertion, literal,
loop, timeout, import, and line number. The hash applies to both old and new.

| Old path | New path | Cases | SHA-256 |
| --- | --- | ---: | --- |
| `awk.test.ts` | `awk.cases.ts` | 15 | `350e6ab28c7c6afa99edc19e32b5d250f2325b5e8e7dde354b6742bd736685bc` |
| `cancellation.test.ts` | `cancellation.cases.ts` | 8 | `e790076d6cdcc361a6aa7ccdbf6d3d713470f863cd26150291c8ff0e45656752` |
| `capture-regressions.test.ts` | `capture-regressions.cases.ts` | 2 | `a05b8874a92c064769f093d8e0fe935e74fbb8607951fb222ff369bda472c132` |
| `file-commands.test.ts` | `file-commands.cases.ts` | 2 | `a2188baa3a249c3b0eb6f76675a8ec2c4e1c543e1e59cb0cea90ac97016de1a2` |
| `getline.test.ts` | `getline.cases.ts` | 5 | `f988e57c1f87e38580fdd415fb2f36e7374fe3228eebbf2930ae84deb7243a05` |
| `list-command.test.ts` | `list-command.cases.ts` | 1 | `ea4e6a2e0ea01039ad970fc75d959551ab3ccdf6cf04d5ba7418286da5ef1879` |
| `lookahead-regressions.test.ts` | `lookahead-regressions.cases.ts` | 1 | `4461bfd234a62c95f1be1576cc9360f63a603f622e435a79e47b73a1d686b452` |
| `oracle-validity.test.ts` | `oracle-validity.cases.ts` | 1 | `331b8b8abdb3abc5a3de1fdc9dd0ac9a0cd1f30bf859907f95c760616ac325c3` |
| `quit-regressions.test.ts` | `quit-regressions.cases.ts` | 4 | `0e0734db64fa83972fd49de7ccc1bb0cf4aab09f29fa474537b2e5dba475f2f1` |
| `sed.test.ts` | `sed.cases.ts` | 3 | `f722866a1ebeac9577895f5b5c80868f56bbff5467644ba854e99d3b98767158` |

Added: `text-programs.test.ts` (ten static side-effect imports in original
lexical discovery order) and this document. No wrappers, hooks, factories,
new permanent tests, or reset machinery were added.

Unchanged helper: `helpers.ts`, SHA-256
`205512c658dc6d226d7ce55e282808ae7d6fa3458c35aaa616c870d4cbf8a1a6`.
No production, runner, flags/defaults, configuration, fixture owner, seal,
historical evidence, or discovery exclusion was edited.

## Isolation, discovery, and attribution

- The single-entrypoint discovery assertion first failed against the original
  ten paths, then passed after aggregation. Authenticated discovery changed
  from 611 to 602 active entrypoints at the check; the exact non-cohort list
  was unchanged. This is nine fewer entrypoints, not nine fewer tests.
- A follow-up transitive active-source scan visited 1,353 test/script/dependency
  paths, found no old `.test.ts` or `.test.js` filename consumers, and omitted
  no queued paths. Historical filenames remain history, not active imports.
- Source inventory: 248 admitted production `.ts` files, excluding existing
  held-source, held-evidence, and fixture boundaries. Lexically sorted
  `[relativePath, sha256]` pairs serialized as compact JSON have SHA-256
  `23c44178009dddc3c7e2741b4b331004fab44379b25b68abfa3477899abcd2a1`.
  The full inventory was identical immediately before and after counterbalanced
  runs. This establishes stability for that interval, not an immutable Git
  candidate or an entire concurrent worktree.
- Three temporary same-process probes each registered the unchanged modules
  forward, reverse-by-module, then forward again. Distinct module URL queries
  force fresh case registration while sharing normal helper/production imports.
  Each probe passed 126/126 cases with exact expected names/order, no stderr,
  and zero failures/cancellations/skips/TODOs. Wall times:
  1240.672, 1184.334, 1132.320 ms.
  The temporary entrypoint was removed. No leakage was observed; this is not
  proof against every possible future module-level mutation.
- Temporary `assert.fail` statements at the first test callback in each module
  intentionally produced 25 failures and 17 passes because some callbacks are
  parameterized. All 42 names remained, with zero cancellations/skips/TODOs.
  TAP and the maintained concise reporter both exited 1, retained all failing
  names, and reported the exact injected `.cases.ts` assertion file/line for
  all ten modules. Failures were not reduced to an unattributed aggregate error.
  Every probe assertion was removed; original byte hashes were rechecked.
- Restored full cohort: 42/42 pass under TAP and separately 42/42 under the
  maintained concise reporter. Discovery/reporter regression files: 106/106
  pass with zero failures/cancellations/skips/TODOs (31.372 s Node duration).
- Per-case filesystem, command, controller, stream, and buffer construction
  remains unchanged. Per-file process isolation deliberately becomes per-family
  isolation: catastrophic process failure can affect the family rather than
  one former file. Ordinary assertion failures were explicitly verified not
  to suppress sibling cases. No global mocks or reset hooks were introduced.

## Reproduction and scoped checks

Run from `packages/safe-bash`. The old-layout glob selects exactly ten case
modules; the new layout selects one entrypoint. Finish each child before
starting the next. Counterbalanced order is new/old/old/new, repeated three times.

```sh
node --import tsx --test --test-concurrency=1 --test-reporter=tap tests/commands/text-programs/*.cases.ts
node --import tsx --test --test-concurrency=1 --test-reporter=tap tests/commands/text-programs/text-programs.test.ts
node --import tsx --test --test-concurrency=1 --test-reporter=./scripts/test-reporting.mjs tests/commands/text-programs/text-programs.test.ts
node --test --test-concurrency=1 --test-reporter=tap scripts/integration-inputs.test.mjs scripts/test-reporting.test.mjs
```

For order validation, temporarily create an owned `.mjs` entrypoint importing
each `.cases.ts` with a unique first-pass URL query, reverse the module order
with a second query, then restore forward order with a third query. Run three
times; require 126 exact names each time, then remove the temporary entrypoint.
For attribution, temporarily insert a distinct failing assertion at each module's
first callback. Verify both reporters against original names and injected
file/line locations, remove injections, and require original hashes plus 42 passes.

No Git or raw ESLint commands were run. Full workspace build, typecheck, hooks,
staging, commits, push, and release remain root-owned and are not claimed here.
There is no application/visual CLI change requiring a screenshot.

## Exact preserved test names

1. Group E awk separator control: empty program
2. Group E awk separator control: only repeated mixed separators
3. Group E awk separator control: mixed statement and rule separators
4. Group E awk separator control: empty action
5. Group E awk separator control: semicolon remains an empty conditional body
6. Group E awk separator control: literal separators
7. Group E awk separator control: newlines before action and in conditions
8. Group E awk separator control: newlines before function body
9. Group E awk rejects semicolon before BEGIN action before effects
10. Group E awk rejects semicolon before function body before effects
11. Group E awk rejects semicolon before condition expression before effects
12. Group E awk rejects semicolon after condition expression before effects
13. awk rejects unsupported syntax and unknown calls before input and output effects
14. awk loops, recursive functions and regex matching are bounded
15. awk streams one-byte records and composes with sed and existing virtual tools
16. sed cancels blocked stdin without waiting for host cooperation
17. sed cancels blocked stdout without waiting for host cooperation
18. sed cancels blocked stderr without waiting for host cooperation
19. sed cancels blocked loop without waiting for host cooperation
20. awk cancels blocked stdin without waiting for host cooperation
21. awk cancels blocked stdout without waiting for host cooperation
22. awk cancels blocked stderr without waiting for host cooperation
23. awk cancels blocked loop without waiting for host cooperation
24. invalid pattern references fail before in-place effects
25. capture and backreference expansion remains execution-budget bounded
26. file command syntax failure preserves input and existing output
27. read command preserves raw bytes and has bounded append queues
28. getline retains execution and record buffer limits instead of converting them to I/O status
29. getline rejects an empty filename instead of reporting successful EOF
30. getline bounds retained file cursors and close permits reuse
31. getline closes partial files on successful early exit
32. getline cancels blocked host reads and observes their eventual rejection
33. sed l escapes backslashes unambiguously rather than copying BSD's ambiguous literal
34. sed prints and quits before requesting a second producer chunk
35. numeric-plus-global extension retains explicit coverage without a rejecting BSD oracle
36. successful 1q stops the invocation without editing later files
37. successful 1q 0 stops the invocation without editing later files
38. quiet in-place quit truncates only the file explicitly processed
39. separate-file addressing does not turn quit into per-file continuation
40. sed rejects unsupported or malformed programs before stdout, input, backup or file effects
41. sed branch and regex work are budgeted and failed in-place execution preserves originals
42. sed accepts one-byte input chunks and composes with the virtual shell
