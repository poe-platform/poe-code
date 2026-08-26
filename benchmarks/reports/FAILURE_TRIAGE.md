# Original 51 failures: individual triage, August 26, 2026

## Revisions and measurement boundaries

- Original complete run: **f4eb0b327fd5a14f49dc6007f14f613b43cdaeea**,
  4,755 pass / 51 fail / 5 skip / 4 TODO of 4,815.
- Unchanged affected files, isolated **9d6d292febce66d2e7ffa564a059e8f44e4ebff9**:
  Apple/default 660/693 pass, 33 fail; GNU-selected 669/693 pass, 24 fail.
  Of the original 51 names: Apple 19 pass / 32 fail; GNU 34 pass / 17 fail.
  Additional failures in the selected files remain counted, not silently omitted.
- Latest focused archive **07da9990c67d6578662b9911b9bd88964a58a96c**:
  684/716 pass, 32 fail; original labels are **24 pass / 20 fail / 7 renamed**.
  Renamed is not pass: replacements and independent controls are listed below.
- One updated complete archive, **22fd7e5d46fb00409761196cbaf1ddc27f16f9bf**:
  **6,729 pass / 59 fail / 9 skip / 0 TODO of 6,797**. Build, typecheck, built
  package-root smoke (49 distinct commands) and all six actual-local SafeJS tests
  pass. Comparison remains 118/118 virtual versus just-bash 3.4.2's
  108 pass / 9 fail / 1 unsupported. Later focused fixes are not retroactively
  credited to this complete run. The 59 failures include newly added tests;
  they do not represent 59 distinct new product defects.

Full reproduction uses `benchmarks/verify-snapshot.mjs --revision REVISION` with
`SAFEJS_LOCAL_ROOT=/Users/kjopek/Workspace/poe-code/packages/safejs`. Focused
reproduction uses `node benchmarks/triage-snapshot.mjs --revision REVISION`.
Both archive the requested commit and check cached-dependency manifests; no
moving worktree source or stale temporary checkout is substituted.

GNU control variables (not global defaults):

```sh
DIFF_PATCH_NATIVE_DIFF=/tmp/safe-bash-gnu-oracle.Yg2F0W/diffutils-3.12/src/diff
DIFF_PATCH_NATIVE_PATCH=/tmp/safe-bash-gnu-oracle.Yg2F0W/patch-2.8/src/patch
DIFF_WHITESPACE_ORACLE=/tmp/safe-bash-gnu-oracle.Yg2F0W/diffutils-3.12/src/diff
```

The exact verified executable hashes are:

- GNU diff 3.12: `f13ef516c397b0281818ffe8685aa763100b56a6549295c91849c6af937a83c9`.
- GNU patch 2.8: `c060444da0e547de6f17594baf0b5015a04f5b3277131ca12b1da27c621aee00`.

Optional native binaries can be rebuilt using the owning worker's oracle
documentation. A missing binary is not a pass or a reason to silently select
another dialect. The default Apple and GNU reports are both preserved.

## Actionable priorities

1. **Faraday: actual GNU-profile boundary mismatch, original #20.** For target
   `prefix\nhead\nold\ntail\n`, patch `@@ -1,2 +1,2 @@` with context `head`
   and replacement `old` → `new`, `-F0` returns 1 without edits in both native
   tools. Virtual returns 0 and edits the target. The old calibration's assumed
   native success was wrong; the new `GNU boundary anchoring: asymmetric
   non-EOF rejection` correctly keeps this semantic gap red. EOF/symmetric
   positive controls pass. Do not dismiss the product/native difference merely
   because the original fixture was miscalibrated.
2. **Faraday/root: mixed diff format/context flag policy.** Fresh pinned-GNU
   gates fail for `-U0 -u`, `-U0 --unified`, `--unified=1 -ru`, `-u -U0`, and
   `-C0 -c`. Current output follows Apple-style context preservation, whereas
   the newly explicit GNU profile resets context. Eight golden/native tests
   plus the `GNU selector regression: -C0 followed by -c resets to three lines`
   fail in the focused gate run. This is a named profile difference, not proof
   of invalidity under every native dialect. Do not waive the GNU gate or erase
   Apple evidence to make the suite green.
3. **Sagan: ANSI-C quoting (#35)** is a real missing feature. **Fatal parameter
   status (#37)** differs from pinned Bash 3.2 (127 versus 1), despite preserved
   side-effect suppression. **Exact diagnostics (#38–39)** differ without
   differing stdout/status/file effects; they remain measured byte failures.
4. **Root/Sagan: prevalidation decision (#36).** Bash allows an earlier marker
   effect despite malformed later substitution; the documented virtual
   whole-source prevalidation invariant forbids it. Existing safety and parity
   tests conflict. This audit neither chooses a policy nor silently waives one.

No original failure was demonstrated to be a race. The default/selected-oracle
failures reproduce in isolated, concurrency-two runs. The newer unmatched
bracket hard-deadline failures were real source work: after `50cefdd`, both
matcher and shell deadline probes pass fresh focused tests, not larger timeouts.
No core/contracts/plugins product bug was found; no unrelated source was edited.

## Classification key and totals

- **FIX (23):** genuine source gap, later source commit passes original test.
- **ORACLE (11):** Apple reverse/context reference limitations; unchanged test
  passes with pinned GNU, with native-control evidence retained.
- **DIALECT (6):** native expectation differs by dialect; product matches GNU
  controls. This is not a source fix or universal compatibility achievement.
- **FIXTURE (1):** old pipeline omitted a now-required explicit output format.
- **STALE (4):** obsolete duplicate-status assertion; independent probes verify
  zero mutations and unchanged bytes/identity on the conflicting sequence.
- **OPEN (6):** boundary semantics (1), missing shell syntax (1), prevalidation
  policy (1), versioned exit status (1), exact diagnostic differences (2).

These classifications sum to **51**, independently of current test labels.

## Exact original tests, grouped by owner and file

### Faraday — diff/patch (30)

`tests/commands/diff-patch-stress/compatibility/diff.test.ts`

| ID | Exact original test | Triage |
|---|---|---|
| 1 | `native cross-application: unequal multi-hunk deltas, U0` | ORACLE: Apple reverse places an inserted line early; GNU passes. |
| 2 | `native cross-application: all lines deleted retaining empty target, U0` | ORACLE: Apple self-reverse fails on an existing empty target. |
| 3 | `native cross-application: all lines deleted retaining empty target, U1` | ORACLE: same reference limitation. |
| 4 | `native cross-application: all lines deleted retaining empty target, U2` | ORACLE: same reference limitation. |
| 5 | `native cross-application: all lines deleted retaining empty target, U5` | ORACLE: same reference limitation. |
| 6 | `native cross-application: repeated source lines alignment not prescribed, U0` | ORACLE: Apple reverse/interoperability failure; unchanged GNU test passes. |

`tests/commands/diff-patch-stress/compatibility/gaps.test.ts`

| ID | Exact original test | Triage |
|---|---|---|
| 7 | `golden GAP context-format patch autodetection` | FIX `b7f2bff`; original passes. |
| 8 | `native GAP context-format patch autodetection` | FIX `b7f2bff`; original passes. |
| 9 | `golden GAP explicit context-format patch` | FIX `b7f2bff`; original passes. |
| 10 | `native GAP explicit context-format patch` | FIX `b7f2bff`; original passes. |
| 11 | `golden GAP epoch-header creation without dev-null` | FIX `90b4765`; original passes. |
| 12 | `native GAP epoch-header creation without dev-null` | FIX `90b4765`; original passes. |

`tests/commands/diff-patch-stress/compatibility/patch.test.ts`

| ID | Exact original test | Triage |
|---|---|---|
| 13 | `native patch: reverse full deletion into existing empty file` | ORACLE: native-only Apple empty-target reversal failure; GNU passes. |
| 14 | `native patch: ORACLE LIMITATION reverse zero-context interior deletion` | ORACLE: Apple returns 0 but writes `b\na\nc\n`, not `a\nb\nc\n`; GNU passes. |
| 15 | `golden patch: BSD POLICY: asymmetric fuzz with no leading context` | DIALECT: virtual and GNU both edit successfully; Apple rejects. Renamed GNU case passes. |
| 16 | `native patch: BSD POLICY: asymmetric fuzz with no leading context` | DIALECT: same; renamed GNU native case passes only with the selected GNU oracle. |

`tests/commands/diff-patch-stress/editflows/parity.test.ts`

| ID | Exact original test | Triage |
|---|---|---|
| 17 | `edit-flow parity: normal patch append change delete` | FIX `b7f2bff`; original passes. |

`tests/commands/diff-patch-stress/fuzz/edits.test.ts`

| ID | Exact original test | Triage |
|---|---|---|
| 18 | `all six file-section orderings apply coding-agent create/edit/delete flows and reverse` | ORACLE: Apple native reverse cannot reconstruct deleted target; GNU matrix passes. |

`tests/commands/diff-patch-stress/fuzz/properties.test.ts`

| ID | Exact original test | Triage |
|---|---|---|
| 19 | `512 independent seeded diff/patch, reverse, native, golden, and minimality properties` | ORACLE-limited: Apple reverse/control failures; same source's entire seeded test passes under GNU. Printed individual failures are truncated, not an exhaustive per-phase count. |

`tests/commands/diff-patch-stress/fuzz/regressions.test.ts`

| ID | Exact original test | Triage |
|---|---|---|
| 20 | `oracle calibration: asymmetric zero-fuzz context with a displaced exact anchor` | OPEN: old success calibration invalid; both native tools reject, virtual applies. Replacement GNU rejection gate remains red. |
| 21 | `oracle calibration: native-generated unterminated context survives native reverse` | ORACLE: Apple native-generated patch fails native reverse; GNU self-control passes. |

`tests/commands/diff-patch-stress/safety/integration.test.ts`

| ID | Exact original test | Triage |
|---|---|---|
| 22 | `Shell diff-to-patch pipeline treats Unicode/metacharacter labels literally` | FIXTURE `f82f1f2`: add explicit `diff -u`, preserving original expected target bytes and sentinel safety. Independent original/`-u` probes retained. |

`tests/commands/diff-patch-stress/safety/paths.test.ts`

| ID | Exact original test | Triage |
|---|---|---|
| 23 | `normalized duplicate prevalidation: target + ./target` | STALE: status 1 conflict after staged-sequence support, no writes; replacement contradictory test passes. |
| 24 | `normalized duplicate prevalidation: dir/target + dir/./target` | STALE: same; replacement passes. |
| 25 | `normalized duplicate prevalidation: a/target + b/target` | STALE: same after `-p1`; replacement passes. |
| 26 | `normalized duplicate prevalidation: a/./target + b/target` | STALE: same after `-p1`; replacement passes. |

`tests/commands/diff-patch/diff-formats.test.ts`

| ID | Exact original test | Triage |
|---|---|---|
| 27 | `whitespace native exact bytes: all C-locale whitespace, all, --normal` | DIALECT: Apple C-whitespace handling differs; unchanged GNU-selected test passes. |
| 28 | `whitespace native exact bytes: all C-locale whitespace, all, -u` | DIALECT: same. |
| 29 | `whitespace preserves original bodies and both context sides: -b, unified` | DIALECT: Apple selects different context-side bytes; virtual matches GNU's original-old context. |
| 30 | `whitespace context preserves per-side incomplete-line markers and native parity` | DIALECT: Apple lacks the expected incomplete-context marker; virtual matches GNU. |

### Sagan — shell (10)

`tests/shell-stress/differential.test.ts`

| ID | Exact original test | Triage |
|---|---|---|
| 31 | `Bash differential: descriptor-move-closes-original-after-copy` | FIX `7ecd677`; original passes. |
| 32 | `Bash differential: read-n-consumes-exactly-two-characters` | FIX `e8abc84`; original passes. |
| 33 | `Bash differential: read-d-consumes-through-delimiter-only` | FIX `e8abc84`; original passes. |
| 34 | `Bash differential: command-substitution-file-shortcut-reads-and-trims` | FIX `7a869af`; original passes. |
| 35 | `Bash differential: ansi-c-quoted-word-decodes-escape-before-argument-passing` | OPEN missing ANSI-C quoting. |
| 36 | `Bash differential: nested-substitution-syntax-error-does-not-prevent-earlier-effects` | OPEN root/Sagan prevalidation policy conflict. |
| 37 | `Bash differential: fatal-parameter-expansion-prevents-following-file-effect` | OPEN pinned Bash 3.2 exit-status mismatch; later effects already suppressed. |
| 38 | `Bash differential: fatal-arithmetic-expansion-prevents-following-file-effect` | OPEN exact stderr only; status/stdout/file effects match. |
| 39 | `Bash differential: fatal-expansion-in-substitution-stops-substitution-only` | OPEN exact stderr prefix only; substitution control/output/file effects match. |
| 40 | `Bash differential: glob-posix-bracket-digit-class` | FIX `50cefdd`; original passes. |

### Poincare/Sagan/Curie — integrated stdin metadata (11)

`tests/shell/stdin-origin.test.ts`; all FIX through `1c0d9ae` + `27e5c58` +
`55263f6`, with unchanged original assertions passing. IDs 41–43 have duplicate
reported names; they are distinct empty-string, zero-byte-array, empty-source cases.

| ID | Exact original reported test |
|---|---|
| 41 | `stdin origin: rg integration rg match supplied=true` (empty string) |
| 42 | `stdin origin: rg integration rg match supplied=true` (empty byte array) |
| 43 | `stdin origin: rg integration rg match supplied=true` (empty source) |
| 44 | `stdin origin: rg integration printf '' \| rg match supplied=false` |
| 45 | `stdin origin: rg integration printf '' \| rg -e match supplied=false` |
| 46 | `stdin origin: rg integration printf '' \| rg -f .patterns/patterns supplied=false` |
| 47 | `stdin origin: rg integration rg match <empty supplied=false` |
| 48 | `stdin origin: rg integration rg match <<END\\nEND supplied=false` |
| 49 | `stdin origin: rg integration rg match 3<empty 0<&3 supplied=false` |
| 50 | `stdin origin: rg integration rg match <empty 3<&0 0<&3 supplied=false` |
| 51 | `stdin origin: rg integration printf '' \| env rg match supplied=false` |

## Renamed tests, new failures and ownership

`f82f1f2` is the owning worker's documented fixture reconciliation, not this
worker changing expected values. The machine-readable index preserves all seven
missing old labels and explicitly maps them to new labels; missing is never pass.
Independent controls validate GNU asymmetric fuzz, four contradictory normalized
sequences, and the still-red boundary anchoring replacement.

The new absolute-header safety failure was probed with fresh files for each argv:
implicit target rejects without writes; explicit `target` authorizes only that
literal target despite header labels. The sentinel remains untouched. This is
the deliberate `e685231` operand-authorization rule, not a header-driven escape.
The owner later reconciled corresponding tests in `27398d6`; this audit does not
claim a full-suite rerun at that later revision.

The updated 59-failure complete snapshot routes **45 to Faraday, 14 to Sagan**.
Every exact name/file/raw diagnostic is in `failure-triage-index.json` under
`currentFailures`, including newer GNU context/native-native control cases and
newer shell deadline/diagnostic tests. Additional failures are not collapsed into
the original 51. Latest focused deadline controls pass; the broader complete
snapshot's remaining default-native failures remain published.

Bytes checkpoint distinctions: this complete archive predates `07da999` and has
nine external-oracle skips, zero TODOs. The later author-reported 381/381 pinned-GNU
byte run and 373 passes/eight optional-oracle skips without GNU are separate
evidence, not substitutions for this global result. Apple observations remain
recorded. Optional SafeJS command source and cross-adapter integration verification
retain their separately assigned owners.

No superiority, full-shell completion, zero-current-failures, or clean moving
worktree claim follows from this triage or the 118-case comparator.
