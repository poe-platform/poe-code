# Independent review: DESIGN-ONLY / NOT PROMOTION

2026-08-27. Actual independent delegated leaf; no redelegation. Only new `review/`
files and task-owned OS-temp changed. Initial `c3e40f8b` stays guarded. No justified
production comparator is accepted. The bounded supplied-history model was reviewed
and exercised, but this is not regex matching completeness or engine acceptance.

## Authentication and chronology

Eight independent groups were sealed **before model code/results inspection** in
`a5c2aed54437f68dff5708a0e652fe1e72039c21`; `CONTROLS.json` SHA256 is
`7ea6cd225abeee23cad4f9fa323d889348a9b4b95e55c054a05fd8d29ba96d86`.
Normative report/reference ledger: `44eed610f6b656e8c6c78d60a48089569ed5b8d5`.
Independent32 seal: `c0aec9fc240f153e0fa18d6e2d1e291871dbe1eb`, manifest
`458c5c9e5def60b32d963572364998c463f3e185692f6a25ed09d6069f822589`.
All original nine frozen files and five normative files matched committed blobs.

At 22:21:16Z the author's candidate pointer was absent, so a design-only handoff
was being prepared. The author then sealed
`938fdbc6f128c5ba124d13879c3354a9ee46fc95`; its final receipt was authenticated
before completion of this review. Manifest SHA256:
`34efc77d4d53f1bed318f05ca2a948f86ab646ea155d53cadc236dc5004eca90`.
Model SHA256:
`f04c98a52967f904266660607b0ee2157518cf50d3da260a4aa2b47926c392a0`.
The exact scoped archive contained 28 design/frozen/normative files. No live product
overlay entered it. Later frozen baseline files were inert archived data, not run.

`AUTHENTICATION.json` records exact archive hashes, author receipt hash, and equal
pre/post complete entry inventories. Added files, directories and symlinks would
be detected within that archive; this is not a whole-repository audit. Source tree
at controls freeze and final check was `74ced3db47d5288bbd17cf9e27f181faa8f663ea`,
with no live tracked `src/` changes. No root/public integration occurred.

## Independently accepted parts

The declared finite constructor derives byte boundaries from plans and records
immutable activation trees, event snapshots, and capture-origin provenance. The
tests support branch-local skipped-descendant retention, actual reentry invalidation,
empty replacement, failed-branch isolation, required local empty counts, constructor
span checks, and refusal of foreign/unvalidated operands. Uncaptured AST nodes are
present, though their ranking is not correct under every proposed profile.

For the supplied operands, order is independent of all 24 enumerations of C1's
four histories; finite reflexivity/sign-symmetry/transitivity checks pass under
both declared profiles. W3 retains distinct histories despite the same final
semantic registers, and both profiles prefer its longer first body. No merging is
performed; this is not proof of any future dominance rule.

Zero work/allocation caps, exhaustion after an incumbent, cumulative failed-build
allocation, initial abort, abort after an incumbent, and a cooperative recursive
comparison abort all pass. These are logical model counters and synchronous
checkpoints, not RSS, arbitrary host preemption or event-loop cancellation latency.

## Six failed independent policy assertions

| Control | Observation | Meaning |
| --- | --- | --- |
| C1 AGGREGATE-v1 | P/aaaa `[a][a][a]` plus `a` outranks `[aa]` plus `aa` | The repeat aggregate span outranks first-body priority. Consistent with its declared experiment, but not either normative candidate's pair ordering. |
| C2 ITERATION-v1 prefix-star | Empty prefix/capture `aaa` wins over prefix `aaa`/empty capture | Reproduces the author's independently frozen prediction failure. |
| C2 ITERATION-v1 prefix-interval | Empty prefix wins over legal two-byte prefix | Same failure on the existing bounded-prefix input; not a new native corpus. |
| C2 ITERATION-v1 nested-prefix | Empty inner prefix wins over three-byte prefix | Earlier uncaptured priority is lost inside a capture as well. |
| C6 AGGREGATE-v1 | Zero occurrences outrank one participating empty occurrence | The shorter-list rule does not distinguish initial absence from END after participation. |
| C6 ITERATION-v1 | Same zero-before-empty result | Same structural disagreement, not a native acceptance claim. |

C1 is a **declared-profile difference**, not an implementation bug against the
author's own specification. C6 is a local repeated-subtree ordering probe derived
from the nullable history witnesses; the absent prefix would fail P's subsequent
backreference. It does not claim two accepting P/empty executions. Both profiles
follow their shorter-list definition, which remains incompatible with the
normative candidate's distinct initial-absence rule. No profile was silently fixed.

W4 selects B under both implemented dynamic-tree profiles. HNODE would select A;
HNODE is not implemented. HNODE/HTREE and AGGREGATE/ITERATION are not aliases.
No native vote supplies authority for choosing among them.

## Independent runtime evidence and correction

Author's archived `verify.mjs` was run **once**. It passed exact read-only replay,
preserving two failed frozen policy predictions: ten existing inputs, 22 supplied
fixture attempts, 19 eligible histories, three eligibility rejections, one extra
permissive-tail history, 62 permutation checks, 422 finite relation checks, and
20 named controls. These author denominators are not independent52 or frozen32.
See `author-replay.json`; the original author's capture remains unchanged.

| Independent group | Passed assertions | Failed assertions |
| --- | ---: | ---: |
| C1 order / enumeration | 5 | 1 |
| C2 uncaptured prefixes | 4 | 3 |
| C3 malformed structure / bounds | 11 | 0 |
| C4 branch-local lifetime | 6 | 0 |
| C5 required empty / optional eligibility | 5 | 0 |
| C6 context / END / absence | 5 | 2 |
| C7 work / allocation / cancellation | 8 | 0 |
| C8 retained history distinction | 2 | 0 |
| **Final total, eight groups** | **46** | **6** |

The first independent run had 50 assertions, 44 pass/6 fail. One failure was an
**adapter representation error**, not a model error: C8 compared entire env
objects, which include differing capture-origin activation IDs. Frozen C8 concerns
equal semantic final register state/spans, not equal provenance. The adapter was
corrected to project state/start/end, preserving origin metadata in the model.
Also, C6's combined check was split to expose both policy failures, accounting for
the two additional assertion rows. No frozen semantic expectation changed.
`attempt-01-runner.mjs.data` and `controls-01.json` preserve the original attempt;
`run-controls.mjs` and `controls-final.json` contain the corrected adapter/results.
The second run reuses the same groups and does not increase the input denominator.

Five focused in-memory mutants were killed on both attempts: firstDFS by encounter
permutations; capture-only by uncaptured-prefix assertions; skip-clears by D's
retained-reference construction; no-budget by initial and post-incumbent refusal;
badspan by malformed-bound checks. Each result records the mutated source hash.
They modify only in-memory model text, not the archived or live candidate. The
skip-clears mutant fails constructing a witness accepted by the original model.

## Unresolved policy and untested obligations

P/aaa `[aaa][]` plus empty reference consumes three but changes capture1 from
`[0,3)` to `[3,3)`. Both implemented orders prefer it when admitted. It is **not an
equivalent cycle**. Root's narrow completed `a` needs separately named optional-empty
eligibility; `LOCAL-TAIL-HYPOTHESIS` is conditional and stronger than cycle stopping.
Required counts and fresh child activations cannot be erased by parent progress.

The independently fetched Issue8 XBD 9.3.6 text explicitly rejects D/abab. TEMP
accepts `[ab][a]` plus retained `b`: a deliberate project-profile conflict, not
ambiguous tie-breaking and not a standards bug. `PRIMARY-SOURCES.json` records the
web attempt, exact fallback curl URL/body hash, and bounded original-author paper
checks. T17/BT19 regular-model comparison assumptions do not extend to arbitrary
backreferences, capture-changing cycles, or proposed state merging.

Still untested: arbitrary external event-log replay/origin validation; supported
activation-ID alpha-renaming; branch-alternation grammar and parser translation;
all accepting paths or actual regex acceptance; general total-order theorem beyond
the declared construction; prefix pruning or cycle-neutrality proof; physical memory;
asynchronous cancellation latency; actual worker admission/retirement/disposal.
Malformed foreign histories are refused by constructor ownership, not validated by
a general replay verifier. Host-object tampering is not a sandbox claim.

There is no actual worker here. Historical 137 controls were bound by the author,
not rerun by this reviewer. Native, product, worker, old-core/quota and historical137
execution counts are all zero. No main-thread RegExp or dependencies were used.

## Minimal next decision and reproduction

Select optional-empty eligibility separately from terminal ordering. Then resolve
uncaptured-prefix priority and enclosing repeated span versus chronological-body
priority using only existing prefix, P/aaaa, W3 and W4 witnesses. Do not change TEMP
lifetime or choose by native plurality. A worker-copy source experiment requires
separate root authorization and future cleanup/137 obligations; keep the live guard.

To reproduce, archive exact `938fdbc6` design/frozen/normative files into owned temp.
Run archived `design/verify.mjs` with the original repo `GIT_DIR` and archive
`GIT_WORK_TREE`; run `node review/run-controls.mjs /absolute/archive/.../model.mjs`.
The latter emits JSON and exits 1 for the six preserved failures; it writes no
evidence by default. Exact mutation anchors must match or the mutant is not applied.

## Seal and cleanup

Syntax, JSON, scoped whitespace, exact artifact hashes and complete owned-entry
inventory checks pass. The manifest's own hash is bound by the final Git commit
and requested candidate receipt. All children settled normally; no worker/server
was created. The owned archive, fetch directory and intermediate OS-temp files are
removed at seal. Only the requested independent checkpoint/candidate receipts
remain. Other workers' files, staging, native scratch and old evidence are untouched.
