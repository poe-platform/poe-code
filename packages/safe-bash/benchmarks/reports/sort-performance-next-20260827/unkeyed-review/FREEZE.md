# Independent hidden holdout freeze

This verifier is not the optimization author. Before writing this freeze, only
committed prechange product source was inspected: dce6e3824d6de6d03490a531cf2bc7d2d279bb8c
(tree ba4c35fdbd3c6a1c7717249def3f955daace3c8b), plus original e090f29.
The author's baseline marker authenticates text.ts and internal.ts; both match
e090f29 exactly. No live text.ts, candidate diff, author helper, author tests or
unkeyed-author evidence was inspected. Exact candidate routing must come from
/tmp/sort-unkeyed-review-coordination.txt, never incidental HEAD.

## Frozen assertions

holdouts.mjs contains independent literal output/order expectations, including
exact decimal precision, prefix grammar, stable/unique/reverse equivalence,
whole-byte fallback, every excluded guard, binary/NUL, reused offset Buffers,
natural EOF, exact diagnostic/status/effects and cooperative cancellation.
Expected rows are serialized and hashed before any product execution. The
21 existing acceptance vectors are read unchanged from commit
68f037111981356823ad5fa1a58943e5231ccfd4 and authenticated by their frozen SHA256.
Existing native captures remain provenance, not a newly executed native campaign.
No baseline failure may be reclassified as a pass or silently rebaselined.

Eleven generic cap constructions are frozen now, before policy constants are
known. Later bind only author-disclosed entryCap and characterCap, preserving
construction and expected byte/status/effect assertions. Record literal values,
generated inputs and hashes. Limits above 100,000 entries or 1,048,576 retained
characters require a disclosed checkpoint rather than unbounded execution.
Character accounting means normalized whole plus fraction lengths; use exact
policy accounting separately if it conservatively charges backing bytes too.
Both below/at/above admission and empty-record entries must be accounted for.
Huge nonnumeric suffixes must not covertly retain uncapped Latin1 backing stores.
Cache saturation must fall back deterministically without rejection or truncation.

## Predetermined mutation intent

All mutations are bounded, isolated scratch-only derivatives of authenticated
committed inputs. Actual moved public-package results stay separate from any
instrumented/mutated proof. Choose decisive members, never change expectations:

1. Float/Number precision replacement: integer and long-fraction holdouts fail.
2. Remove whole-byte fallback or stable/unique preservation: tie holdouts fail.
3. Bypass guard removal, including explicit keys/check/b/f/plain: frozen public
   outputs plus private counters expose prohibited cache admission.
4. Remove entry admission cap: empty-entry-above private peak assertion fails.
5. Remove character admission cap, or reject rather than uncached fallback:
   characters-above peak or exact public output assertion fails.
6. Remove owned collector copy: offset borrowed-source bytes fail; source reuses
   storage only after yielded fragments are consumed, including natural EOF.

Private instrumentation must be constant-sized per observation (counters only,
no retained record map), authenticate exact replacement anchors/hashes and
report parse/comparison/padding/cache hit/fallback/admitted peak counts. Guarded
paths must have no cache construction/admission. Actual outputs alone cannot
prove caps. Instrumentation changes no public exports. A parse-count reduction
does not establish speed or total heap savings.

## Execution boundaries

Use existing compiler against exact Git objects, an isolated package build,
pack/extract and an actual move before importing public virtual-bash exports.
Normalize /tmp with realpath. Hash source, loaded modules, assets and inputs
before/after; reject product module fallback into the live checkout. Sort need
not load workers: authenticate available worker assets separately and report
zero worker launches honestly. One sequential child at a time; 512MiB V8 heap
flag, 90s wall watchdog, 8MiB combined logs, 5s cooperative command abort,
4MiB output bounds. Larger pinned limit tests, if run later, use streaming hashes
and explicit separate bounds. Await exact child close and dispose every Shell.
No new synchronous-sort hard-preemption guarantee is required or inferred.

No native/pathological campaign, 720 timing rerun, dependency/public API change,
numeric-key extension or speed claim is authorized. The historical pipeline has
zero numeric work and remains unresolved. All 48 old baseline mismatches remain
ineligible within the 720 denominator. This checkpoint is not full acceptance;
the wider pinned cohorts and candidate mutation/cap review remain obligations.
