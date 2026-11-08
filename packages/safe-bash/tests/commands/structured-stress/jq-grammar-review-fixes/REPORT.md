# jq two-defect source-fix handoff — August 27, 2026 UTC

**Both bounded fixes delivered; different independent review required.** This
is source-author evidence, not self-acceptance, full jq parity or superiority.
No delegation. Final structured source remains frozen.

## Identity and changes

- Starting source: `b9187c0f601c278b334f5a391d552c38c433444c`;
  structured SHA-256:
  `120a10c34d96b26f584c6e4349ef9098c0537d76952078e70e9ce6ab5c3f0176`.
- Different review read unchanged: `0f82d80bde6581dee8a8143a924a04950f5b072b`,
  including its NOT ACCEPTED report, review JSON and frozen native vectors.
- Source + owned README commit: `09926fb67452ca7db9bd793d87b78d2f41ff82be`;
  final structured SHA-256:
  `913886e89fce8626d28f957d978243e3b8dd6bf94dd14348f5331f47607b4fb1`.
- Production changes: register `isfinite/0`; implement numeric-and-not-infinite
  (NaN true, nonnumbers/infinities false); exclude containers from ordering's
  identity shortcut. Equality's identity shortcut stays unchanged. Existing
  numeric, finite, Unicode/key ordering and cancellation paths remain; alias
  ordering now charges recursive work rather than returning free equality.
- README reconciles delivered grammar/nonfinite/diagnostic support and remaining
  profile limits. It explicitly records root's origin-based stdout/stderr host
  exception policy: JqError/EIO identity is retained, not converted to jq status
  or fallback diagnostics. This **observable typed-sink behavior change** was
  already present in the starting grammar source; it is not a new source change
  here, native parity, or a stale-native assertion. Canonical sink reconciliation
  stays separate and pending independent test-only review.
- No public TypeScript API, runtime dependencies, root/package, filesystem,
  shell, archive, network or shared-contract edits. Four source paths only;
  `audit.json` records their exact diff and hash.

## Exact unchanged before/after

Every entry below was freshly executed on **both source and full emitted root**.
Each number is per entry, not a source/compiled sum. Native bytes were not edited.

| Cohort | Before | After |
| --- | ---: | ---: |
| Whole main, 256 vectors | 790/790 | 790/790 |
| Original42, included in main | 84/84 | 84/84 |
| Whole legacy94 | 376/376 | 376/376 |
| Independent35 | 174/178 | 178/178 |
| Four focused reviewer vectors | 12/16 | 16/16 |
| Aliased-NaN vector, included above | 0/4 | 4/4 |
| Four new bounded neighbors | 8/16 | 16/16 |

Independent35's exact `nonfinite-type-copy-predicates` prerequisite improves
**0/4 to 4/4** in each entry; its focused replay is duplicate evidence, not
additional credit. Whole main/legacy/independent aggregate: **1340/1344 to
1344/1344 per entry**, excluding reviewer/neighbors and duplicate original42.
Legacy's older baseline **45 exact / 49 different (180/376 executions)** remains
preserved in unchanged historical evidence, not rewritten as a historical pass.

The exact reviewer aliased-container input still produces same-reference
equality true and NaN-descending ordering `[true,true,true,false,false]` in its
first four rows; finite/infinity control rows remain unchanged. New neighbors
cover copied predicates, decimal overflow/arithmetic, nonnumbers/Boolean truth,
generator ordering, distinct nested containers, scalar identity, finite numbers,
infinities and Unicode keys. Only four new vectors, not a Cartesian expansion.

All original schedules, endpoint empties, exact status/stdout/stderr bytes,
namespace/file effects and real public Shell pipelines are retained. Adapted
runners require the explicit new source hash; old pinned runners are unmodified.
Raw before, precommit-focused and committed after artifacts remain separate.

## Safety, regression and build results

- Original host stdout identity/cleanup/no-extra-I/O: **8/8 source + 8/8 compiled**.
  Additional runtime/preflight stderr failures: **8/8 + 8/8**. These are host
  contract proofs, not native parity. No extra acquisition/write or retry;
  started iterators close, preflight-failed input is never acquired.
- Unchanged seven failure boundaries: **7/7 on each of three repetitions**.
- New bounded limits/cancellation tests: **6/6**. Alias recursion exhausts steps;
  equality keeps identity; abort identity, arity preflight, maxResults,
  maxOutputBytes, optional-filter limits and backpressure cleanup pass.
- Unchanged grammar author: **2157/2157**. Historical238 **238/238** and nearby117
  **117/117**. Author114 remains **113/114**, with the unchanged typed-sink red.
- Unchanged broad canonical suite: **1550/1580, 30 red**. All 30 failing names
  exactly match the different review's observation. No assertion was edited,
  weakened, skipped, or silently reclassified. The typed-sink red is included,
  not a 31st additional failure. Separate canonical native/policy review remains.
- Owned, reviewer-scoped, author-scoped and **global TypeScript all pass**.
  Unlike the earlier review's global-type failures, this fresh run exits 0;
  that does not overwrite the older failure evidence.
- Full `tsconfig.build.json` in-memory emit: **520 outputs, zero diagnostics**;
  emitted root imports and all compiled cohorts/host checks pass. Runtime source
  imports are rejected. No `dist` writes, selective subtree build or private deps.
- Integrity checks: 44 old reviewer files, 235 historical files, preparation
  manifest and 36 canonical test files remain unchanged. Evidence-only integrity
  tests verify the owned seal and denominators; these are not native cases.

## Snapshot and scope limits

Before cohorts ran 02:25:09–02:25:15 UTC; committed after cohorts ran
02:28:40–02:28:45 UTC. Their respective product hashes were
`814677f51b9243d8eec6775a7f14700cdcb2624041293db971cfa1cdbd43f3e1` and
`1762b02d6655fb30647d760ca59928157ce7c972e78ba58e30dacef9a3f2cd30`.
All recorded validation phases were internally product-stable; **zero** drift
reruns were needed. This is still a shared dirty worktree, not a clean HEAD or
cross-worker acceptance. Complete snapshots, tooling hashes and timestamps are
retained in artifacts. Actual recorded work is minutes, not the requested72h.

Native oracle: pinned `jq-1.7.1-apple`; four bounded neighbors and five existing
vectors captured twice before edits in an isolated empty cwd, with 2-second
watchdogs and 64-KiB capture limits. No unsafe huge native workloads. Primary
research used the official jq1.7 manual and tagged jq1.7.1 `builtin.jq`, `jv.c`
and `jv_aux.c`; URLs and findings are in `audit.json`.

Remaining limits include unsupported broader jq grammar/builtins/flags, the
documented numeric and diagnostic profile boundaries, logical rather than hard
resident-memory limits, non-preemptible synchronous work and uncooperative host
operations. Existing canonical reconciliation and different independent source
review are not closed by this author handoff. No new shared lifecycle/API policy,
full shell/backend claim, universal jq compatibility, or 72-hour completion.
