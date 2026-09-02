# Cohort live-consumer path repair

## Scope and disposition

Implemented September 2, 2026 in `/tmp/poe-test-speed-push-20260901`.
This repairs ordinary current-tree selectors after the shell-language,
contracts, expression, diff-patch and text-program cohort audit. It does not
rewrite historical evidence or claim that historical verification protocols
accept current production bytes.

- Change only moved member selectors to `.cases.ts`, never to an aggregate.
- Preserve selector order, command grouping, flags and process isolation.
- Restore `tests/contracts/io.cases.ts` byte-identically to `io.test.ts` and
  remove only its import from `contracts.test.ts`.
- The additional conservative disposition restores contracts/command,
  shell/unsupported-options, and diff-patch hunk-regressions and
  patch-gnu-publication the same way, without changing their consumers.
- Leave production, shared root files, settled cohort plans, frozen IO/memory
  cohorts, retired tools, sealed protocols and historical maps unchanged.
- No Git, raw lint, full build, release operation or frozen integration-tree
  operation is part of this work.

Paths below are relative to `packages/safe-bash` unless stated otherwise.

## Exact changed files

The final eight verifier edits replace 22 string-literal occurrences. Every other
byte is unchanged: reversing just these path substitutions reproduces each
captured pre-edit file exactly.

| Verifier | Moved basenames, `.test.ts` to `.cases.ts` |
| --- | --- |
| `tests/shell/diagnostic-context-verify.mjs` | substitution-nul, parser-regressions, ansi-words |
| `tests/shell/errexit-verify.mjs` | parser-regressions, core, runtime-regressions, fatal-expansion, expanded-gaps-env-host, expanded-gaps-fallback-host |
| `tests/shell/substring-verify.mjs` | parser-regressions, ansi-words, fatal-expansion |
| `tests/shell/expanded-gaps-verify.mjs` | expanded-gaps-fallback-host, expanded-gaps-env-host, env-replacement |
| `tests/shell/output-accounting-verify.mjs` | expanded-gaps-fallback-host, expanded-gaps-env-host, env-replacement |
| `tests/shell/env-replacement-verify.mjs` | env-replacement |
| `tests/shell-stress/invocation-modes/verify.ts` | core, glob-budget |
| `tests/shell-stress/env-split-author/core-verify.mjs` | env-replacement |

Other changed package files:

| File | Exact change |
| --- | --- |
| `tests/integration/stream-inspection-public-author/tsconfig.json` | `../../contracts/exports.test.ts` becomes `../../contracts/exports.cases.ts`; all other parsed configuration values unchanged |
| `tests/shell-stress/env-shebang-author/guarded-completion/tsconfig.scoped.json` | `../../../shell/env-shebang.test.ts` becomes `../../../shell/env-shebang.cases.ts`; all other parsed configuration values unchanged |
| `tests/contracts/io.cases.ts` → `tests/contracts/io.test.ts` | Byte-identical move, no assertion/helper/state changes |
| `tests/contracts/command.cases.ts` → `tests/contracts/command.test.ts` | Byte-identical move |
| `tests/shell/unsupported-options.cases.ts` → `tests/shell/unsupported-options.test.ts` | Byte-identical move |
| `tests/commands/diff-patch/hunk-regressions.cases.ts` → `tests/commands/diff-patch/hunk-regressions.test.ts` | Byte-identical move |
| `tests/commands/diff-patch/patch-gnu-publication.cases.ts` → `tests/commands/diff-patch/patch-gnu-publication.test.ts` | Byte-identical move |
| `tests/contracts/contracts.test.ts` | Delete only the io and command case-module imports |
| `tests/shell/shell-language.test.ts` | Delete only the unsupported-options case-module import |
| `tests/commands/diff-patch/diff-patch.test.ts` | Delete only the hunk-regressions and patch-gnu-publication case-module imports |
| `src/commands/diff-patch/GNU-DIFF.md` | Correct only current Node test/TypeScript command selectors, including the six-member brace selector, to `.cases.ts` |

The only new repository file is `docs/plans/cohort-live-consumer-paths.md`.
No README is changed. GNU-PATCH.md has no net change: its initial publication
selector correction was undone when that owner returned to standalone. The
same applies to errexit's unsupported-options selector, but its six other
approved selector corrections remain. No replacement for absent
`tests/commands/diff-patch/patch-gnu-coordinates.test.ts` is invented; that
unrelated selector remains visibly unresolved in the GNU-PATCH command.

## Source-bound contracts and env-split

The restored io body has SHA-256:

`0be30d243f4df7688f57fc2bdc5b7b914c3fae62203f8e5613595d4153e7f0ec`

Its pre-move and post-move bytes match. There is no remaining `io.cases.ts`
copy or aggregate import. After both restorations the aggregate retains 12
case modules / 87 cases; standalone io has 14 cases and command has 27 cases.
The former 128-case aggregate therefore becomes 87 aggregate cases plus 41
isolated cases, with the identical 128 unique names and exact name multiset.
`io.stress.test.ts` and `value.test.ts` remain standalone and unchanged.
Full direct contracts now has five entrypoints,
213 registrations and 213 unique names.

This deliberately restores per-file process isolation for io instead of
rewriting historical pathname maps. In particular, these files stay untouched:

- `tests/stress/byte-ownership-20260827/fix/record.mjs`
- `tests/stress/byte-ownership-20260827/fix/binding.mjs`
- `tests/stress/byte-ownership-20260827/binding.mjs`
- `tests/stress/byte-ownership-20260827/independent/run.mjs`
- `tests/stress/byte-ownership-20260827/fix/tsconfig.json`
- Their original manifests, candidate maps and evidence.

The unchanged fix tsconfig again resolves `../../../contracts/io.test.ts`.
Restoring a pathname does not establish that an old full-source seal matches
current production; those historical validators were not executed.

Env-split builds its current hashing input set from its current `legacy` list
and compiler inventory. Its historical validation separately reads
`tests/shell-stress/env-split-author/resume-seal.json` and checks `frozen.files`.
That map contains no renamed cohort member, including env-replacement. Only
the current `legacy` selector changes; the historical loop, keys, digests and
entire seal file remain byte-identical. No source-bound shell owner needs to
be restored for this particular reference.

## Initial repair TDD and qualification

This section records the initial io-only disposition. Its raw results are
preserved, not relabeled as runs of the final four-owner extension below.

Ad-hoc Node test controls were defined before editing and run against the
actual checkout. They check all eight verifier literal sequences, all three
compiler configurations' selected paths, io's original byte hash and unique
location, the exact aggregate edit, and the unchanged env-split seal.

Before the repair: 14 controls, 1 pass / 13 expected failures. After: 14/14
pass. The one initially passing control was the untouched historical seal.
Two actual Node invocations also exited 1 with a missing-file diagnostic for
`tests/shell/ansi-words.test.ts` and `tests/contracts/io.test.ts` before editing.

Qualification used Node v22.22.2, TypeScript 5.9.3 and tsx 4.22.4. Actual test
commands used `node --unhandled-rejections=strict --import tsx --test
--test-concurrency=1` followed by explicit paths. This serial qualification
flag does not change any repository verifier flag or discovery setting.

| Actual run | Result | Observed duration |
| --- | --- | --- |
| Original contracts aggregate before edit | 128/128, 128 unique names | 0.513 s |
| Restored aggregate plus standalone io | 128/128, exact original name multiset | 0.809 s |
| Full contracts: aggregate, io, io.stress, value | 213/213, 213 unique names | 1.327 s |
| Thirteen explicit `.cases.ts` targets selected by repaired consumers | 150/150 | 5.660 s |
| Seven existing GNU documentation case-module targets | 663/663 | 2.720 s |

Every actual run exited 0 with zero failures, cancellations, skips or TODOs.
The runs overlap; their counts must not be added as unique coverage. Durations
are diagnostic observations, not counterbalanced performance measurements or
a speedup claim. Restoring io intentionally adds one startup process.

The thirteen explicit targets, in executed order:

1. `tests/shell/substitution-nul.cases.ts`
2. `tests/shell/parser-regressions.cases.ts`
3. `tests/shell/ansi-words.cases.ts`
4. `tests/shell/core.cases.ts`
5. `tests/shell/runtime-regressions.cases.ts`
6. `tests/shell/fatal-expansion.cases.ts`
7. `tests/shell/expanded-gaps-env-host.cases.ts`
8. `tests/shell/expanded-gaps-fallback-host.cases.ts`
9. `tests/shell/unsupported-options.cases.ts`
10. `tests/shell/env-replacement.cases.ts`
11. `tests/shell/glob-budget.cases.ts`
12. `tests/shell/env-shebang.cases.ts`
13. `tests/contracts/exports.cases.ts`

Their body hashes were unchanged across execution. The GNU selected union is
`tests/commands/diff-patch/{options-regressions,diff-gnu-options,diff-formats,diff,safety,shell,patch-gnu-publication}.cases.ts`.
This qualifies explicit case-module invocation without wrappers, broadened
aggregate selectors, or disabled process isolation. It does not execute the
GNU-PATCH command's unrelated absent coordinates file.

Raw TAP, the runnable static control program and missing-path diagnostics are
new scratch artifacts at `/tmp/poe-live-consumer-paths-20260902-e50195`:
`controls.mjs`, `controls-red.tap`, `controls-green.tap`,
`contracts-before.tap`, `contracts-restored.tap`, `contracts-full.tap`,
`explicit-cases.tap`, `gnu-cases.tap`, and `missing-path-controls.json`.
The control program is checkout-path-bound and reads inputs without invoking
the original verification programs. No temporary probe is added under tracked
test paths.

The initial control program encodes the io-only disposition and is superseded
for the final checkout by the new final-selector control program below. Its
original bytes and red/green evidence remain unchanged.

## Final conservative restoration qualification

Root additionally authorized exactly four standalone restorations to resolve
filename breakage without modifying uncertain or historical consumers. Before
editing, nine new controls failed as expected: four body/location controls,
three exact aggregate-edit controls, and two current-selector controls. After
editing all nine pass. The complete selector/configuration controls, updated
only for the final disposition in a new scratch program, also pass 14/14.

| Restored stem (`.cases.ts` → `.test.ts`) | Identical pre/post SHA-256 |
| --- | --- |
| `tests/contracts/command` | `be7956b1a0720e39bd3473e641b4ef2be37f1168da1aea47353a858fc9b79d63` |
| `tests/shell/unsupported-options` | `57738443866d0f7e3ef8f79f643412857c53a6622cb96e3fdecf0c6e05f77ed4` |
| `tests/commands/diff-patch/hunk-regressions` | `ad32bd4dfa169b260dfe3d6843e1f26d6e47442000534caf2912a924fa250cd6` |
| `tests/commands/diff-patch/patch-gnu-publication` | `a70d6cbfc3edf4da637424575d53c402ac8d32746209cfd1ce57ca501c124b5a` |

All four former case-module paths are absent; each body exists exactly once at
its original standalone path. Each aggregate differs from the captured
pre-extension version only by removal of its corresponding imports. Remaining
import order is unchanged. These four owners regain per-file process isolation;
remaining case modules retain per-family isolation. No concurrency flag changes.

Actual serial before/after runs used the same Node flags recorded above. The
before contracts list was aggregate, io, io.stress, value; the after list adds
command.test.ts. Shell-language adds unsupported-options.test.ts alongside its
aggregate. Diff-patch adds hunk-regressions.test.ts and
patch-gnu-publication.test.ts alongside its aggregate.

| Family | Before | After | Unique names before/after | Durations before/after |
| --- | --- | --- | --- | --- |
| Full direct contracts | 213/213 | 213/213 | 213 / 213 | 1.239 s / 1.846 s |
| Shell-language owner set | 163/163 | 163/163 | 163 / 163 | 1.132 s / 1.603 s |
| Diff-patch owner set | 1128/1128 | 1128/1128 | 1123 / 1123 | 1.309 s / 1.880 s |

Every before/after name multiset compares exactly equal, including multiplicity.
Diff-patch's five existing duplicate-name occurrences are preserved, not new
duplicate registrations. All six runs exit 0 with zero failures, cancellations,
skips or TODOs. There is no coverage reduction or double import. The final
aggregates have 12 contracts, 13 shell-language and 23 diff-patch case-module
imports. This adds four startup processes relative to the initial repair;
durations are observations, not a counterbalanced performance claim.

New extension evidence is at
`/tmp/poe-live-consumer-restoration-20260902-38bcfc`: restoration-controls.mjs,
restoration-red.tap, restoration-green.tap, final-selector-controls.mjs,
final-selector-controls.tap, coverage.json, and the three families' before/after
TAP files. coverage.json includes the complete before/after name lists and body
hashes. The earlier evidence directory is not modified. No tracked-scope probe
is introduced and no historical verifier is executed.

## Post-rebase qualification: 60a3e8fdb

After root reported the rebase/push to `60a3e8fdb` atop incoming SafeJS
`3cd0aea0b`, qualification resumed against a fresh live-input capture. These
revision labels are root-supplied; no Git command was used to verify them.
Earlier measurements and captures were preserved, not reused as current proof.

The new bounded capture contains 1,575 files, including 664 SafeJS source,
existing artifact and package files. It covers root `src`, Bash `src`, SafeJS
`src` and existing `dist`, safe-fs `src`, direct files in the three affected
test directories, the repaired selectors/configs, relevant package manifests,
the root npm lock and the env-split seal. Held paths and aliases are excluded
before content reads; symlinks and aliases of held file identities are not
followed. This is a bounded snapshot, not a claim of a complete runtime import
closure or a rebuilt SafeJS feature qualification.

Before/after captured membership and bytes match exactly: zero drift.
The input-map SHA-256 is
`c32acfca785a9caa6890c854d753a63b6eded64fda602fa58fb38ac4ac8c5da1`.
The root npm lock remains unchanged with SHA-256
`d59f1693a141d7f241666a944e2d7ef8806a8366360a8dbd822ec391bf3162ea`.
No install, build or lockfile write was performed.

| Fresh post-rebase run | Pass/total | Duration |
| --- | --- | --- |
| Restoration controls | 9/9 | 0.025 s |
| Final selector/configuration controls | 14/14 | 0.045 s |
| Full direct contracts | 213/213 | 1.819 s |
| Shell-language owner set | 163/163 | 1.765 s |
| Diff-patch owner set | 1128/1128 | 2.325 s |
| Twelve explicit case modules plus restored unsupported-options | 150/150 | 6.021 s |

All runs exit 0 with zero failures, cancellations, skips and TODOs. The three
family name multisets match the pre-rebase qualified final disposition exactly,
including diff-patch's existing duplicate-name multiplicities. The explicit
selector run retains the initial 150-case multiset while using the restored
unsupported-options.test.ts path. No additional full-repeat runs were needed.
These are post-rebase correctness observations, not speedup measurements.

Fresh evidence and the exact 25-path pending-change manifest are in
`/tmp/poe-live-consumer-postrebase-60a3e8fdb-2d98d7`:
`pending-paths.txt` includes both old and new paths for all five moves;
`live-inputs-before.json`, `live-inputs-after.json`, `qualification.json` and
six TAP files record this qualification. GNU-PATCH.md is excluded from the
pending manifest because its bytes equal the original pre-repair file.
Root still owns staging, commit, hooks, push and release.

## Qualification limits and unresolved consumers

The original verifiers were not executed end-to-end: several invoke Git,
historical byte checks, global compiler passes, native tools or evidence
writers. Executed qualification covers the repaired target union, not every
unchanged neighboring selector in each legacy command. Compiler checks here
validate exact configuration edits and literal target existence, not a full
TypeScript compilation of their transitive inputs.

Parent verified that `tests/shell/variable-scope.test.ts`,
`tests/shell/positional-ifs.test.ts`, `tests/shell/quoted-patterns.test.ts`, and
`tests/shell/newline-patterns.test.ts` have no `.cases.ts` counterparts. Parent
identified their last change as `94cf8b10d`,
`feat(sandbox)!: remove Git and native tool gates`. This provenance is
parent-supplied, not independently checked with Git by this worker. These are
upstream removals, not regressions from our cohorts. Preserve that removal:
do not restore the files or retarget their remaining selectors. The first two
references remain in errexit's parser-state list; all four remain in
substring's parser-expansion list. No successful execution of those complete
historical verifier lists is claimed.

The consumer-repair patch is frozen after recording this disposition. Parent
is reviewing the 25-path patch and running final counterpart tests; this does
not constitute a full historical-verifier qualification or a worker claim
that the parent's pending tests passed.

The following uncertain or historically bound consumers remain untouched and
are not silently designated current or retargeted. Their references to the four
newly restored owners now resolve again, without historical-key or seal edits:

- `tests/plugins/qualified-current-release-native-data/capture.mjs:88`:
  `tests/contracts/command.test.ts`.
- `tests/shell-stress/errexit-legacy-policy/correction-typecheck.mjs:9`:
  `tests/shell/unsupported-options.test.ts`.
- `tests/commands/diff-patch-stress/evidence/fullgate-51282a9-author/validate.mjs:12`
  and `tests/commands/diff-patch-stress/evidence/fullgate-51282a9-followup/validate.mjs:13`:
  hunk-regressions / patch-gnu-publication; the latter also binds old bytes.
- `tests/commands/diff-patch-stress/evidence/fullgate-51282a9-followup/tsconfig.json`:
  corresponding old explicit include paths.

The additional standalone restoration does not qualify these historical
protocols against current production bytes or fix their other absent inputs.
Other historical-only groups are not restored. This remaining sealed
expression reference is intentionally unchanged and unresolved:

- `tests/commands/expr-stress/output-quota-author-v2-20260827/verify.mjs:22`:
  sealed output-quota correction evidence, not a current selector migration.

Fixed-revision archive replays, formally retired tools and recorded command
transcripts retain their original names and history. No blanket reference
replacement, duplicate test wrapper, concurrency change, cached result or
historical evidence regeneration is introduced.
