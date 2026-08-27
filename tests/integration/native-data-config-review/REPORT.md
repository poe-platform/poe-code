# Independent native-data configuration review

## Verdict and immutable target

**PASS for this bounded configuration change; live global typing remains FAILED.**
No functional defect was found in the authorized exclusion or default runner
filter. This is not release, lifecycle, full-package or superiority acceptance.

Candidate `78e80717b9791a4bc5f49005b962b1da9232335d`, tree
`50e1de0655fb89515ef6ff82fe4060d4d1d2f7f4`, source tree
`a488ed60bb1c28e2ec552fba231ad58d0736c662`; parent
`f6406cdc1d946bbe829535d888d6e8a09a7c8d9e`. Candidate identity never follows HEAD.
`CRITERIA.md` froze independent intentions, six path/hash pins and both config
identities before reading the author implementation or requested handoffs.
Its SHA-256 is `658d60cf955f63746b05dae878e0ff47451eb1240f58c074e63b2007092752f6`.
No delegation or other reviewers' holdout-body inspection was used.

Final isolated execution: August 27, 2026, 08:59:34.760–09:00:20.276 UTC;
Node v22.22.2, TypeScript 5.9.3, npm 10.9.7, Darwin arm64. Eleven independent
control groups pass, without skipped/TODO outcomes (`results.json`). The runner
contains six small positive tests plus two independent throwing/marker canaries,
not the author's five tests or the current-release corpus.

## Exact diff and authenticated classification

`candidate.diff` shows one added root-config exclusion, exactly
`tests/commands/regex-execution/continuation/artifacts/native`; the package's
actual `test` script prunes that exact directory while keeping the previous
`tests/**/*.test.ts` pattern. The only other changed paths are narrow README/
ledger text and new author-owned evidence/control files. Structural comparison
proves every compiler option, existing exclusion, package field other than
`scripts.test`, dependency, export and build config is unchanged. No lifecycle
hooks are present for the executed package test/typecheck commands.

`classification.json` independently accounts for **72/72 files**:

- **22 raw payloads**: exact producer `dialect.mjs` fixture member sets match all
  ten actual dialect directories bijectively, with every file exactly `hit\n`.
  Producer source and recorded fixture cases agree and are hash-bound.
- **50 generated tsx transform caches**: JSON code/warnings/source-map schema,
  version-3 maps and source-content associations point outside the data subtree.
  These are generated cache records, not maintained source/test/helper programs.
  Classification does not assume that a `.ts` extension means source, or that
  a cache's transformed source must equal a subsequently edited live source.
- **6/6 pinned raw TS files**: the paths in `CRITERIA.md` all retain four bytes and
  SHA-256 `74a02f560cc1d8e023280b5f08a1ee7266e4bec6cea61ca457dc1a758d080fc8`.
  Git ignores them; the candidate archive contains none of this subtree.

All 72 actual files were copied, authenticated and chmod 0444 only in the owned
isolated candidate. The original namespace received no canaries, deletions,
rewrites or mode changes. All 72 original and copied hashes remain equal before/
after; source/config/producer/author/harness hashes are retained. All 704 existing
rootdist file hashes remain unchanged across the final isolated run. No root
build emitted files, package/dependency installation or product source execution occurred.

## Compiler controls and eligibility

The corrected archive includes genuine imported benchmark helpers as well as
candidate source/tests/configs. The same authenticated data and source are used
with the parent and candidate configs; only the copied config changes.

| Actual control | Result |
| --- | --- |
| Parent config CLI `tsc --noEmit --incremental false --pretty false` | Exit 2; exactly six TS2304 `Cannot find name 'hit'.`, each (1,1) |
| Candidate config, identical inputs | Exit 0; zero diagnostics; only those six source files leave the program |
| Candidate build config `-p tsconfig.build.json --noEmit --incremental false` | Exit 0; no `dist` created in the copy |
| Six genuine undefined symbols outside exact exclusion | Exit 2; each exact target path gets TS2304 at (1,1), with no blanket nonzero-as-proof |
| Explicit import of excluded `alpha.ts` | Its exact TS2304 reappears; exclusion is automatic discovery, not diagnostic suppression |

The outside negatives cover production source, canonical test, imported-helper
location, neighboring artifact, `native-sibling` and `native space 🙂` directories.
Full file-list equality before/after, except the six raw files, preserves every
previously eligible candidate source/test/helper, including genuine benchmark
imports. Named real controls include `src/index.ts`, continuation `glob.test.ts`
and the author's `helpers.ts` (`candidate-canonical.json`, compiler JSON records).

**Immutable candidate census:** 1,638 program files = 176 production + 1,289
test-tree + 173 other (six imported benchmark TS helpers and 167 library/type
files). **535/535 tracked `.test.ts` and 535/535 discovered tests remain included.**
These are not 1,638 tests, nor an all-TypeScript coverage assertion. The test tree
includes archived programs. Full per-file hashes are in
`candidate-compiler-inputs.json`; root and program file lists are retained.

## Actual default runner controls

`npm test` uses byte-identical candidate `package.json` in a separate owned
fixture tree, not a string-only assertion or simulated discovery wrapper.

- Candidate: **6/6 positive tests pass**, imported helper executes, no native
  marker appears. Direct `native/arbitrary.test.ts` and nested Unicode/space
  `native/space 🙂/nested arbitrary.test.ts` do not select/execute.
- Positive boundaries include neighboring artifacts, `native-sibling`,
  `native space 🙂`, sibling `native.test.ts`, and a canonical Unicode/space path.
- Parent script mutation: **6 pass / 2 fail**, exit 1; both forbidden canaries
  actually append their path markers and throw the independent canary message.
- Native-only selection plus an unrelated root `fallback.test.js`: exit 1,
  `No test files found`; no TAP run or fallback/canary execution. No bare-runner
  fallback or broad prefix filter is hidden by the setup.

`runner-input-freeze.json` binds fixture contents before execution; package
restoration and final fixture hashes are checked. `TSX_DISABLE_CACHE=1` avoids
new host caches, and child `NODE_TEST_CONTEXT` is explicitly cleared. No full
root `npm test`, benchmark runtime, native/pack corpus or release replay ran.

## Live evidence is separate, still failed

The first read-only live CLI run returned **ten foreign errors**: the existing
eight filesystem-inspection sealed-input TS2307/TS7006, plus
`tests/integration/adapter-tools/atomic-webdav-profile/controls.ts` TS2307 at
(8,25), missing `../../fs/webdav/mock.js`, and TS7006 at (39,41), untyped `request`.
No native error remained. Exact commands/output and input hashes are in
`attempt-01/live-global-noemit.json` and neighboring snapshots. These new two
errors were routed to root before correction; this leaf changed none of them.

The second run returned the original **eight errors**, but correctly failed
its wrapper stability assertion when that foreign `controls.ts` changed from
`d0e0fe79ab9b5f26cf8b50af995755dc05113af4c66c7f2bd8ed4e6d15554bdb` to
`67fbeed3ae12b1c2cc4ecdcc0e9060895f8ca1d5a466086cb1526922fa04e5b8`.
The improvement belongs to those foreign working-tree bytes, not the config
patch. It is a raced capture, not frozen matched-input success. Nothing was
excluded or waived to hide the remaining eight. No third global gate was run
while waiting on foreign fixes (`attempt-02/`, `HARNESS-CORRECTION.md`).

Latest read-only **census, not semantic gate**, at 09:01:27.917–09:01:30.732 UTC:
HEAD `c7e71455051f95989fa1cea387821324afa1f96c`, source tree
`67da7e232729bb75fc3313f80d644112558dc1fa`, stable HEAD/source/config bytes.
**3,950 program files = 176 production + 3,539 test-tree + 235 other** (six
benchmark helpers, 62 imported existing rootdist declarations, 167 library/type
files). **544/544 discovered and 537/537 tracked tests remain included.**
Seven extra discovered paths are six pre-existing ignored copies and one new
foreign untracked `tests/commands/file/text-bound.test.ts`. The two tracked
additions since the candidate are ISO-year and tree-work-budget tests.
`final-census.json` records every path/hash and proves live parent/candidate root
discovery differs only by the six raw TS files. Owned hidden scratch contributes
zero compiler files. Source changes after the candidate belong to `c7823633...`
(date) and `dff53c46...` (tree), not this review or the native config patch.

## Retained failures and unavailable limits

`attempt-01/` preserves the original independent fixture freeze and harness.
Its archive omitted imported benchmark helpers, causing 24 artificial candidate
errors (30 with parent config). Those are **harness faults**, not product bugs,
not accepted candidate-global evidence, and not silently dropped. Only the
owned archive harness was corrected; fixture intentions and raw bytes did not
change. `attempt-02/` preserves the subsequent foreign-input race. Final tested
harness SHA-256: `09c014fa17c507891074fa2c0570f1e3392d6433fdb9f3b4d8129560af18075d`.

The final command was `node tests/integration/native-data-config-review/review.mjs
--isolated-only`; `seal.mjs` supplies the final census. This run intentionally
retains its scratch tree and evidence. Replaying the harness requires a fresh
owned destination/scratch identity; do not overwrite preserved runs or original
data. Native behavior, deployed providers, comparator performance and broad
release/runtime checks were neither executed nor inferred here.

Dirac `aac345a0` 470/470 + 485/485 remains historical and separate from standalone
`.mts` 11/30 omissions and current-release 22 maintained inputs/13 groups.
Public `65b7ae`/`66b079a` scoped passes do not close frozen `02`/`c652d99` WebDAV
12/13 release failure. Runtime 1b/Sagan build success is not lifecycle acceptance;
Arch's five cleanup cases remain open. The broader user goal remains active;
there is no all-TS, whole-product, superiority or 72-hour-completion claim.
