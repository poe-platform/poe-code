# Bounded signed hunk-search followup

## Confirmed defect and source-only fix

The warning against `d841ece` was reproduced before editing production source.
The exact repeated `@@ -1 +1 @@` sections from the independent review, including
the prior `first` file section, return virtual status **1** in ordinary and
atomic modes against `old\nold\ntail\n`. Pinned GNU patch 2.8 returns **0**, applies
the second hunk at line 2 with offset 1, and creates the mismatch backup under
its default options. Apple returns **2**, separately recorded, not a GNU oracle.

The same sections against `old\nmiddle\nold\n` must conflict. Before and after
this fix GNU and the ordinary product return **1**, publish the earlier file and
first hunk, and preserve exact `.orig`/`.rej` contents. Atomic returns **1** with
the entire original virtual namespace and metadata unchanged.

`before.json` preserves the first nine literal inputs, source text/hashes, raw
stdout/stderr bytes, statuses, and native/virtual namespace observations.
`before-expanded.json` adds two bounded negative-offset/frozen-boundary controls
without changing those initial inputs. `after.json` repeats all eleven cases.

Commits:

- `bafd1e1`: new regressions and before-fix native evidence only.
- `f93d7f6`: production-only signed-search and associated diagnostics fix.

Production aggregate SHA-256, using sorted path-to-file-SHA-256 JSON:

- Before: `31b08f43832b920df149d5bc78e16a67751dcfcaca99a0c7b0916d08b0c2d06f`.
- After: `7943828f6a3cda1626a0cd6685b4e1950f75b5fae690fa16977b1451a0b8f75d`.

## Matching root cause

The pinned local GNU `patch.c` `locate_hunk` computes signed positive/negative
search bounds from the expected location, input extent, and `last_frozen_line`.
Its initial search distance can be negative when the expected location precedes
frozen input. For this repeated one-line example, expected index 0 and frozen
boundary 1 start at distance -1. That tries the adjacent index 1 before the
zero-offset consumed index 0. If the adjacent line fails, the zero-offset old
line is selected, and application rejects it as misordered before a later
duplicate can be searched. Neither unconditional zero-first matching nor
skipping every consumed match implements this ordering.

The source change preserves that signed distance ordering and directional
bounds for retained nonempty matches. It keeps rejection of the first selected
misordered match. A selected location also updates the carried input offset
before an application conflict, and failure diagnostics use that actual
selected location. The bounded negative-direction control additionally exposed
GNU's literal `offset -1 lines` diagnostic; the product now preserves it rather
than singularizing the absolute offset. No parser rejection, repeated-header
blacklist, filesystem change, recursive pruning, or alias-policy change is used.

The initial case named `negative offset then adjacent` remains unchanged even
though its first hunk chooses the nearest second old line and therefore conflicts;
its name describes adjacent input, not a promised success. The added two-line
consumption controls provide the actual negative-offset adjacent-success and
later-duplicate-conflict pair.

## Native and regression evidence

`native-comparison.json` verifies all eleven fresh ordinary executions against
GNU for exact stdout/stderr bytes, status, and complete typed file namespace.
All eleven atomic executions verify status and either successful publication
or exact original-namespace preservation. Native before/after observations are
stable across the expanded pre-fix and post-fix captures. Fresh post-fix native
fixture executions: **11 GNU + 11 Apple**; initial captures add **20 GNU + 20
Apple**. Version/hash verification is separate from these fixture counts.

The new regression harness initially made an invalid cross-platform stat
comparison: native permission-only mode fields and Darwin directory link counts
are not identical to virtual type-bearing modes and directory link counts.
`harness-initial.json` and `regressions-before.json` preserve that harness and
its **6/22 pass, 16 fail** result. No production source had changed. The corrected
new harness compares native typed paths and all bytes, while independently
asserting virtual metadata preservation from the original virtual snapshot.
It does not relax any pre-existing test. Its qualified before-fix result is
**10/22 pass, 12 fail**; after the source fix it is **22/22**. Raw diagnostics and
both populations are retained; the initial sixteen failures are not presented
as sixteen product bugs.

Native pins (existing local binaries; GNU on Darwin, not GNU/Linux):

- GNU patch **2.8**: `/tmp/safe-bash-gnu-oracle.Yg2F0W/patch-2.8/src/patch`,
  SHA-256 `c060444da0e547de6f17594baf0b5015a04f5b3277131ca12b1da27c621aee00`.
- GNU diff **3.12**: `/tmp/safe-bash-gnu-oracle.Yg2F0W/diffutils-3.12/src/diff`,
  SHA-256 `f13ef516c397b0281818ffe8685aa763100b56a6549295c91849c6af937a83c9`.
- Apple patch: `/usr/bin/patch`, SHA-256
  `ca8aaa5fa4bd9dfaf4b3be251b18372f25f07483946e7d06b505e5a5fb0a6a84`.
- Local GNU `patch.c`: SHA-256
  `ca20b87c33247159560d896283c7ac506f71304bdc3249d9826c8bfb92417106`;
  exact `locate_hunk` excerpt archived in every native capture.

GNU's primary online manual was consulted separately from the execution oracle:
<https://www.gnu.org/software/diffutils/manual/html_node/Merging-with-patch.html>.
No downloads, dependency changes, product subprocesses, or host fallbacks.

## Validation populations

- New bounded regressions: **22/22**, zero skips/cancellations/TODOs.
- Unchanged corrected canonical files: **124/124**, zero skips/cancellations/TODOs.
- Unchanged six matcher/publication/property suites: **164/164**, same exclusions.
- Unchanged historical revised full cohort: **3758/3758**, all **17/17** group
  name/nesting/type censuses identical, zero failures/skips/cancellations/TODOs;
  snapshot inputs unchanged before/after execution.
- Scoped strict TypeScript: exit **0**.
- Root build configuration redirected to this directory's `.build`: exit **0**;
  root `dist` was not written.

`validate.mjs` checks the canonical/matcher test files and emptyfile observer
against their exact `ee4eed6` committed hashes before executing them and checks
their hashes again afterward. None of the existing 124 inputs/assertions or
the prior eight native-backed fixture corrections changed.

The revised-3758 replay uses the exact historical revised snapshot test/helper
bytes, not current canonical tests with their three additional cases. It copies
current source into an owned snapshot, verifies all copied bytes, runs the same
70 files in the same 17 groups, and compares names/nesting/types against the
original census. Tooling remains shared read-only; imported file modules are
restricted to the snapshot/tooling by a new guard. The unchanged benchmark
worker explicitly replaces its execArgv, so that worker does not inherit the
guard; its helper inputs are nevertheless copied and hashed unchanged.

The new replay driver had setup faults, separately preserved:
`acceptance-setup-incident.json` (zero-byte log rejected by copier) and
`acceptance-first-attempt-incident.json` (omitted benchmark helper; oversized
evidence argv). Four partial cohort records remain. A formats execution's
unsaved output was lost when saving failed; it is not counted and is rerun.
The corrected driver sends evidence patches through stdin and captures both
TAP and the unchanged JSON reporter. No acceptance test input or assertion is
changed by these driver corrections. Final replay totals are recorded in
`acceptance-result.json`; the original full historical runner's build/probes
are not claimed as rerun by this test-cohort replay. The final corrected driver
completed all **3758/3758** checks; the initial partial/setup failures remain
separate and are not erased by this result.

Historical populations remain separate: original **121 = 113 pass + 8 fail**;
prior source-only **123 = 115 pass + 8 fail**; corrected **124/124**; literal
original broad **3758 = 3750 pass + 8 fail**; historical revised **3758/3758**.
This task does not rerun or relabel the original eight historical conflicts.
The fresh revised replay never replaces literal-original acceptance.

## Reproduction and limits

From the repository root:

```sh
node --import tsx --test --test-concurrency=1 tests/commands/diff-patch-stress/fuzz/repeated-match.test.ts
node --import tsx tests/commands/diff-patch-stress/evidence/fullgate-51282a9-followup/capture.mjs fresh-label
```

Evidence writers refuse to overwrite existing result JSON. `validate.mjs` and
`acceptance.mjs` show exact commands; use a fresh owned evidence destination for
replays rather than overwriting these records. The revised replay depends on
the existing local historical snapshots and pinned native binaries; it never
installs substitutes or silently falls back to Apple.

This is author-side bounded verification, not independent acceptance, universal
GNU parity, better-than-just-bash proof, a global fullgate, or 72 hours of work.
Independent reviewer files/classifiers and unattributed native artifacts remain
untouched. Root coordinates the different review only after actual author
closure and the metadata author's closure. No watchers or suspended process.
