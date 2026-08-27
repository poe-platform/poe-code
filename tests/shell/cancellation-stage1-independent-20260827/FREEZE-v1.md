# Independent Stage 1 semantic freeze v1

Date: 2026-08-27. Reviewer: independent delegated leaf (not Heisenberg).
Ownership: ONLY new files in this directory. No delegation, product edits,
public exports, Shell invocation integration, or broad product gate.

Candidate already exists: `6747227230cd770379148552d471621717b766d7`.
Author freeze: `7023c28229ecb7939aee5eb7ca0f52ac57c795bb`.
Author evidence: `3d247da92459f8526afaea42c0ce25b59f3bd263`.
This is post-source-commit, pre-source-body-inspection and pre-execution, NOT
preimplementation. Before this freeze the reviewer read applicable AGENTS,
author freeze-manifest, README, BASELINE, build config, evidence-v1/RESULTS,
and timeout design README (terminal output partly truncated). No candidate
helper body, author runtime fixture, cases.json, or negative fixture was read.
The declared profile is authoritative. Concrete TypeScript interface shapes
are not fully documented; read those next, then concretize these invariants.
Author's 38 literal cases, 22 runtime tests, and four type negatives are author
evidence, not independent counts; overlap will never be added together.

## Frozen obligations and expected outcomes

H01 Nested original identity: three owned generations, innermost abort then
outer then root. First delivery remains innermost's exact reason; open selection
improves to outermost invoke then root. Every report identifies the ORIGINAL
signal, role, and frame, never an intermediate merged delivery signal.

H02 Closed boundary: close an inner boundary after its local cancellation,
then abort its ancestors. Its delivery, selection and report origin stay local;
an open ancestor still improves. Repeat close returns the identical report.

H03 Equal/falsy siblings: independent sibling boundary reports for undefined,
null, false, 0, empty string, plus NaN and signed-zero discrimination. Genuine
explicit child cancellation may be replaced by an outer invoke cancellation;
an unreported same-reason rejection is unrelated and stays exact. A report
cannot classify a different captured reason. Root retains highest precedence.
Do not presume undocumented authentication against forged host objects.

H04 Fanout failures: at least two failing subscribers (one throws undefined,
one an object) interleaved with successful subscribers. All admitted callbacks
run synchronously in registration order, exact failures accumulate once, child
delivery/provenance is unchanged, and repeat close neither reruns nor duplicates.

H05 Borrowed leases: omitted options, undefined options, absent signal, and
undefined signal allocate no controller/listener/subscription. Closing leases
cannot close parent, exhaust its resource capacity, or detach its delivery.

H06 Admission priority: already-aborted root/outer ancestors skip getter;
a getter that closes parent and throws yields stable parent-closed failure;
each getter otherwise runs once. No child listener survives failed admission.

H07 First control versus settlement: control first, then invoke and root.
Delivery stays control; unrelated control execution failure cannot be replaced
by invoke deadline, while root wins. Preserve original control signal/role/frame.

H08 Capacity and reuse: independently exercise listener/subscriber and depth
bounds; denied admissions add no live resources. Close/unsubscribe permits
capacity reuse as documented, without closing unrelated siblings.

H09 Initialization rollback: fail listener admission after earlier successful
acquisition. Previously acquired listeners and parent subscriptions are removed,
exact primary failure survives, and subsequent valid child admission succeeds.

H10 Reentrant lifecycle: subscriber closes boundary during delivery, with later
subscribers and failures. Freeze only documented guarantees: no retained owned
listeners, stable close identity, exact delivered origin. Do not presume later
callbacks must run if explicitly detached by close during fanout.

H11 Strict declarations: positive readonly native signal/options, selection
discriminants and close report; malformed signal values rejected by targeted
diagnostics (not missing imports). Concrete rows after declaration inspection.

H12 Internal artifact: exact archived source compiles in isolation; copied/moved
emitted ESM + declarations execute the independent cohort without source/tree
fallback. This proves only a private INTERNAL module, never a package export.

## Negative controls and sealing

After source inspection create bounded, explicit counterfactual copies: lose
original provenance, disable capacity enforcement, omit listener cleanup.
Each must load/compile, then fail a relevant behavioral assertion; compiler,
fixture or loader failures are NOT kills. No product mutations.
Preserve failed runs and corrections separately, with no all-green rescore.
Authenticate raw commit/tree/helper blob and empty import closure; prove helper
absent at author freeze, author commit write sets, and frozen baseline hashes.
Archive only committed inputs, never overlay live product. Seal raw objects
needed for candidate identity reconstruction without assuming loose objects.
Inventory source/tool/fixture memberships including additions before/after;
record build/moved hashes, foreign index snapshots, and scratch removal.
Run only bounded local Node/TypeScript subprocesses; no native semantic oracle.

## Initial environment observations

Node v22.22.2. Initial HEAD aa4374b0ab5f0789e51026b7c6fe163c044a9a6c.
Index initially empty. Foreign work changed during reading: initial untracked
diff-patch native temp, expr nullable-hierarchy-v5 directory, search native temp;
later modified package.json, src/index.ts, src/plugins/index.ts and du files.
These are not reviewer inputs or reviewer-owned work and must be preserved.
