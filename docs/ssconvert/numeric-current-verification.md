# Current numeric-function verification

All 190 requested manifest functions and eight-field source descriptors are
registered: 101 math, 25 engineering, 45 complex, four floating-point and 15
number-theory. Independent source census and archive authentication matched
Gnumeric 1.12.61 SHA-256
`2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12`.
Registration is not a numerical parity pass. Exact full-domain compatibility is
incomplete; unsupported or unmeasured cells are not passes.

## Candidate and oracle

[numeric-current-candidate.json](numeric-current-candidate.json) binds the settled
scoped dirty-worktree source/test/generator/integration inventory. It is not a
committed revision or a full transitive runtime closure. The initial receipt is
preserved separately in numeric-current-initial-candidate.json. No README edits,
commits, push or publication were performed. Pre-existing and unrelated edits
were preserved.

The separate rebuilt ARM64 oracle profile is in
[numeric-current-native-profile.json](numeric-current-native-profile.json), with
binary, linked dependencies, plugins, packages, C locale and UTC. The official
archive and extracted primary source remain under out. Native ssconvert and
mpmath are isolated QA tools, never product dependencies or fallbacks. Although
the native binary SHA equals the historical profile, its dependencies and locale
were captured independently. Procedures are Markdown under docs/plans.

## Reproduced failures and changes

Original failing assertions preceded every repair. ILOG preserves released C
truncating integer division for power-of-two bases. ODD and EVEN round before
parity adjustment, preserving large representable integers and signed minimum
subnormals. EXP now uses the independently qualified captured native operation
profile after EXP(-1.1) failed with a one-ULP discrepancy.

Gamma uses paired Stirling/recurrence/log/exp arithmetic, rounded integer
factorials, negative admission rounding and single subnormal scaling. Native
x-1 admission rounding can deliberately differ from mathematical gamma; those
cases are retained rather than repaired toward a different specification.

Independent Bessel repair preserves source Debye B1 polynomials, phase and
amplitude recurrence, reflection FMA order, corrected fourth-root rounding,
source A3 steepest-descent integration and acos evaluation. Overflowing Y times
zero propagates #NUM! during negative-integer reflection. The fresh higher-order
cohort exposed an inherited order<2 selector restriction: 4/126 matched before
repair, then 125/126 after source route correction, and 126/126 after matching
source cosine FMA operation order. All fixes have original small regressions.
The private captured log1p helper repairs 44/46 differing primitive observations,
but its full public domain remains unqualified; LN1P was not silently wired to it.

## Deterministic measured results

| Cohort | Exact native matches | Remaining mismatches |
| --- | ---: | ---: |
| Mixed groups, seed 20260919 | 138/138 | 0 |
| Direct EXP/LN1P primitives | 33/34 | 1 |
| Bessel main, seed 6197301 | 536/536 | 0 |
| Large-order B1, seed 6192907 | 126/126 | 0 |
| Phase holdout, seed 6173304 | 120/120 | 0 |
| Low-order A3 holdout, seed 6183305 | 120/120 | 0 |
| Higher-q A3 holdout, seed 6183306 | 73/120 | 47 |
| Negative-integer Bessel controls | 12/12 | 0 |
| Trigonometric primitives, seed 6192908 | 2048/2048 | 0 |
| Gamma, seed 202609191 | 233/233 | 0 |
| Gamma reflection, numeric and HEXREP | 16/16 | 0 |
| Gamma near-pole HEXREP | 6/6 | 0 |

Complete minimized observations and high-precision values are retained in the
numeric-current-*-comparison.json artifacts. The initial mixed cohort remains
133/138 in numeric-current-initial-comparison.json; it is not rewritten as a pass.
Mixed references use mpmath 1.4.1, Bessel references mpmath 1.3.0, at 100 decimal
digits. Native finite Bessel truncation deliberately differs from high precision;
the maximum measured main-cohort relative error is approximately 2.308e-13.
Raw CSV subnormals are lossy: gamma subnormal verification uses native HEXREP.
These checks are deterministic semantics, not bounded performance measurements
or accuracy proofs across all binary64 inputs.

Unique cancellation reason identity and no work after tick 7 passed; an admitted
B1 success takes 63 ticks. Independent frozen-input/error controls passed 11/11.
Actual SDK/virtual command tests exercise shared engine, injected byte I/O,
errors and diagnostics, ordering, matrix calculations, unchanged namespace,
input immutability and original/checkpoint/replay execution. The inspected final
CLI preview screenshot is readable and shows all five groups plus gamma,
Bessel and EXP corrections. Its injected codec proves presentation and execution,
not full real-format native serialization.

## Gates

The settled package run passed 2,545 tests in 102 files, with no skips. Maintained
package ESLint, production TypeScript and test TypeScript passed. The selected
uncached ssconvert build passed. Rebuilt safe-bash command/SDK/replay integration
passed 33 tests without skips, and command-source ESLint passed.

The final uncached 18-workspace safe-bash build closure and full root build
passed on the settled structural candidate. The full maintained `npm test`
completed with exit 0, including all declared workspace unit tasks and native
pre/event/post scripts. The runner derived 85 workspaces, 33 build tasks and
53 unit tasks from maintained declarations. No-test and manifestless entries
are not passes. Safe-bash reports 44,081 passes, 831 skips and two TODOs;
safe-js reports 31,121 passes and 48 skips; safe-python reports 84,610 passes.
All framework summaries and the runner membership receipt are retained in
[numeric-current-gates.json](numeric-current-gates.json), including other
skips/TODOs rather than collapsing them into passes. The root post-test stage
passed two tests. All 221 source and 424 compiled artifact hashes remained
unchanged after the completed full run.
An overlapping early build failed the compiler-input mtime guard; a subsequent
serial build passed. The broad uncached unit attempt suffered ENOENT for
op/dist/secrets.js when a concurrent root build replaced compiled dependencies.
It cannot certify the candidate; the subsequent serialized full run above
completed on the final receipt.

Two root lint attempts exited 2 with incomplete receipts, zero lint errors and
four warnings, because repository-ancestor directory size changed during active
build/test execution. The guards were not weakened. Separate root lint:types
(including NodeNext/Bundler Node/DOM contract cells) and lint:workflows passed.
The final serialized `npm run lint` completed with exit 0: 16,660 configured
subjects admitted, zero ESLint errors and four warnings in unrelated files.
Its complete receipt, root TypeScript, all declared NodeNext/Bundler Node/DOM
contract cells and workflow lint passed. The compact gate evidence retains
the warnings and receipt scope.

The maintained safe-bash typecheck failed the root public SafeFS shared-runtime
export prerequisite before builds, consumer groups or runtime cells executed.
Cleanup passed; those unavailable cells remain unverified. No unrelated export
metadata was invented or overwritten to hide this limitation.

## QA harness failures and remaining limits

Malformed XML and a missing sheet index in early oracle fixtures produced no
numerical observations and are excluded. Corrected original fixtures use the
verified legacy namespace grammar. A JSON trace lost input negative-zero sign;
explicit input bits repaired the trace. Parallel holdouts initially overwrote a
shared native workbook; contaminated captures are retained separately and unique
native paths restored valid isolated results. These are harness failures, not
product passes or numerical mismatch denominators.

Measured unresolved values include LN1P(.33688260287586475): native
0.29034048788903205 versus product 0.290340487889032. The cosine
discrepancy at 137330.13360794372 was subsequently repaired by the small-angle
Taylor contraction, with the original failure retained in independent evidence.
The 47 higher-q A3 residuals remain exact failures without speculative attribution.

The historical numeric-verification.md retains additional limits: IMIGAMMA native
critical diagnostics, unstable negative pseudoinverse thresholds, native extreme
pseudoinverse crashes, unsupported ODF placeholders and unmeasured runtime,
locale, formatting, codecs and lifecycle variants. Phase inputs above 1e12 and
full-domain special-function accuracy remain unverified. Realm/public-consumer
cells blocked by the SafeFS prerequisite remain unavailable. No full parity,
release, remote delivery or wall-clock performance claim is made.

The final private log1p primitive replay matches 7,490/7,496 native calls,
leaving six calls at three inputs; four are introduced differences among
previously matching JavaScript primitives. Native acos(.8904620567924949)
is 0.4724367827108452 while the current high-precision algorithm returns
0.47243678271084516; two captured calls differ. Correct mathematical rounding
does not certify native compatibility. An alternate source phi FMA order
reduced higher-q matches from 73 to 71 and was rejected as a negative control.

After the Taylor repair, fresh source replay against immutable separately
captured native observations preserves 138/138 mixed cases, all Bessel cohort
counts, and all gamma/HEXREP counts. No native execution is claimed for these
post-container-cleanup replays. The final scoped content receipt aggregate is
`bbaf00e24fa4b1e843a2a502b520731385bd8626c78ac7e03f7334d2d3ef26e3`.

Final structural review exposes the existing piReduced implementation directly
for new cosine callers. The first refactor left three stale unary registrations;
68 package files failed module admission (34 passed), and independent replays
failed before numerical observations. Root fixed the registrations; the complete
package rerun passed 2,545/2,545 tests and independent numeric/cancellation
replays restored the reported counts. This failure was investigated and retained,
not dismissed as pre-existing. Earlier broad attempts interrupted for changed
source inventories remain incomplete and do not certify this final receipt.

The authoritative final Bessel source receipt is
[numeric-current-bessel-final-structure-replay.json](numeric-current-bessel-final-structure-replay.json).
The earlier settled and post-Taylor receipts remain superseded historical
observations with their original source hashes; they do not bind the structural
follow-up. The refreshed compiled artifact receipt binds the final source inventory.

An independent frozen-input assertion initially failed because a deliberately
owned null-prototype value was compared strictly with a normal-prototype expected
object. Property checks and deep-frozen input immutability subsequently passed
11/11; product code was unchanged for that QA expectation correction.

Final serialized broad test, lint and build gates completed on the settled
receipt; the post-gate check found no drift in any of 221 source or 424 compiled
files. Gate evidence preserves exits, framework summaries, warnings, skips,
TODOs and unavailable cells. Owned temporary logs, drivers, workbooks, virtual
environment and screenshots were purged after evidence capture; downloaded
primary source remains only under `out`. No README edits, Git staging, commits,
pushes or publication were performed for this task.

The subsequent goal iteration repairs the measured **public LN1P** mismatch; see [current LN1P proof](ln1p-gap-proof.json). Its exact-addition192-bit series passes236 current native/public/220-digit reference cases and matching browser/worker qualification, with6443 maintained workspace tests and final lint/build passing. Historical receipts above remain unchanged. Private log1p/acos and Bessel holdouts are not closed by this public-entry repair.
