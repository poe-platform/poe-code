# Independent final jq review — August 27, 2026 UTC

**Bounded jq source and exact canonical proposal approved and applied.** No jq
regression observed. **Not a clean full-suite/global-HEAD pass:** one dated
live-before-hash test remains red; final global typing has two unowned shell-test
errors, and the sole bounded compiled rerun crossed unrelated shell movement.

## Approval and application

| Role | Commit |
| --- | --- |
| Frozen source handoff | `09926fb67452ca7db9bd793d87b78d2f41ff82be` |
| Source-author closing evidence | `2dbb27c` |
| Independent PRE-APPLICATION approval, evidence only | `95966ca` |
| Exact native TEST-ONLY application, 12 paths | `50434b3` |
| Separate host-policy TEST-ONLY application, 1 path | `538a7f8` |

Neither source nor proposal was authored by this verifier. No delegation.
`PRE_APPLICATION.md` was committed before either application. The author's
closing marker was present first; README/REPORT and evidence match its commit.
Both application commits contain only their explicit manifest paths, with exact
after hashes; review artifacts are excluded. All edits used `apply_patch`.

Source SHA-256 remains
`913886e89fce8626d28f957d978243e3b8dd6bf94dd14348f5331f47607b4fb1`,
checked against the handoff before import and at every phase, including final.
Proposal `eab1d48a` native hash
`c83cd9adabd99925007bb79332899913829166ac21a6a25353dcfd199196627d`
and host hash
`18abf8765ce8474b30b0704063743f2e93217a19810a568160b4c30736187f0b`
are unchanged. R1–R4 approval reasoning is in the immutable pre-application report.

## Actual gates

Source/emitted entries are **per mode**, not combined totals; overlapping cohorts
are not extra credit. All test runs retain zero skips, cancellations and todos.

| Cohort | Before application | After application |
| --- | ---: | ---: |
| Main256, source and emitted | 790/790 each | 790/790 each |
| Legacy94, source and emitted | 376/376 each | 376/376 each |
| Independently frozen35, source and emitted | 178/178 each | 178/178 each |
| Whole frozen total, source and emitted | 1344/1344 each | 1344/1344 each |
| Reviewer four / author four neighbors | 16/16 each, both modes | Not separately repeated |
| Original host8 / stderr8 | 8/8 + 8/8, both modes | 8/8 + 8/8, both modes |
| Old stderr boundaries ×3 | 7/7 each | 7/7 each |
| New limits6 / author limits9 | 6/6 / 9/9 | 6/6 / 9/9 |
| Old safety plus limits | 24/25 | 25/25 |
| Old author114 | 113/114 | 114/114 |
| Historical238 / nearby117 | 238/238 / 117/117 | 238/238 / 117/117 |
| Author grammar suite | 2157/2157 | 2157/2157 |
| Old broad1580 command | 1550/1580, original30 | 1579/1580, dated seal only |
| Complete changed canonical test files | Not applied | 427/427 |
| All38 relevant structured `.test.ts` files | Not aggregated | 3757/3758, dated seal only |

The 38-file run includes old1580 + author2157 + new limits6 + new assertion15.
Proposal-only verification separately preserves 464 selected invocations, 373
unselected registrations, 93 untouched statements and rejects all14 byte mutants.
These synthetic checks are not additional product/native executions. Literal-file
evidence `013c1afd` independently matches both exact input keys and tuples: 4/4
captures plus 2/2 metadata queries, regular file `f09f`, stdin `98800a`, original
argv, unchanged bytes/metadata and cleanup. Old unavailable/FD observations remain.

## Remaining validation limits

- Sole complete-suite failure: `jq-42-review-fixes/evidence.test.ts:14`, named
  “all original author and independent evidence paths remain unchanged”. It
  expects old `harness.ts` hash `dabc50c8…`; live exact approved hash is
  `47007ff2…`. All139 entries of that old seal were checked: exactly10 approved
  existing targets differ, every original before snapshot remains exact. The
  old test/manifest was not rewritten, skipped, unsealed or reported green.
- New transparent preservation checks accept only the approved13 test deltas.
  Every other structured fixture, historical report, proposal, before snapshot
  and frozen vector remains unchanged. Full before/after hashes are retained.
- Initial source/compiled pre and post phases were internally stable at product
  `1762b02d…`. Scoped/global typing passed before and immediately after application;
  full in-memory builds produced520 outputs and loaded130 emitted runtime modules.
  No source-runtime fallback, installed-package claim or reviewer `dist` writes.
- Later unowned source and22 derived `dist` outputs moved. The first final audit's
  overbroad `dist` immutability assertion failed; its exact observation is retained
  in `late-derived-output-drift.json`. Derived outputs are now explicitly reported
  separately, never treated as immutable historical fixtures or silently restored.
- **One bounded paired rerun only:** source1344/1344 was stable at `15292370…`;
  compiled1344/1344 had stable tooling/build `dist` endpoints but product moved
  `15292370…` → `2607ebd2…` in `src/shell/runtime.ts` and `src/shell/types.ts`.
  It is not a stable final whole-product certificate. No further rerun attempted.
- Final canonical-scoped typing passes. Final global typing exits2 with unowned
  `tests/shell/env-replacement-bounds.test.ts:7:173` TS2769 (`detached` in
  spawnSync options) and `tests/shell/env-replacement.test.ts:119:89` TS2339
  (`EXTRA` on a readonly literal). No unowned fix or expectation refresh.

## Closure and genuine gaps

Original22 classify as **19 stale-policy, 2 diagnostic-mixed, 1 resource-mixed**;
the exact native patch adds4 acceptance and3 compiler rows (29 total). Host1 is
separate: root-approved origin-based Error/EPIPE/EIO/JqError identity, cleanup,
no extra reads/writes/effects. This is observable typed-sink policy, not native
parity or stale-native behavior. No production/public API change by this verifier.

Pinned `bb1ceabe` legacy94 remains historically45 exact /49 differences
(43 stderr +6 acceptance). All49 now match their unchanged expected tuples in
all four routes/transports; all94 are376/376 on source and emitted root. Original42
accepted790 stays separate. Previous174/178, alias0/4, original22/30 reds and prior
reports remain dated evidence, not rewritten into passes.

Broader jq grammar/builtins/flags, numeric/diagnostic profiles, logical versus hard
memory budgets, synchronous work and uncooperative-host limits remain. No full jq,
Bash/backend/project closure, just-bash superiority, clean HEAD, or72-hours claim.
This verifier's observed run spans about11 minutes. No active children or unowned
edits; final owned paths are committed. JSON commands are reproducible with fresh
output labels; writers refuse overwrite. Old live-before-hash verifiers remain
dated; `post-frozen.mjs` checks exact approved deltas without changing their seals.
