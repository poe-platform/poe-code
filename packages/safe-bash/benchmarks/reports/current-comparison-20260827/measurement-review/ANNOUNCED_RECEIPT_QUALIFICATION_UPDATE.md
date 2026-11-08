# Announced receipt qualification update — 2026-08-27

**ROOT's scoped env source qualification is resolved for the matching frozen blobs. The active comparison continues unchanged.** This additive record does not modify the announced receipt, freeze, source, runtime, inputs, expectations, goldens, or main-cohort classification.

## Immutable identities and history

- Announced receipt SHA256 remains `c0f9468f33d1df5ec468bc98830c06fc8fcadb797f3595b0a7fa18f346f607a5`, checked byte-identical before/after this review.
- Candidate remains `e33974b8c643077453227a9679d8ceca8367998c`; feature `84ab66ca717e0dff21abf57051b41cb553f3c7f3` is its ancestor and has sole parent `b494675c34dc289f4ad4b10a9201e1211eb0a7d8`.
- `src/commands/execution.ts` SHA256: `61940d3b86593243c13cab716be87f84647e42b69476757482dfebafc7d693a6`.
- `src/commands/env-split.ts` SHA256: `b005331bff0dd207a65b9001d235020f005eed45b813cca912851502c3f9dcf4`.
- Both pins independently match candidate Git, feature Git, the actual frozen source archive members, frozen extracted files, and authenticated source inventory. The entire bound source archive and inventory hashes also match. No live product import is needed for this source-identity check.
- The old broad gate selected b494, immediately BEFORE env implementation. Its committed runner explicitly pins b494 and archives that selected revision. Both canonical env tests already existed at `db3680fcfa91a7fff6ca0dad332c297094d14783`, unchanged through b494/84ab; b494 lacks the parser and contains the prior execution implementation. Only those two product source paths change at 84ab. This establishes the source-history explanation, not a source-binding defect or a fresh replay of the old gate.
- Committed clarification `804cb6e6864e0c9f7a60a426567e57b48e254f71` and independent v2 review `8ab677479e0094ec0c6cdf90d1f0e87883b2f8dc` were inspected read-only. They are later report evidence, NOT required candidate ancestors. Their hashes and the exact blob/history proof are in `ANNOUNCED_RECEIPT_QUALIFICATION_UPDATE.hashproof.json`.

## Complementary env evidence only

The following are the different reviewer's committed results, not new executions by this measurement reviewer and not results from the active e339 comparison package. That review used its separately authenticated, physically moved 84ab package; only the specified matching source qualification transfers here.

| Complementary partition | Retained result |
| --- | --- |
| Revised packed supported core | 7/7 in each complete GNU env 9.7 reference, with Bash 5.3 and Bash 3.2 parents |
| Revised packed hosts | 5/5 executions in three IDs |
| Policy/input controls | 12/12 |
| Independent controls | 6/6 groups, 14/14 runtime variants |
| Entire packed native profile | 7/10 each: three shebang/kernel-profile losses remain |
| Hidden GNU env 9.7/Bash 5.3 commands | 39/42 strict native; three separate virtual-diagnostic checks do not erase native differences |
| Same hidden whole/protocol | 40/48 whole, including protocol 1/6 |

No pooling, union, additive main score, main-cohort insertion, golden replacement, or retrospective validation of the unchanged original invalid assertions. Hidden Apple-env/Bash 3.2 history remains separately qualified (23/48 whole, commands 22/42, protocol 1/6); it is not the packed GNU-env/Bash 3.2 profile.

The receipt's literal `independentFixtureValidity: UNRESOLVED` is an immutable creation-time statement now superseded by ROOT's source-bounded qualified env/v2 acceptance for these matching blobs. This is NOT resolution of all fixtures or broad native parity. env-S remains partial, shebang support unsupported, strict diagnostic/protocol losses retained; no release/global-green or whole-gate claim follows.

This review performs only bounded Git/blob/archive/receipt reads: zero product imports, measurement calls, env tests, native oracles, installs, or whole-gate executions. Only this additive measurement-review note and hash proof are written, sealed read-only after creation; no commits/staging. The active run and its process ownership are untouched. Stop here pending independent final result/table/cleanup review.
