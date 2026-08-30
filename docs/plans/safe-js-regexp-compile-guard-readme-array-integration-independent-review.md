# Guard README on released Array: independent review

## Decision and scope

August 30, 2026. Aquinas independently reviews Curie's documentation integration.
**DOCUMENTATION CONDITIONAL READY:** no documentation defect remains in the
reviewed two-bullet integration. Final independent guard source acceptance,
current publisher gates and paired guard publication are still required. This
is not approval of the complete R7 source implementation or its runtime results.
It does not claim the guard is already available in published Array 13.0.3.

Author manifest:
`/Users/kjopek/Workspace/poe-code-safe-js-guard-readme-array-integration-author/out/safe-js-guard-readme-array-integration/release-gated-candidate/manifest.json`,
SHA256 `a55a4ea8286bd87d8b86f89601058bd19a537a3c58dd963b955eda752cdb8262`.
Source prerequisite:
`/tmp/poe-safejs-compile-final-author-r7.gEcwBs/manifest.json`, SHA256
`a2078d725c4f24d1b611bfbcf45c2c6d173d53d5e47e4ebb5a314c96bb6e3774`.
The source manifest is at the R7 directory root; its postimages are under
`candidate/`. There is no substitution with a different source candidate.

The root reports Laplace STATIC READY and ongoing fresh broader validation.
Independent public pending/completed regex replay remains gated on that result.
The author's earlier “held for CPU” timing description is historical; neither
that description nor this newer coordination update is a runtime PASS receipt.
No final source or public-replay approval is inferred here.

## Exact current base and three publication paths

Fresh isolated main clone:
`/Users/kjopek/Workspace/poe-code-safe-js-guard-readme-array-independent-20260830`.
Clone followed by `git pull --ff-only` exited 0, already up to date at
`8a0a547d26e89e470cc0c74d965f3b099e8a31e9`. Ancestor/root AGENTS were read;
no additional instructions exist in `docs/AGENTS.md` or `docs/plans/AGENTS.md`.
The reference repository supplied Git objects only, not shared writable modules
or caches. No dependency installation, source overlay or target build occurred.

Exactly three publication paths are selected:

| Path                                                                                     | Current-base preimage     | Postimage owner  |
| ---------------------------------------------------------------------------------------- | ------------------------- | ---------------- |
| `packages/safe-js/README.md`                                                             | Present, exact hash below | Curie, unchanged |
| `docs/plans/safe-js-regexp-compile-guard-readme-release-handoff.md`                      | Absent                    | Curie, unchanged |
| `docs/plans/safe-js-regexp-compile-guard-readme-array-integration-independent-review.md` | Absent                    | Aquinas          |

The README preimage is 51,192 bytes, SHA256
`b961c0130dad973641522ca25183b742389d0c8889caa6105a975107c083f2f3`.
The captured preimage, current Git blob and clean review-workspace README are
byte-identical. This is the corrected Array postimage previously reviewed for
publication, not the older pre-Array README. The two new plan identities are
absent at the exact current commit; they do not replace published plans.

The new README is 52,386 bytes, SHA256
`914eb56eff8eda9857ae51b687b630bb5e420ba415be0ff5eb1b409fc7f68b38`.
The author handoff is 8,960 bytes, SHA256
`d63565d034650efb043fa2d6d4b515c46d6526fe07a3ccc514e0e54215612084`.
The final manifest binds this report's exact postimage and the three-path patch.
None of R7's 34 source publication paths is included in the documentation delta.

## README preservation and historical approval

Only the two Gotchas bullets beginning at `packages/safe-js/README.md:459` are
added. They are byte-identical to the earlier guarded-regex author packet:
`41f8886eb5abbfa44a3c4a44e55529b4ba2b06eee9cff638ff856ff141bce7c4`.
Removing those exact two added lines reproduces the complete current README
preimage, not merely its examples. A readonly three-way merge of the historical
guard delta onto the current Array README also reproduces the new postimage.

All eight fenced examples and every other README byte are preserved. The
released Array wording still distinguishes twelve iterative live-read methods
from sort's initial collection, comparator calls and initial-range writeback.
Stable ties do not promise native comparator traces. Its completed-checkpoint
and pending-operation qualifications are unchanged. String, Float, locale,
Map/Set, host-policy, browser/FS and canonical API content are untouched.
There are no new examples, CLI examples, flags or language-support claims.

Historical independent guard docs manifest:
`/Users/kjopek/Workspace/poe-code-safejs-fs-type-timing-independent/out/safe-js-regexp-guard-readme-independent/release-gated-static-20260830/manifest.json`,
SHA256 `91bcaa30f0f554213d8f87c203ac95e9934bd6e7d39337bb90b5b61fc82d072a`.
That packet and its earlier source/runtime qualifications remain immutable.
Its conditional documentation approval is not treated as R7 source approval,
and its old README preimage is not reused for this publication.

## Bounded R7 source-to-claim checks

This is targeted readonly contract inspection. Selected source bytes are
authenticated against R7's manifest and recorded with exact hashes and relevant
line excerpts in the independent evidence. The whole source capsule, its tests
and runtime archives were not rehashed or reexecuted.

- In `src/interp/interpreter.ts:446`, the per-node context forwards both reads
  and writes of `generatorResume` to the original context while retaining the
  compilation scope. This supports the claimed ownership context without a
  new public option. It does not itself establish fresh generator replay PASS.
- In `src/run.ts:218`, executable Module parsing and node validation precede
  source hashing. A regex-bearing Module uses `hashParsedAst(module)`; otherwise
  `hashSource(source, operation.owner)` remains. `src/parse/hash.ts:9` retains
  the legacy single-node parse followed by Module fallback. The regex branch
  therefore avoids those actual duplicate parse attempts rather than charging
  less for compilation work still performed. There is no new compile cache,
  public AST-input option, relaxed ceiling or claimed old-capture migration.
- `src/parse/parser.ts:615` constructs the executable Module with owned
  compilation, IDs, import-meta-assignment validation and cleanup. The exported
  internal `findRegexLiteral` traversal identifies the relevant AST branch;
  this is not native function execution or a new documented guest API.
- The R7 `budget.ts`, `regex/compile-guard.ts`, `values.ts` and `host-bridge.ts`
  hashes equal their previously inspected R5 postimages. The six existing
  `BudgetOptions` fields remain unchanged. Fixed source/flag lengths, depth and
  allocation ceilings remain owned compiler limits, not new public options.
- `RegexCompileGuard.work` still calls `Budget.visitNode` for actual units.
  Preflight, allocation and retained-data accounting remain. The WeakMap stores
  compiled-data accounting metadata; no new reuse cache is introduced by the
  R7 hashing branch. Avoiding redundant work does not justify discounting
  physical reconstruction that still takes place.
- Standalone `interpret` acquires ownership with reset false; `run()` acquires
  with reset true. The current pre-guard `run.ts:208` already calls
  `budget.reset()`. Idle standalone reuse does not replenish allowances, while
  public run keeps its existing per-run reset. The README is not claiming every
  reuse has identical counters or equal tight-budget acceptance.
- `Budget.acquireCompileOwner` rejects a different active owner or an obsolete
  generation; active reset rejects. Same-owner nested use is not blanket banned.
  The exported wrapper in `host-bridge.ts:714` reacquires its captured owner
  before callback work, preserving the stale-wrapper restriction after a reset
  or new run. This statement concerns host-callable wrappers, not unrestricted
  native RegExp calls or all possible host reflection.

These checks preserve the two bullets' scope: owned compile checks before VM
entry and at the covered ingress/reconstruction boundaries, existing Budget
limits plus fixed compiler ceilings, physical work distinct from logical replay,
and current ownership/reset rules. The text promises neither a native matching
fallback nor universal native CPU, resource or security protection. No new public
options, environment variables, CLI flags, regex syntax or regex flags are
documented. Equal tight budgets need not accept both original and reconstructed
executions; deleting redundant parse attempts does not change that qualification.

## Evidence limits and remaining release conditions

R7's manifest has 34 prerequisite paths: 23 production, nine test roots, one
fixture and one source plan. Root attributes Laplace's static verification of
34 postimages, 23 preimages and 11 absences. That static result is not a fresh
broader/default-suite or public replay result in this documentation lane.

R7 author counts, historical R5 examples/screenshots, R6 failures and the
preserved R7 fixture failures retain their declared provenance. They are not
renamed fresh independent PASS results. This reviewer does not claim all source
tests, builds, types or lint pass. The author handoff correctly distinguishes
the genuine old-checkpoint pending control that intentionally reissues once
from a separate reconciliation case requiring zero additional host calls.
Independent pending/completed replay coverage is not inferred from that fixture.

Root must obtain final independent broader R7 acceptance, the required built
public observer correction and pending/completed regex replay evidence. Publisher
must verify actual intake preimages/dependencies and run applicable current
source integration/release gates. Publish these three documents only paired
with the finally approved guarded-regex feature. A later source revision requires
a bounded contract-delta check; this approval does not silently transfer to it.

The root reports Array 13.0.3 actually published and verified; this review does
not repoll npm or relabel it as a guard release. There is no standalone guard
documentation approval, no new version assignment and no successful future
release claim. The current README preimage must be rechecked if main advances.

## Document checks and ownership

The independent capsule authenticates the author's manifest and all eleven
indexed payloads, preserves the two author publication images unchanged, and
records the current preimages, identical two-bullet delta, eight unchanged
fences, selected R7 source identities, three document-format results and strict
forward/reverse patch checks. The new report's expected new-file diff exit 1
with empty whitespace diagnostics is distinguished from a validation failure.

Only small metadata/hash/format/patch operations run, using a previously owned
Prettier library read-only. QA is this agent-executed Markdown report, not a new
standalone runner. No target runtime, install, build, test, compiler, new example,
screenshot, original-audit read, security probe, source/author edit, shared README
edit, ledger/home/SKILL change, branch, commit or push occurs. No heavy worker is
started; all owned lightweight commands finish before sealing. Historical
captures remain unchanged. The original user checkout is untouched.
