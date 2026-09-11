# #620: per-operation missing-target canonicalization

## Status and ownership (2026-09-05)

Private TDD candidate only. No live repository, Git, README, registry, build,
full-gate, release or GitHub-post writes/actions. Root owns integration and issue
disposition. Evidence lives in:

`/home/kjopek/kamilio-validation-569-575.RoFXyZ/issue-620-all-paths-candidate.9y8E7a`

All commands used escalated execution, Node v22.22.0 from the supplied toolchain,
home TMPDIR, TSX_DISABLE_CACHE=1, NO_COLOR unset and child GIT_* variables cleared.
No native commands as semantic oracles, large trees, OOM, RSS, timing-performance,
Cloudflare or live-provider probes were run. Existing source copies are private;
only the eight files listed below belong in the proposed patch.

## Validated cause and proposed contract

The existing Bash `canonicalMissing` first tries the complete raw pathname. On
ENOENT it performs lstat, rejects a terminal symlink, recursively tries dirname,
then folds basename back using POSIX join. Recursive copy preflight repeats this
for every entry while destination parents are still absent. This repeats actual
Memory directory lookups, tokenization and path handling, not merely API calls.

Add optional synchronous `FileSystem.canonicalizeMissingTarget(path, options)`:

- A string is the result of the existing raw helper in one owned namespace
  observation, including its unusual opaque suffix folding and exact errors.
- Undefined declines; it is not an ENOENT result. Errors propagate, never become
  decline. The existing asynchronous raw fallback remains unchanged.
- Memory supports all stock guest pathname forms without normalized-only,
  symlink-free or missing-parent-only restrictions. Relative/empty direct calls
  are also covered, although CP normally supplies absolute paths.
- The operation has no await, retained cross-operation state, generation cache,
  or cache shared across preflight/execution. Stock Memory has no asynchronous
  resolver hooks. Explicit enrollment changes internal lookup interleaving into
  one synchronous operation; it does not promise host-wide namespace transactions.
- Cancellation is checked before enrollment and throughout scanning/traversal;
  the Bash caller checks again after return. This is cooperative checking, not
  synchronous timer delivery or arbitrary host-JavaScript preemption.
- Memory declines unowned receivers, proxies, subclasses, replaced root storage,
  and altered/accessor-backed realpath, lstat, resolve, permission, validatePath,
  fail or snapshot implementations. No getter is invoked to qualify those methods.
  This is not a hostile-JavaScript/intrinsic-tampering security boundary.
- Unknown adapters keep the original fallback. Composed adapters must own the
  whole semantic contract before exposing the operation. Quota's generic bound
  method forwarding is explicitly masked. Readonly, mount and overlay already
  omit it; new controls verify all four. No wrapper forwards backend namespace
  authority merely because the backend method exists.

CP uses the optional operation only at the start of each preflight target
canonicalization (including the preserved-link parent). After decline it runs
the complete original helper, without retrying the optional operation for each
parent. Execution and `realpath -m` retain their original helper/realpath paths.
Existing target stat, source identity, copy authority, permissions, capabilities,
cycle checks, depth caps, admission, no-clobber, partial effects and execution
observations are not removed or cached.

## Memory algorithm

The narrow internal helper reads the same Memory node graph and reproduces its
directory/search-permission, component UTF-8 length, symlink and 40-link rules;
ordinary resolver callers are unchanged. Original method guards ensure it cannot
bypass an overridden resolver policy. This is a new read-only traversal, not a
claim that the existing repeated resolver has become cheap by renaming its calls.

Tokenize the original input once with component start offsets. Traverse with
indexed symlink frames and persistent parent positions. Preserve the position
before each original component while resolving its complete symlink expansion.
At the first missing component, discard only that speculative expansion, retain
its original-symlink provenance, and stop namespace traversal. Later original
components remain opaque; do not follow a symlink exposed by cancelling missing/..
or turn an opaque locked/file suffix into EACCES/ENOTDIR.

For a dangling original symlink, replay only the raw dirname boundaries by token
offset to determine whether a queried prefix is bare (lstat sees a symlink) or
trailing-slash-qualified (lstat follows it). Throw the original ENOENT with that
exact prefix, or fold the suffix once over the physical anchor. This preserves
`/dangling/x` failure versus `/dangling//x` success and all 38 frozen outcomes.
Do not normalize before resolving or repeatedly rebuild full prefix strings.

Per-operation tokens, symlink frames, physical positions and final component
storage are temporary. No new budget, lowered limit, quota interpretation or
global cache is introduced. These data structures are not a host-heap bound.

## TDD and corrections (all retained)

- `red.log`: initial 44 tests fail before production changes. Saved source is
  `tests-red-initial.ts` in evidence. Two harness details were then corrected:
  assert non-decline only for successful results, and use suffix depths 2/4/5
  rather than 2/4/6 to keep every generated path within eight components.
- `red-corrected.log`: 44/44 RED with the corrected pre-production test bytes
  retained as `tests-red-corrected.ts`. Actual lookup/scan assertions fail with
  unchanged baseline work, in addition to missing-operation assertions.
- `green-first.log`: first candidate 44/44 PASS.
- `cp-first.log`: first CP cohort 10/10 PASS, including the five preserved
  dynamic-policy/fresh-observation controls from the rejected caching proposal.
- `extended-first.log`: 56 PASS / 1 RED. Empty direct input under a non-searchable
  root reported realpath '' rather than the fallback's realpath '.'. Preserve
  `memory-before-empty-path-correction.ts`; translate only empty input to '.'
  at the owned operation entry after the existing validation rule.
- `green-corrected.log`: 57/57 PASS after that diagnostic correction.
- `cp-baseline-red.log`: exact current baseline replay after implementation,
  2/2 performance RED (24 calls / 84 pathname bytes). This is not mislabeled as
  a new pre-implementation run; earlier RED controls preceded production changes.
- `cp-baseline-compatibility.log`: all five original fresh-observation/refusal/
  cancellation controls still pass against the baseline.
- `green-final.log`: all 61 current candidate tests PASS, no skipped cases.
  The separately logged run with 59 tests predates the final scan-cancellation
  and owned dangling-boundary controls; it is not the final denominator.
- `reference-compare.json`: all 38 exact values/errors match both AST-extracted
  frozen helper declarations and the original authenticated reference JSON.
- `adjacent-first.log`: 16 selected existing Bash tests PASS; no broad suite.
  An initial copy command named nonexistent helpers.test.ts; its error remains
  in `adjacent-copy.log`. helpers.ts was copied explicitly before this run.
- `semantics-candidate.json`: all 12 original tiny Shell controls PASS on private
  source: physical/default/logical links, alias descendants, cycle partial copy,
  dangling destination, permissions, preflight/execution mutation, sibling aliases,
  capability refusal and falsey cancellation with no later calls/writes.
- `fs-adjacent.log`: 40 tests PASS in the three existing SafeFS quota-hardlinks,
  command-capabilities and portable-path files; no native/live-provider oracle.
- `types-actual-options.log`: TypeScript 5.9.3, zero diagnostics for both focused
  package-root programs and their import closures. Actual package options are
  loaded, not approximated; only noEmit, no incremental state, focused roots and
  relocation of SafeFS rootDir differ. Source sets are 199/260 including library
  declarations. Assertions exclude accidental live SafeFS/Bash source resolution.

## Deterministic work evidence

The observer counts actual directory Map.get calls on owned Memory maps. Scan
volume counts input UTF-16 units of the original resolver's actual split('/')
calls, versus tokenizer charCodeAt calls in the candidate, including symlink
targets. This measures eliminated repeated scan inputs plus executed candidate
character inspections, not native-engine instructions, elapsed CPU or heap.
The counters do not replace resolver methods, so Memory does not decline them.
Other validation, string copying and path-building work is not counted as zero.

For suffix depths 2 / 4 / 5 (each fixture 15 nodes, paths at most 8 components):

| Family | Baseline lookups | Candidate lookups | Baseline scan units | Candidate scan units |
| --- | --- | --- | --- | --- |
| Plain missing | 6 / 10 / 12 | 1 / 1 / 1 | 61 / 121 / 157 | 12 / 16 / 18 |
| Symlink chain | 34 / 54 / 64 | 5 / 5 / 5 | 183 / 311 / 381 | 29 / 33 / 35 |
| Repeated slash/dot | 27 / 43 / 51 | 4 / 4 / 4 | 180 / 304 / 372 | 30 / 34 / 36 |
| Missing/../symlink | 10 / 14 / 16 | 1 / 1 / 1 | 219 / 359 / 435 | 32 / 36 / 38 |
| Dangling slash fold | 12 / 20 / 24 | 2 / 2 / 2 | 103 / 191 / 241 | 19 / 23 / 25 |
| Dangling prefix error | 11 / 19 / 23 | 2 / 2 / 2 | 91 / 175 / 223 | 18 / 22 / 24 |

For the four-entry CP tree, preflight target canonicalization goes from 24 raw
realpath/lstat calls and 84 input pathname bytes to 4 owned operation calls and
20 input bytes. An explicitly enrolled truthful observation wrapper binds the
operation to the intact underlying Memory; it does not forge Memory ownership.
All 20 measured execution realpath/lstat observations and all 4 writes remain.
The internal work controls above establish more than this API-count reduction.

Additional ordinary controls cover 22 relative/slash/Unicode/empty/permission/
name-length cases and 48 fixed prefix/suffix combinations. The UTF-8 name-length
boundary uses 128 é characters (256 bytes), not a large generated fixture.

## Scope and limits

Modified existing files:

1. `packages/safe-fs/src/contracts/filesystem.ts`
2. `packages/safe-fs/src/fs/memory/index.ts`
3. `packages/safe-fs/src/fs/quota/index.ts`
4. `packages/safe-bash/src/commands/filesystem.ts`

New files (root must register the two test paths literally):

5. `packages/safe-fs/src/fs/memory/missing-target.ts`
6. `packages/safe-bash/tests/contracts/missing-target.test.ts`
7. `packages/safe-bash/tests/commands/copy-preflight-canonicalization.test.ts`
8. `docs/plans/bugfix-620-missing-target-canonicalization.md`

Baseline SHA-256 values:

- FS contract: `34a01b937a3b885a52bea3366be198ae717b1ef5b683d968694ac61a419356ef`
- Memory: `a93982e56baf3c4bf84dcb8d29b43e0ae6c2ae6ef4e4c35810a53f455a3bb099`
- Quota: `8564f7b3010a753ca3e6562a585de864907278198c7badd2985c0805ca9cbd82`
- Bash filesystem: `2761f5dec82a2de336d543b2fd0f9cef211894a26039bad25fb0ddef6c9bcc03`

The final handoff manifest authenticates candidate bytes, patch and evidence.
Old #617 candidate SHA remains
`d813645039c451b2ef3894cc343f4fcfdc6a477a6e6db06ca4d07fd68a6c64fd`;
the rejected #620 evidence-only patch remains
`0f0dc969626a17249099277cb55ad5b6d9a0cebcd941c134dae58447b7d775ec`.
The preserved 38-result reference SHA is
`6ce5fc920bfb074fbcdaedd0e71a9ef66072b5a52094dba41e317914cb807f6b`.

This removes the redundant missing-parent walks on stock Memory for the tested
path families without guest-syntax fallback. It is not an overall linear-copy
claim: each entry still supplies/builds full paths; source resolution, existing
target checks, execution, output/path bytes and symlink expansion still cost work.
Summed full-path lengths can remain quadratic in a chain. Unknown/modified hosts
and masked compositions keep the legacy overhead. Thus broader all-adapter/total
CPU allegations are not declared solved. No original wall-time/RSS/OOM/Cloudflare
number, fatal-error claim or arbitrary-host preemption guarantee is validated.

## Independent relative-ancestor correction (September 5, 2026)

The original private candidate and independent RED evidence remain immutable:
`/home/kjopek/kamilio-validation-569-575.RoFXyZ/issue-620-all-paths-candidate.9y8E7a/`
and `/home/kjopek/kamilio-validation-569-575.RoFXyZ/620-independent.fVGgH5/`.
The original candidate patch SHA256 is
`5e0a7b7ce1963f53e766bc63f7c3fa15cb5265c610ddf01d74442d071951425d`.

Independent comparison of 1,366 raw paths against AST-extracted, authenticated
legacy `maybeStat`/`canonicalMissing` found 85 relative-path discrepancies and no
discrepancies among 754 absolute paths. With `/x` pointing to missing `/absent`,
`x/m`, `x/.`, and `x/..` incorrectly succeeded instead of preserving ENOENT at
raw path `x`. The ancestor boundary code treated a one-character relative name
like a rooted separator special case.

The separate correction candidate is
`/home/kjopek/kamilio-validation-569-575.RoFXyZ/620-relative-fix.ytmuhp/`.
It changes only the rootedness condition in `missing-target.ts`, adds ten small
relative-ancestor controls to `missing-target.test.ts`, and appends this note.
The corrected production file SHA256 is
`4215b6a94c63e6aedb0747f0010f3d315fecd112bf35ea726820168d1471b4d4`.

- `evidence/relative-red.log`: three minimal regressions fail; seven neighboring
  separator/ancestor controls pass before the production correction.
- `evidence/relative-green-all.log`: all 61 existing candidate tests plus ten new
  controls pass (71 total, no skips).
- `evidence/corpus-green.log`: the identical 1,366-path corpus has zero
  discrepancies in values and exact error details; depth at most four and at
  most 15 nodes per fixture. Captured dependencies and the actual old helper are
  authenticated, not replaced with a guessed oracle.
- `evidence/minimal-green.log`: all ten three-node controls match, including
  `x//m`, `/x/m`, `//x/m`, `xx/m`, and `./x/m`. Custom-method fallback and falsey
  cancellation controls also remain passing.
- `evidence/reference-38-green.log`: all 38 preserved frozen results/errors
  still match exactly, using the existing authenticated extraction driver.
- `evidence/types-actual-options.log`: both scoped SafeFS and Safe Bash checks
  report zero diagnostics with actual package options and no emit; these are
  not full repository gates.

No callback-return hardening is included: null/non-string returns violate the
proposed synchronous string-or-undefined host contract and were not observed
from stock Memory. The correction does not change absolute CP behavior, fallback
policy, or documented resource qualifications. Private incremental and combined
patches are replay-checked; root still owns live integration and delivery.
No live checkout, original candidate, #631 candidate, Git, or release was changed.

## Root integration validation (September 5, 2026)

Root authenticated the four existing input files against the original handoff,
then replayed the corrected eight-file patch exactly. The two new canonical test
files first produced 65 failures and six passes against the built baseline.
Both test paths are registered literally in `integration-inputs.test.mjs`.

An initial post-patch run still loaded stale `poe-code/safe-fs` build exports and
reported 64 failures among 219 tests. That log is retained, not reclassified as a
passing run. After the normal `npm run build` refreshed the public export graph,
the identical 219-test copy/filesystem selection passes without skipped cases.
Discovery registration passes all 98 tests, and the complete SafeFS test directory
passes all 1,144 tests across 50 files.

Root evidence is in
`/home/kjopek/kamilio-validation-569-575.RoFXyZ/issue-620-delivery.bSiFMa/`.
This is local integration evidence, not a full maintained gate, remote delivery,
or publication claim. The separately detected #633 lifecycle regressions remain
under correction before the next full gate. Upstream integration is awaiting
permission; no denied merge was retried.
