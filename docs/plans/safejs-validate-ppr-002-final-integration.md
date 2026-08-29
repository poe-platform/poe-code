# Independent final PPR-002 ordered integration review

Date: August 29, 2026. Delegated independent validator, not author.

## Scope and intake

- Closed author workspace: `/Users/kjopek/Workspace/poe-code-safejs-public-promise-recovery-integrated`.
- Frozen input: `out/safejs-remediation/ppr-002-integrated/final-candidate/manifest.json`.
- SHA-256: `8aa982da2dab9b01da8f80c2035397143e1693c17ed64ab6a8f9247f37061826`.
- Declared base: `32caeaddbac72bccea1cb3fd0a07fb293a1bee71`; no Git commands are used.
- Verified 671 listed artifacts plus the manifest: 672 captured files total.
- Verified all 22 PPR2 postimages, 50 separately listed prerequisite paths and
  seven validation-support inputs. Five overlaps produce 67 working scope paths.
- PPR2 has ten ordered preimages. PPR1 is absent. Shadowed-array coverage adds
  23 controls and two prerequisite plans without a production change.
- Bootstrap uses the captured 38-path exclusion metadata and denies `security/`;
  no original audit payload or external archive is read. All evidence reads are
  manifest-allowlisted; no original, production, existing test, or README edit.

## Independent procedure

1. Check exact production/preimages, five fresh assertions, receiver-scoped ALS
   cleanup, unchanged historical oracles, and format-only report replacement.
2. Force all workspace builds, then run the complete root build with
   `env -u TERM SKIP_SYNC_SKILLS=1`; do not write home skill configuration.
3. Independently rerun configured production and scoped test types, ESLint,
   package rules, all scoped formats and strict whitespace checks. Recompile the
   matching 24-root baseline and candidate type programs using captured ordered
   preimages in memory, preserving the authorized qualified RED status.
4. Recheck original raw native Promise inputs, native expectations, fresh-process
   v7 restores, six working v6 controls, eight historical raw-v6 TypeErrors and
   multicapture stability. Do not fabricate proofs, replace raw inputs, rewrite
   markers, or misclassify the remaining PPR1 alias difference as repaired.
5. Run the complete root runtime suite without exclusions, plus focused combined,
   shadowed-array, AR/CBI and independent receiver-lifetime controls.
6. Preserve every failure and exact source hash; if a regression occurs, request
   author repair instead of weakening assertions. Seal a delta-only reviewed
   manifest, ordered preimages, relevant reports and separate prerequisites only
   after applicable gates and compatibility checks are satisfied.

## Verdict: HOLD for publication-fixture closure

The functional/runtime review passes, but the frozen PPR2 delta is **not READY
for publication**. A published test depends on two non-published `out/` data
files. A publication-root projection reproduces an actual test-collection failure
without those files. This is in the independent historical validator test I
authored and which is now included in the author's publication delta; it is not
a newly discovered runtime defect or an unrelated legacy type failure.

All five fresh-marker repairs and the exact-one receiver-scoped ALS assertion
are correct. Working v6 compatibility, fresh v7 recovery, historical negative
cases and the ordered prerequisites pass. No runtime repair or weakened assertion
is requested. The required repair is to include the unchanged historical data in
tracked package test fixtures and make the test resolve those published fixtures.

No publication approval or READY delta-only seal is granted. Root should request
the focused fixture/path repair, then a newly frozen candidate and fresh review.
PPR1 alias memoization remains separate; the four runtime postimages are unchanged.

The expanded legacy test-type gate is explicitly **qualified RED: exit 2, 56
diagnostics in each matching program, zero new and zero removed signatures**.
The qualification is root-authorized; it is not a green typecheck or permission
to suppress diagnostics, omit roots, or repair unrelated types.

## Blocking publication reproduction and exact repair request

`packages/safejs/test/ppr2-integration-history.test.ts:10` eagerly reads:

```text
out/safejs-remediation/ppr-002-integrated/provisional-ppr2/evidence/ordered-original-red.json
out/safejs-remediation/ppr-002-integrated/provisional-ppr2/evidence/ordered-v6-generations.json
```

Both appear only in `requiredValidationSupport`, not in the 22 PPR2 publishable
paths or the 50 prerequisite publication paths. The retained author workspace
contains them, which explains why its full root suite and this review's initial
full root run pass. Those passing runs do not establish that the publication
file set contains everything needed to collect the new test.

The independent focused publication projection copies the **exact candidate test**
(SHA-256 `0c68f35ec1728b961cffb139eb96cff1793743fcd5cce64deb759a9838536ec2`)
into a separate root inside this clone's evidence directory. It uses the actual
repository Vitest config/setup and links the unchanged source, package fixtures
and dependencies. The non-publication `out/` support files are genuinely absent;
there is no read mock, source transform, marker rewrite or assertion adjustment.
The result is **exit 1, one failed suite, no collected tests**:

```text
ENOENT: no such file or directory, open
'out/safejs-remediation/ppr-002-integrated/provisional-ppr2/evidence/ordered-original-red.json'
```

Evidence: `publication-projection.log` and `publication-projection-proof.json`.
A second projection adds only the two exact hash-verified support files and leaves
the candidate test bytes unchanged. This diagnostic positive control collects and
passes all **40 tests**; see `publication-projection-with-support.log` and its
proof JSON. Manually staging `out/` files is **not** proposed as the publication fix.
The failure is isolated to the omitted data dependency, not source behavior.

Required author/root repair:

1. Include the two genuine frozen data inputs as tracked package fixtures, for
   example under `packages/safejs/test/fixtures/ppr2-integration-history/`.
2. Change only the validator's fixture lookup to a package-relative location,
   preferably relative to `import.meta.url`, rather than an audit workspace's CWD.
3. Preserve all historical bytes, markers, assertions and hash validation. The
   required original data SHA-256 values are
   `a9feba99d6e0f02d631f8b38c4e027beaa30d7d240b0f8666edbb3ada26bed62`
   and `d72a81042ddabc34835079e7d9e8aa53c058390ae9860fdbbe1d0051a01533ae`.
   Do not manufacture new snapshots, catch/skip missing data, drop the 40 cases,
   add exclusions, change version markers or relax expected TypeErrors.
4. Check the other explicit validation-support dependencies: the ordered-mode
   Vitest config also reads a manifest and four preimages from `out/`. Distinguish
   an explicitly documented artifact-dependent manual comparison from ordinary
   published tests. Ordinary root test collection must not require hidden audit
   staging. No unrelated runtime/type cleanup is authorized by this finding.
5. Refreeze the complete delta including its required fixtures, and rerun the
   exact historical tests from a publication root without any `out/` support,
   then the full root suite and applicable type/lint/format gates.

The test, runtime and frozen candidate files remain untouched. This review only
adds its own report and evidence/projection files inside the current clone.

## Independent gates

Evidence paths below are relative to `out/safejs-ppr2-final-independent/`.

| Gate                                                                   | Independent result                                                                           | Evidence                                                                           |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Forced workspace build, then complete root build                       | Both exit 0; workspace builds forced with `turbo run build --force`                          | `forced-workspace-build.log`, `full-root-build.log`, corresponding command records |
| Complete configured root runtime suite, no added exclusions            | **24,060 pass; 41 existing skips; zero failures**, 972 passing files and three skipped files | `full-root-runtime.log`, `full-root-runtime-command.json`                          |
| Ordered combined suite, 38 files                                       | **999 pass**                                                                                 | `combined-999.log`                                                                 |
| Repaired AR/OBJ2 control suites                                        | **37 pass**                                                                                  | `repaired-candidate-green-37.log`                                                  |
| Independent ordered and candidate controls                             | **59 pass in each mode**                                                                     | `independent-ordered-59.log`, `independent-candidate-59.log`                       |
| Unchanged PPR2 recovery and compatibility suites                       | **24 pass**                                                                                  | `ppr2-focused-24.log`                                                              |
| Fifth-site loader suite                                                | **7 pass**                                                                                   | `loader-five-site.log`                                                             |
| Shadowed-array supplementary controls                                  | **23 pass**                                                                                  | `shadow-23.log`                                                                    |
| Configured root and SafeJS production types                            | Exit 0 each                                                                                  | `root-types.log`, `safejs-types.log`                                               |
| Introduced/scoped roots, including loader and shadow tests             | **20 roots, zero diagnostics, exit 0**                                                       | `introduced-types-20.log`                                                          |
| Expanded matching test-type scope                                      | **24 roots; 56 → 56; zero new; qualified RED**                                               | `expanded-types-24.log`, `independent-type-comparison-24-final.json`               |
| Root ESLint and package rules                                          | Exit 0 each                                                                                  | `root-eslint.log`, `package-rules.log`                                             |
| All 67 supplied scope paths: configured Prettier and strict whitespace | Exit 0; zero whitespace diagnostics                                                          | `format-67.log`, `strict-whitespace.json`                                          |

The root command is exactly `env -u TERM ./node_modules/.bin/vitest run`.
No test filter or additional exclusion was applied. The 41 repository-configured
skips remain visible; they are not represented as passing executions. No runtime
source or existing test was edited during this review. The only added repository
file is this Markdown report; a separate final format check covers it as well.

## Source, preimages and the five repairs

`production-and-five-site-proof.json` compares the four production paths against
the frozen provisional input, not just the author's final claims. Both their
postimages and their ordered preimages are unchanged:

- `packages/safejs/src/run.ts`
- `packages/safejs/src/restore.ts`
- `packages/safejs/src/snapshot/dump-format.ts`
- `packages/safejs/src/snapshot/migration.ts`

The five fresh-marker sites remain strictly `jobs-v7` assertions, at these final
postimage locations:

- `packages/safejs/src/external-checkpoint.test.ts:61`
- `packages/safejs/src/external-checkpoint-validation.test.ts:423`
- `packages/safejs/src/external-checkpoint-validation.test.ts:672`
- `packages/safejs/src/snapshot/obj-002-validation.test.ts:39`
- `packages/agent-harness/src/loader/agent-results.test.ts:42`

The fifth test's exact postimage SHA-256 is
`c86872c5b6801dc2b818a9c7407cc9e11defbfa68a752fea2f78dd2147de6bd4`,
matching the independent sidecar's proposed one-literal edit. Its full seven-case
suite passes, including the restore and warning assertions after the formerly
failing line. No historical v6 marker is rewritten or weakened to an either/or
assertion. The genuine v6 fixture and compatibility test hashes equal their
provisional counterparts.

The cleanup test filters the call-through spy by receiver, retaining an exact-one
assertion for non-PromiseReplay contexts and its `finally` restoration. Independent
native lifetime tests again observe:

- Ordered v6: one run-local host-context disposal, zero shared temporary disables.
- Fresh v7: one run-local host-context disposal, four shared temporary disables.
- Successful and throwing callbacks retain their live store across an await; an
  `AsyncResource` created inside the callback sees no store after final disposal.
- Parse failure still disposes its sole run-local receiver exactly once.

Native `AsyncLocalStorage.exit()` temporarily disables its own shared context;
those calls do not constitute multiple disposals of the separate host context.
No mock replaces the real disable behavior.

## Original native inputs and fresh processes

Both unchanged approved sources execute natively first as exact-byte data-URL
modules, with bounded pure boundary functions and the original raw native Promise
fixtures. No caller-side Promise wrapper, private conversion adapter, provider
proof or replacement input Promise is used. Source SHA-256 values remain:

- Single: `21004b9bd197084cdfc54b678a69094d9fc2ca776710fd773f57c6bef753c1a8`.
- Full: `94f71537e4d19ff33a45cb950607c4e1eec1922276f15825166e4658cc64e9ff`.

The independent capture then runs each source on the exact ordered production
preimages and on the final built API. Ordered preimages are bundled in memory
only; no source file, marker or historical capture is swapped on disk. Both
actual automatic checkpoints and completed checkpoints are retained. A bounded
`Date.now` 0→2 test clock triggers the automatic checkpoint scheduler and is
restored before child processes; it does not supply a replay outcome or alter
source/native values. The snapshot backend releases the held boundary only after
an actual snapshot write.

**Eight fresh child processes pass**: two sources × automatic/completed snapshots
× parsed-object/JSON-roundtrip representations. Children receive only source,
saved snapshot bytes, expected-output evidence and real bounded boundary
capabilities. They receive no original or replacement Promise inputs and make
zero provider requests. Every child checks:

- Complete output graph, including object prototypes, property descriptors and
  reference identities, against that same uninterrupted capture.
- Exact expected boundary calls for an interrupted continuation, or zero calls
  for a completed replay.
- Unchanged input snapshot bytes and a subsequent `jobs-v7` checkpoint.
- Exact serialized initial-input, replay-journal and PromiseReplay metadata
  against that same capture's completed checkpoint, without UUID/counter rewrites.

Single returns exactly `{value:7,sameHandle:true}`. Full typed output graphs are
identical between ordered and candidate runs. **PPR1 remains distinct**: native
full aliases are `[true,true,true,true]`; ordered and candidate full aliases remain
`[false,false,false,true]`. The single/full input-journal row counts remain **1/5**,
not a memoization repair. Full native values, full modeled values, typed graphs,
descriptor/prototype evidence, complete traces and each child outcome are retained
in `fresh-original-recovery-final.json`.

Raw initial-input metadata prototype-sensitive equality is measured separately
from serialized equality; all eight observations are true in this built-API
execution path. Earlier captured prototype qualifications remain preserved, not
rewritten into a universal claim. The output-root null prototype is also retained
and is verified on both ordered and candidate runtimes.

## Historical v6: positives and preserved negatives

`historical-v6-fresh.json` records **14 further fresh processes**:

- Six genuine original saved/completed data, guest-Promise and completed-host-call
  histories pass. Each performs three generations: **18 continuations** total.
  All emissions remain v6; initial-input/journal/PromiseReplay metadata stays
  exact. Only the first saved continuation repeats `boundary("before")`; completed
  reads and later boundaries do not repeat, with zero provider requests.
- Eight historically broken raw-v6 snapshots from the two preserved independent
  cohorts match their original snapshot hashes. Public restore accepts each, then
  execution produces the exact original `TypeError: Promise replay references
work not created at this position.` No boundary or provider call occurs, and
  input bytes and v6 markers remain unchanged. Full actual error stacks are kept.

The 59-case package suite additionally rechecks all **36 preserved v6 generation
records** and nine captured interrupted checkpoints, including failure replay,
as well as four ordered raw-v6 negative controls. All succeed under their original
positive/negative assertions. These cases are not converted into blanket version
refusals or falsely labeled retroactively repaired snapshots.

Thus the changed fresh scheduling mode does not discard working v6 histories.
The old raw-v6 limitation remains explicit; no new major/migration exception is
requested on its account. Unsupported historical formats retain their existing
guard and are not confused with supported v6.

## Independently recompiled 24-root type qualification

The actual TypeScript 5.9.3 compiler is rerun twice with identical configured
ES2022/NodeNext strict options and the same **24 roots**. The baseline compiler
host reads the ten exact frozen ordered preimages in memory; all introduced roots
remain present in both programs. The fifth agent-harness test and the shadowed-array
test are explicitly included on both sides, addressing the sidecar scope gap.

The programs independently produce **56 diagnostics each**. Complete diagnostic
records retain file, category, code, multiline message, start, length, line,
column, source hash and exact source span. All **112 source anchors** verify.
Canonical signature multisets are equal, retaining multiplicity, and match the
author's captured signature hash:
`530fba17d9b4808edeb86e1a33f88431758174c6b2e449959eeb51fc3eaa0333`.

Distribution remains 9 in `interp/methods/function.test.ts`, 2 in
`run.references.test.ts`, 16 in `runner/signal-dump.test.ts`, and 29 in
`snapshot/restore.test.ts`. The two `run.references` line shifts remain explained
by the existing added import, not suppressed. The author evidence's prose method
sentence still says “23 root files”; its actual command, numeric count, root list
and this independent compilation all establish **24**. This stale prose does not
change the verified scope or make the expanded failing gate green.

The independent numeric `DiagnosticCategory` value 1 and the author's string
`Error` are the same TypeScript enum entry. The final cross-comparison uses that
explicit naming convention, retaining the original numeric diagnostic records.
No category, message, source span or diagnostic is dropped. The initial enum-format
comparison failure remains in the first comparison artifact.

## Prerequisites and report-only formatting

All 50 prerequisite paths remain segregated from the 22-file PPR2 delta: NUM,
AW-final, OBJ2 including the three-path shadow supplement, CBI, AR-final and AR's
independent report. Five paths overlap and compose through the recorded ordered
preimages. AW's final ten-path scope and AR's ten delta paths plus independent
report are retained. Shadow adds no production code. The 999 combined cases and
full root run cover AR/CBI controls as well as the 23 shadow cases.

The authorized local publication report replacement changes only six table
formatting lines, including delimiter padding. Its exact old/new hashes are
`c4aa60597ee6f90d28df1596842b68317dafdf0190f6a42c176b0b6af0b6ae07`
and `61fc2775697e7062b334b60f1148251c6f98b03fd34a0b9b7b8196612a425fa7`.
Independent sandboxed Pandoc parsing and rendering produce identical complete
ASTs and identical HTML. HTML SHA-256 remains
`dc4c84714faa62138ae6213d9863c71485751d703171cbf0c498bea3151a53ed`.
All 16 original sidecar files and its manifest
`45f75c27e448105247ebcd90fa1c529b54530e4b2859c54ba7f3d3339cdbf6be`
remain preserved in the final input capture. No original sidecar or old report
was rewritten.

## Preserved unsuccessful validator attempts

These were validator instrumentation/setup issues, not waived production failures:

- First fresh-recovery attempt compared a modeled null-prototype return object
  directly with a JSON-parsed plain object. Its failure log is retained. Actual
  ordered execution confirms the same null prototype; the final oracle is
  stronger, comparing complete typed graphs, including prototypes/descriptors and
  identities, rather than erasing them through JSON normalization.
- The first in-memory ordered bundle used CommonJS resolution for ESM-only
  package exports. Its six resolution errors remain in the first probe log.
  Using native ESM resolution fixes the helper; no runtime source changes.
- The first author/independent diagnostic comparison compared enum number 1 with
  enum name `Error`. Both actual compiler programs already had equal 56-diagnostic
  multisets; the exact enum-convention reconciliation is retained separately.
- An initial report helper treated changed table-rule dash width as changed cell
  content. The completed proof checks all actual cell text and alignment plus
  independently recomputed complete AST and HTML equality.
- One metadata inspection assumed the final manifest's `historical` field was
  an array; it is an object. This inspection error changes no source or gate.

All earlier author and independent RED captures, genuine historical snapshots,
and this review's unsuccessful attempts remain available. No assertion was
weakened, test excluded or unrelated type fixed to reach the verdict.

## Final packaging and handoff

No READY publication delta is frozen because fixture closure failed. The HOLD
report, all passing runtime/compatibility checks, qualified type failures and the
failed/positive-control publication projections are sealed separately under
`out/safejs-ppr2-final-independent/hold/manifest.json`. The input author's 22-file
delta and ten ordered preimages remain immutable; its 50 prerequisite paths stay
separate. The repaired final publication scope must include its required fixture
data rather than relying on non-publication validation-support paths.

The reviewed source remains byte-identical to the frozen author candidate. No
production or existing test edit, Git command, commit, push, README edit, original
audit read, security investigation, real provider request or home-configuration
edit was performed. Root should request the precise fixture/path repair above.
Runtime source hashes have not changed, so this finding does not claim a PPR1
runtime regression, but PPR2 publication approval and a READY seal must wait.
