# csvcut engine accounting QA

Scope: the existing engine-csvcut candidate plus immutable quota observations
and byte admission that ignores producer-defined length properties.
Use the selected csvkit 2.2.0 / agate 1.14.2 / Python 3.9 comparison identity;
strict-v1 remains an explicitly documented isolation deviation. This procedure
does not qualify the later CLI behavior or wiring tasks.

1. Run the original memory-only quota-observation regression before changing
   the ledger. Verify it fails because `Reflect.set` resets the exposed input
   counter. Then run it after implementation and verify mutation is denied,
   another charge fails with `LIMIT`, and disposal preserves earlier snapshots.
   Before the byte-admission fix, run the independent two-byte chunk/one-byte
   limit control with a shadowed zero length and verify the missing `LIMIT`
   failure. After implementation, verify actual length controls admission and
   producer accessors are never called.
2. Execute the built csvcut SDK with a memory producer yielding one byte at a
   time: initial BOM, CRLF header with trailing empty cell, quoted multiline UTF-8
   cell and doubled quotes. Compare literal records and physical parser lines.
   Confirm cleanup runs once. Run malformed quote closure as a negative control
   and verify structured `INPUT` plus producer retirement.
   In the installed consumer, pre-abort with a falsey reason and confirm the
   producer capability is never called. Set `PYTHONIOENCODING=latin-1` for a
   separate UTF-8-sig fixture and verify it still returns literal `é`.
3. Run the maintained shared-engine, csvcut, csvgrep and csvsort workspace tests
   and engine/csvcut lint routes. Verify every-byte-split, selectors, independent
   budget axes, falsey cancellation and rejected-read retirement controls.
4. Run the maintained isolated packaging and private-bundle controls. Verify
   runtime execution and strict declaration resolution after removing private
   workspaces, including the Buffer-free realm. This is memory-artifact evidence,
   not an npm-install or browser/workerd qualification.
   Additionally stage the three public libraries with `scripts/package-safe.mjs`,
   pack them with scripts disabled and install offline into a fresh consumer
   outside the checkout. Run the maintained private-command runtime fixture and
   csvcut strict NodeNext type fixture there; verify no private workspace is
   installed and quota observations remain immutable through the public subpath.
5. Because the ledger is shared, complete repository build, npm test and root
   lint. Record incomplete routes and skips separately. Do not replace a failed
   broad gate with a focused pass.

No CLI rendering changes occur in this increment; screenshots and CLI/SDK command
parity are not applicable until command behavior is integrated. Native oracle,
actual browser/workerd, checkpoint/replay and performance measurements are not
qualified by this procedure. No publication or release is part of this task.

Temporary logs use ignored `out/engine-csvcut` because `/out` is read-only on
this host. Purge task-owned logs after recording results.

## Execution receipt, 2026-09-20

Working-tree candidate based on `ab1fa8d34101e1e7f61272973f3bc28a842043d8`;
unrelated edits preserved. This increment adds the original quota-observation
regression and replaces mutable public counters with immutable snapshots of
the private ledger. The requested package-pattern path is deleted in the
supplied tree; its archived successor was used without restoring that deletion.
Pandoc's decoded AST reader and table-text helpers were inspected. XAN admission
declarations were inspected; held source was neither read nor imported.

The original regression failed with `true !== false` at the mutation assertion,
then passed after implementation. Initial focused tests passed: shared engine 23,
csvcut 11, csvgrep 55 and csvsort 21; none skipped. Engine and csvcut workspace
lint/typechecks passed. Maintained packaging/private-bundle tests passed all
158 controls, including strict declaration and Buffer-free realm checks. Built
SDK manual controls passed multiline/chunk parsing, malformed-input cleanup
and quota rejection. These are deterministic checks, not performance evidence.

The three public libraries were staged at `0.0.0-engine-csvcut`, packed with
scripts disabled and installed offline into a fresh `/tmp` consumer outside
the checkout. The maintained private-command runtime fixture and strict
NodeNext csvcut declaration consumer passed, with exact optional properties
and unchecked indexed access enabled. No private CSV command/engine/contracts
package was installed. Public quota mutation, pre-abort authority denial and
conflicting-host-encoding negative controls passed; csvcut and csvgrep retained
one shared error constructor. A falsey pre-abort reason propagated without
calling the producer, and `PYTHONIOENCODING=latin-1` did not change UTF-8-sig
decoding. No package was
published. Actual public tarball SHA256 identities:

| Artifact | SHA256 |
| --- | --- |
| SafeFS | `722d49c8e24bc7c0bf8caedc80bda8c0355356626239ea9fbf61a4fc04cb4e13` |
| SafeJS | `9221a19956cd420c7e4626a8ce6c54fc45466b5c357d1309e2beb4d83e925821` |
| SafeBash | `8dd067bbceca2b48c19079ebdfd7afc2952c0d9648f112a491714086fa14cff6` |

Initial runtime engine source identities:

| Source | SHA256 |
| --- | --- |
| shared `src/index.ts` | `93a8a6be2fe1fbb0109747786e8a1ad22bddb55d5c7785e24003df7af52ad64c` |
| csvcut `src/engine.ts` | `00f4e204d197257a37c1b121c8d984672b5fa6ecc0bb873d5ebc010927075071` |
| csvcut `src/index.ts` | `d7828cae0402935c791b8195cc3f72c2d193dcb436efb8c2d03dd3060136dd93` |

Repository `npm run build`, root type lint, workflow lint and package policy
checks passed. The first guarded repository ESLint run remains incomplete:
16,135 configured subjects were linted with zero errors and four warnings, but
the guard detected checkout-root directory size drift (1408 to 1376) during
the concurrent build, which removes/recreates root `dist`. No guard policy or
assertion was weakened; a stable-filesystem full lint retry is required.

The broader safe-bash workspace typecheck failed with exit 2 before source or
consumer checks. Its canonical peer admission requires root
`poe-code.exports["./safe-fs"].import` to equal
`./packages/safe-js/dist/safe-fs.js`; the current root manifest has no such export.
The assertion is in `tests/plugins/qualified-current-release/peer.mjs:245`.
This increment does not rewrite unrelated publication metadata or bypass the
admission check. Broader safe-bash type acceptance remains unresolved.

The initial full repository test route was intentionally interrupted with SIGINT
after validating the byte-admission defect. It exited 1, reporting the deliberate
interrupt and an `EPERM` during the runner's process-group existence/cleanup
probe (`scripts/build-workspaces.mjs:450`). This is an incomplete run, not a
test pass or a clean runner-cancellation qualification. A fresh full route runs
against the rebuilt final candidate. The byte-admission original regression
failed with “Missing expected exception”: a two-byte chunk shadowing its length
as zero incorrectly passed a one-byte limit. The fix captures the typed-array
intrinsic getter, accounts the actual view length and returns structured `INPUT`
for invalid byte chunks. Final shared-engine tests pass all 24 controls,
including both data-property and accessor negative cases. Final engine lint
and packaging/private-bundle controls (158) pass independently.

Final rebuilt csvcut/csvgrep/csvsort tests and csvcut lint passed (11/55/21
tests respectively, no skips). The rebuilt parser's manual positive accessor
control and invalid-byte-type controls passed. Final public tarballs were
regenerated at `0.0.0-engine-csvcut-r2` and installed offline into another fresh
external consumer. Its maintained runtime fixture and strict NodeNext types
passed. Additional installed controls passed for actual byte admission at and
over the limit, no accessor invocation, quota snapshots, falsey pre-abort,
host encoding and producer retirement on a shadowed-length quota failure.
These final artifacts supersede the initial cohort for byte-admission coverage:

| Final artifact | SHA256 |
| --- | --- |
| SafeFS | `2a7cfa907daf3847adcec3520e8a4ed7869f05a875ca57662e0920ff5652e33f` |
| SafeJS | `6352162858b1460cbbae0f675853666654fd692ad64196dc635e2d9ec0c8c594` |
| SafeBash | `46c8d16696d2fd10f69d96e5cfaa571fe63785500431ba6a89cec9fcefaf0c79` |

Final shared engine `src/index.ts` SHA256:
`bfb710ddffb6cd7463ab024127e109c1c1f35e4d6ead33de068ef9b8a1c7e5a3`.
Final original regression source `src/contracts.test.ts` SHA256:
`256fa4f3a616064467303ef58ebc0465d3799423be2b765e5cacde9a694d6d1c`.
Csvcut runtime source identities remain those in the initial table.
The normal final `npm run build` completed with exit 0 and all root suffix
stages. It used the maintained shared machine cache; no uncached qualification
is claimed. Workspaces without declared builds remain marked not a pass.

Completed final repository test and stable-filesystem lint results are below;
focused passes do not count as completion of those routes. No native upstream
oracle, Bun, actual browser/workerd, checkpoint/replay or bounded performance
measurement was run. CLI behavior/wiring and full Python compatibility remain
subsequent acceptance work. Local commits: none. Verified remote-main delivery:
none. Successful releases: none.

## Completed final gates

The fresh final `npm test` route completed with exit 0, including declared
workspace build/test dependencies, native npm pre/event/post scripts and root
posttest's two lint-stress controls. Its maintained declaration-based planner
reported no excluded tasks. This used the shared machine cache, not explicit
`--no-cache` verification. Cache reuse came from the maintained workspace routes;
no fixed-count or root-plus-shell replacement was used. CSV workspace tasks ran
through their declared node:test routes against the final source. Safe Bash
reported 41,909 passes, 829 skips and zero failures plus all 563 runner controls
passing. SafeJS reported 31,121 passes, 48 skips and zero failures (three skipped
files); Safe Python reported 84,595 passes; Safe Playwright 34; Terminal Pilot
293. Skips, unavailable comparators, workspaces without declared unit/build tasks
and manifestless directories are not counted as passes. Informational archived
native differences remain differences, not compatibility successes.

The stable-filesystem full `npm run lint` retry completed with exit 0, including
root type contracts and workflow lint. Its ESLint guard reported complete=true,
16,135 configured/linted subjects, zero errors, four warnings and no gaps.
This completed broad retry supersedes the incomplete concurrent-build lint run
for the final gate; that original incomplete result remains recorded above.
`git diff --check` passed. No assertions, deadlines, tests or guard policies were
relaxed. Main remained the working branch; unrelated edits were preserved.

The final broader safe-bash workspace typecheck still exits 2 at the same missing
root public SafeFS export admission, before source/current-consumer checks.
The standalone installed csvcut strict declarations pass independently; broader
safe-bash type acceptance remains unresolved. Both public artifact cohorts and
their external consumers were task-owned manual evidence and are purged after
recording these results. No native CSV runtime, actual browser/workerd/Bun,
checkpoint/replay for a csvcut command or performance qualification is claimed.
No visible CLI change occurred, so screenshots are not applicable. This remains
the engine increment; later CLI grammar, projection and wiring are not certified.
Local commits: none. Verified remote-main delivery: none. Successful releases:
none. No publication was attempted.
