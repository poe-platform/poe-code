# Independent GNU-target classification — August 26, 2026

## Decision and denominator

**Exactly 30 frozen failing tests: 14 genuine GNU compatibility defects and
16 failed native-control assertions.** No test is skipped, marked unsupported,
converted to a profile exception, or removed from the historical denominator.
The unchanged frozen matrix remains **2,909 pass / 30 fail / 2,939 total**.
This classification is not a new all-suite pass claim.
The fourteen product-bearing failed tests cover **three source defect families**,
not fourteen independently distinct bugs.

The authoritative target is pinned **GNU Diffutils 3.12 / GNU patch 2.8**.
Apple evidence stays intact as alternate implementation evidence, not a veto
over GNU product expectations. A valid GNU-generated patch rejected by GNU
patch itself is distinguished from a product producing the wrong GNU result.

| Class | Count | Disposition |
| --- | ---: | --- |
| Repeated context selectors | 12 | Real GNU diff option defects; product gate must fail until fixed |
| Literal empty-range reverse and asymmetric boundary | 2 | Real GNU patch semantic defects; product gate must fail until fixed |
| GNU context-zero native-native controls | 6 | GNU patch rejects GNU diff output; retain raw failure and calibrated outcome |
| Apple reverse fallback gates | 5 | Apple returns success with wrong original bytes; not a product defect |
| Parser-native assertions | 5 | Four native grammar rejections plus one bounded native timeout; product checks pass |
| **Total** | **30** | **14 product defects + 16 native-control failures** |

## Exact individual failing names

The ordinal is the original TAP test number, not a replacement test number.
Compatibility and fuzz raw output share `compatibility.stdout`, but their suite
denominators remain separate. All names are copied into `evidence.json.failures`.

### Real GNU selector defects — 12

| Suite / ordinal | Exact failing name |
| --- | --- |
| compatibility / 1 | `golden diff flags: short explicit context then short format` |
| compatibility / 2 | `native diff flags: short explicit context then short format` |
| compatibility / 3 | `golden diff flags: short explicit context then long format` |
| compatibility / 4 | `native diff flags: short explicit context then long format` |
| compatibility / 5 | `golden diff flags: long explicit context then grouped format` |
| compatibility / 6 | `native diff flags: long explicit context then grouped format` |
| compatibility / 7 | `golden diff flags: format then explicit context control` |
| compatibility / 8 | `native diff flags: format then explicit context control` |
| compatibility / 110 | `Shell+Memory repeated format options retain GNU maximum context` |
| formats / 45 | `option interactions -C0 -c/labels=false` |
| formats / 46 | `option interactions -C0 -c/labels=true` |
| formats / 858 | `GNU selector regression: -C0 followed by -c resets to three lines` |

The first eight tests cover `-U0 -u`, `-U0 --unified`, `--unified=1 -ru`,
and `-u -U 0`, each with a golden and live-native assertion. The Shell case
uses `diff -U0 -u -L target -L target left right >changes`. The formats cases
use `-C0 -c`, with both label forms and an independent golden.

GNU takes the **maximum requested width**, with bare `-u`/`-c`/long aliases
contributing three. It is neither last-option-wins nor an unconditional reset
to three: the added `-U5 -U1` control remains five, and `-C5 -c` remains five.
A lone `-U0` remains zero. The frozen `diff.ts` overwrites explicit widths and
does not contribute three on bare selectors. Source proof: pinned `diff.c`
lines 368–395 and 554–557. Apple produces a different selector result; that
does not waive these GNU-target defects. Preserve exact golden/stdout tests.

### Real GNU patch semantic defects — 2

| Suite / ordinal | Exact failing name |
| --- | --- |
| fuzz / 31 | `GAP-01 raw selected-oracle Apple-range compatibility reverse` |
| fuzz / 33 | `GNU boundary anchoring: asymmetric non-EOF rejection` |

1. For `@@ -1 +1,0 @@` deleting `a`, reverse application to `b\n` produces
   **`b\na\n` in GNU**, versus **`a\nb\n` in frozen product and Apple**.
   Canonical `@@ -1 +0,0 @@` reverses to `a\nb\n` in GNU and product.
   The frozen parser rewrites first-hunk zero-count start `1` to `0` in
   `unified.ts:77`, erasing literal GNU coordinates. Fix parsing and any
   overstrict coordinate-continuity assumption; merely swapping expected
   output or declaring the literal GNU input unsupported is incorrect.
   The old passing `GAP-01 legacy Apple-range product contract reverse` will
   conflict with the corrected default: change its product expectation to
   GNU while retaining a separately asserted Apple-native observation.
2. With `-F0`, the hunk ` head\n-old\n+new\n` at `@@ -1,2 +1,2 @@`
   has leading but no trailing context. Against `prefix\nhead\nold\ntail\n`,
   GNU returns **1 and leaves target bytes unchanged**; frozen product returns
   **0 and changes `old` to `new`**. EOF and symmetric displaced positive
   controls both succeed. Pinned `patch.c:1153` computes prefix/suffix fuzz
   relative to their maximum; negative suffix fuzz restricts matching to EOF.
   Frozen `applyHunks` instead scans arbitrary matching positions. Test the
   BOF counterpart, reverse, offset carry, and fuzz levels around the boundary
   when fixing; retain this negative test as a failing GNU product gate.

### GNU native-native context-zero failures — 6

| Suite / ordinal | Exact failing name |
| --- | --- |
| formats / 243 | `native-native control context/delete-3/C0` |
| formats / 435 | `native-native control context/delete-7/C0` |
| formats / 627 | `native-native control context/delete-11/C0` |
| formats / 777 | `native-native control context/repeated-alignment-0/C0` |
| formats / 819 | `native-native control context/repeated-alignment-7/C0` |
| formats / 843 | `native-native control context/repeated-alignment-11/C0` |

For **every one of these six fixtures**, the independently rerun frozen product
diff is **byte-identical to GNU diff**. GNU patch returns **2 in both forward
and reverse directions** for both generated patches, reporting mangled
replacement text/line numbers. Frozen product patch reconstructs both expected
file versions. The omitted empty-side context-range handling in pinned
`pch.c:1547`–1593 rejects the native producer's output.

These are valid native-producer outputs with a pinned native-consumer defect,
not product formatter defects and not unsupported formats. No failing fixture
here relies on a different product edit alignment. Other ambiguous edit
alignments must still be validated semantically rather than rejected solely
for different bytes; that principle is not needed to excuse these six exact
GNU-output matches.

### Apple-only reverse corruption gates — 5

| Suite / ordinal | Exact failing name |
| --- | --- |
| formats / 244 | `independent formatter context/delete-3/C0` |
| formats / 436 | `independent formatter context/delete-7/C0` |
| formats / 628 | `independent formatter context/delete-11/C0` |
| formats / 820 | `independent formatter context/repeated-alignment-7/C0` |
| formats / 844 | `independent formatter context/repeated-alignment-11/C0` |

These tests enter the Apple fallback only after GNU native-native failure.
Apple forward succeeds correctly; Apple reverse exits **0** but returns wrong
bytes even for **GNU's own patch**. The deletion fixtures put the removed lines
before a displaced surviving line; the repeated fixtures move a `same` line
across `pivot`. Exact before/expected/actual bytes are retained in the evidence.
The assertion fails at `ORACLE BLOCKED: Apple reverse bytes` before a valid
Apple product comparison can be made. `repeated-alignment-0` has correct Apple
reverse bytes and its formatter test already passes: it is intentionally not
invented as a sixth formatter failure. An exit-only oracle check would hide
real Apple data corruption and is unacceptable.

### Parser-native failures — 5

| Suite / ordinal | Exact failing name | Actual native observation |
| --- | --- | --- |
| parser / 6 | `normal-tab-prefix` | GNU diff `--normal --initial-tab` reproduces the golden; GNU patch autodetection returns 2, target unchanged |
| parser / 9 | `normal-suppress-blank-empty` | GNU diff reproduces bare `>`; GNU patch returns 2, target unchanged |
| parser / 39 | `normal-unsafe-integer` | GNU exceeds 3,000 ms, is killed with SIGKILL; no successful native result exists |
| parser / 77 | `GNU-normal-suppress-blank-empty` | Second, distinct native-only assertion for the same producer/consumer incompatibility |
| parser / 79 | `GNU-context-zero-middle-deletion` | GNU diff produces omitted new-side body; GNU patch returns 2, target unchanged |

The first three combined assertions have **`productIssues: []`** in the frozen
raw TAP. Fresh frozen probes accept the two valid normal inputs, preserve exact
requested bytes, and reject the unsafe integer with exit 2 without changing
the target. The additional context-zero product projection also reconstructs
`left\nright\n`. Native parser controls 77/79 contain no product assertion.

Source controls: `pch.c:827` recognizes normal input only through `< ` / `> `,
although its later normal-body parser accepts tab prefixes; `pch.c:1832`
requires a blank after `>` and rejects suppressed blank output. Unsafe input
is literal `9007199254740993a1\n> new\n`; it is not a reason to emulate the
native hang or weaken the product integer/line budget. The new capture also
records Apple returning success without the tab edit and producing a NUL byte
for suppressed blank output. Apple is not an alternative successful oracle.

## Required gate redesign — proposal, existing tests untouched

1. **Product compatibility gate:** all 12 selector failures and both patch
   failures remain ordinary failing product assertions until source fixes.
   Do not rewrite GNU goldens to Apple, skip on native failure, or make a
   source failure pass as an unsupported/profile result. Product format bytes
   and parser exact outputs remain asserted independently of control health.
2. **Raw native matrix:** preserve every original success expectation and its
   actual failure/status/bytes as historical/live diagnostics, including all
   16 failed controls. Report that denominator separately; never advertise
   calibrated known failures as 16 successful native roundtrips.
3. **Calibration gate:** pin binary hashes and assert the actual documented
   native outcome for these exact fixtures. Context-zero native rejections
   must include the expected diagnostic and unchanged bytes; Apple corruption
   must retain exact wrong bytes as evidence, not substitute those bytes as a
   product golden. Unknown failures or changed native behavior fail calibration.
4. **Split parser combined assertions:** always execute/assert product
   behavior; separately record native outcomes. For the unsafe-integer vector,
   assert bounded process termination (3,000-ms supervisor, SIGKILL, bounded
   captured output, unchanged target), not a nonexistent native success. Keep
   the timeout counted as a raw native timeout, not a successful native parse.
5. **Formatter fallback:** do not require broken Apple controls as a prerequisite
   for checking byte-identical GNU output. Exact native output comparison plus
   independent grammar/golden-byte properties remains a product assertion.
   Where output genuinely differs through valid alignment, require independent
   bidirectional application/minimality evidence; never accept arbitrary output
   solely because both oracles fail. The six affected outputs here are exact
   native matches; all twelve forward/reverse product projections still run.
6. Preserve the original **2,939 / 30** record. A future split may add tests;
   publish old-to-new test mapping and separate product, calibration, and raw
   counts rather than silently changing denominators. The new seven evidence
   tests validate the recorded classification, not current product completion.

## Additional default/atomic contract requirements, with native proof

These **12 new mutation probes are outside the original 30**. All native calls
use literal argv, isolated temporary roots, C locale, `--batch --fuzz=0
--no-backup-if-mismatch -p0`; thus backup behavior and default fuzz are deliberately
not claimed as tested. Product calls use `-F0 -p0` and the same relevant option.

| Probe | Pinned GNU result | Captured current product result |
| --- | --- | --- |
| `delete-prunes-parents` | exit 0; `/dev/null` deletion removes file and both empty ancestors | file removed, ancestors remain |
| `delete-keeps-nonempty-parent` | removes `dir/sub`, keeps `dir/sibling` and `dir` | empty `dir/sub` remains |
| `empty-without-E` | exit 0; ordinary empty output remains an empty file | same |
| `E-prunes-parents` | exit 0; empty output and empty ancestors removed | ancestors remain |
| `dry-run-no-pruning` | no mutation | same |
| `same-file-partial-default-reject` | exit 1; good hunk committed, bad hunk in `target.rej` | exit 1, entire target unchanged, no reject |
| `multi-file-partial-default-reject` | exit 1; first and third files changed, second unchanged plus `second.rej` | all three unchanged |
| `explicit-reject-file` | exit 1; good hunk committed, rejects in `chosen.rej` | option rejected with exit 2 |
| `discard-reject-file` | exit 1; good hunk committed, no `.rej` for `--reject-file=-` | option rejected with exit 2 |
| `dry-run-partial-no-reject` | exit 1; unchanged target, no rejects | same |
| `malformed-later-section` | exit 2; earlier file already committed, later file unchanged | both unchanged |
| `partial-keeps-later-matching-hunk` | exit 1; first and third hunks applied, second rejected | exit 2 on repeated coordinate before any write |

**Proposed exact source requirement to root:**

- Default `patch` must follow GNU partial application: a failed applicable hunk
  produces exit 1, preserves the failed region, commits matching hunks, writes
  only failed hunks to the proper reject destination, and continues to later
  hunks/files. A malformed later section is exit 2 and does not undo already
  committed earlier sections. Do not stage the entire invocation and then
  abort all changes on the first hunk conflict as the default.
- Support `-r FILE` / `--reject-file=FILE`, default `<target>.rej`, and `-` to
  suppress the reject file. Explicit reject paths must receive the same bounded
  virtual-path/security checks as other writes. Preserve deterministic reject
  bytes/coordinates, resource limits and failure diagnostics. Native capture
  proves the default and long forms; the source worker must independently
  verify the short form, multi-file aggregation, existing reject destinations,
  collision/path attacks, stream failures and output budgets before shipping.
- Deleting a file through `/dev/null` or `-E` must attempt empty-ancestor pruning,
  without deleting nonempty parents or escaping the authorized virtual boundary.
  Never recursively delete a subtree to emulate `rmdir`. `--dry-run` must not
  delete files/directories or produce reject files. This is command-layer work;
  **all filesystem implementations remain exclusively Poincare-owned**.
- **Proposed, not shipped: `patch --atomic`** is an explicit application-preflight
  mode, not a silent GNU default. Any parse, path, budget, or hunk failure before
  publication must leave *all* targets, reject files, and ancestor directories
  untouched, with no success stdout. On complete applicability it may commit.
  This is hunk/validation-failure atomicity, not a claim of crash-safe or
  multi-backend transactional storage. The existing filesystem contract cannot
  guarantee rollback of an uncooperative host operation or multi-file atomic
  publication. If a stronger all-failures atomic contract is required, it needs
  a separately supported transaction capability and must fail closed before
  writing on adapters without it; do not invent that capability in this task.
- Host write/prune/reject failures and cancellation remain distinct from hunk
  conflicts: report truthful committed-prefix/side-effect information; never
  claim rollback or continue publication blindly after host failure. Move
  existing preflight/no-mutation applicability assertions to explicit atomic
  mode **only after it exists**, while adding default GNU partial-state tests.
  Do not delete the old safety assertions. Preserve security invariants; any
  intentional security divergence must remain visible, not an unsupported waiver.

Pinned implementation proof: `patch.c:534`–555 selects empty-file deletion;
`patch.c:1786`–1802 removes files then calls `removedirs`; `util.c:1356` attempts
empty ancestor removal. `patch.c:651`–707 emits rejects without discarding
successful hunks. `patch.man:348` documents ancestor removal. The current
captured `patch.ts` instead stages all hunks, requires existing parents, and
only publishes after complete preparation. It has no reject destination or
atomic-mode switch. Git's separate `git apply --reject` documentation explains
why Git's default whole-patch hunk-failure atomicity must not be confused with
GNU patch defaults; this is contextual documentation, not a Git-native test.

## Evidence, validation, and reproduction

- Baseline: `b92841a8ceaba9fb1f9c8c7915e218f880a9d1ed`; fresh frozen imports
  from `/tmp/safe-bash-diff-checkpoint-Fpgf5L`. All 11 frozen diff/patch source
  hashes are checked against the existing checkpoint before use.
- Current capture: **2026-08-26T21:22:27.852Z**, HEAD before/after
  `b4033fb96b353bf82025a28aafff6619066967dc`, **with concurrent uncommitted
  diff/patch work** explicitly recorded. All scoped before/after source hashes
  match during capture. This is a hash-bound worktree observation, not a claim
  that HEAD alone contains those changes or that later edits were validated.
- Concurrent changes already correct the five selector reproductions and the
  two patch semantic reproductions in this capture. Frozen copies still
  reproduce the defects. Original tests have not been edited or rerun here;
  do not infer that the full 30 or any whole-suite denominator is now passing.
- `evidence.json`: exact 30 names, frozen TAP SHA-256 values, GNU/Apple binary
  identities, pinned C/man-page hashes, source hashes, literal argv/stdin,
  statuses, bounded termination, and complete before/after trees. Temporary
  unreadable native files left by the killed unsafe-input process retain
  mode/size metadata; they are not opened without permission or silently omitted.
- GNU diff executable SHA-256:
  `f13ef516c397b0281818ffe8685aa763100b56a6549295c91849c6af937a83c9`.
  GNU patch executable SHA-256:
  `c060444da0e547de6f17594baf0b5015a04f5b3277131ca12b1da27c621aee00`.
- Original artifacts remain read-only at
  `/tmp/safe-bash-diff-checkpoint-Fpgf5L-evidence`. No existing test, source,
  filesystem, root documentation, manifest, or other worker staging was edited.
- Live probes do not install dependencies. Native stdin/files are capped at
  512 KiB; combined stdout/stderr at 512 KiB; each process has a 3,000-ms kill
  timer and no shell. Product calls use a 5,000-ms cancellation signal. Temporary
  roots are created and cleaned exclusively inside this owned directory.

```sh
node_modules/.bin/tsx tests/commands/diff-patch-stress/gnu-target-classification/probe.ts --gate
node --import tsx --test tests/commands/diff-patch-stress/gnu-target-classification/evidence.test.ts
node_modules/.bin/tsc --noEmit -p tests/commands/diff-patch-stress/gnu-target-classification/tsconfig.json
```

`probe.ts --gate` emits JSON and exits nonzero for current compatibility or
unexpected calibration failures. The captured invocation with `--record --gate`
exited **1**, preserving **9 additional mutation mismatches** and **0 unexpected
calibration outcomes**; it is not a passing product run. `--record` explicitly
replaces only this directory's evidence via `apply_patch`; omit it to preserve
the committed capture. The required frozen snapshot and pinned executables
must exist; absence is a hard error, never a skip. Initial collection hit a
native mode-000 temporary output after timeout; the collector was corrected
to record metadata, not to bypass permissions. Another attempt caught a new
live source filename absent from the frozen archive; frozen enumeration now
correctly uses the checkpoint manifest.

Validation completed: **7/7 evidence tests**, zero failures/skips, and strict
scoped TypeScript **exit 0**. A second non-recording live gate run at
**2026-08-26T21:27:48.420Z**, HEAD before/after
`6bbf6a0e7bf0666500ac2a884121eef8907adbb3`, again had stable scoped source hashes,
the same **9 mutation mismatches**, **0 unexpected calibration outcomes**, and
**exit 1**. It additionally verifies exact Apple wrong bytes and exact GNU
native diagnostic/stdout bytes against the retained capture. It does not
replace the earlier full evidence or claim later source validation.

Primary documentation consulted via web search/open on August 26, 2026:
`https://www.gnu.org/software/diffutils/manual/html_node/Inexact.html`,
`https://www.gnu.org/software/diffutils/manual/html_node/Merging-with-patch.html`,
`https://www.gnu.org/software/diffutils/manual/html_node/Creating-and-Removing.html`,
`https://www.gnu.org/software/diffutils/manual/html_node/patch-Options.html`, and
`https://git-scm.com/docs/git-apply` (`--reject`). Version-specific conclusions
are grounded in the pinned local sources and native vectors, not unpinned
manual prose. No superiority, scope-completion, or duration claim is made.
