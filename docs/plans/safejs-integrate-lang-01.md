# LANG-01 ordered integration

## Priority and isolation

- Date: 2026-08-29. Direct delegated integration author; no nested delegation.
- LANG is the immediate publication blocker. CTX prep is frozen separately with no
  source edits; no racing AR sources or publisher sources are read or written.
- Fresh main clone, immediately pulled with `git pull --ff-only origin main`.
  Base: `32caeaddbac72bccea1cb3fd0a07fb293a1bee71`.
- The inherited LANG validation manifest is SHA-256
  `974b81a0571149eeef492b558a27654ffd7e5a8c8ba163012b933e40789fecc3`.
- Bootstrap the exact 38 original exclusions plus all of the audit security directory
  before payload reads. Read only explicitly allowlisted, hash-verified immutable
  captures; no recursive audit scans, excluded reads/hashes/execution, or original
  writes. Preserve other changes; no branches, commits, pushes, or README edits.

## Conflict and resolution

The old array preimage is `ceb6b56cbda6085a8c49496cc4f289de877ade4279d42fa9e82fbb0f9b5771a2`.
Current main is `6de97e76745d9bac348957c78717c7dda4766385ce004f92ce49d71202e874ba`.
The difference is the 126-byte own-property lookup added in getArrayMember by
`7fec2826bac2933483c2579ff47d2264f8e1f422`. Keep that published behavior. Restore
only LANG's array-local callback lifetime accounting, never an old whole file.

## Steps

1. Record current-main preimages and the exact old/current source comparison.
2. Copy the original 202 author tests and 41 independent tests without byte changes.
3. Add native cross-fix cases for own properties, method shadowing, call order,
   Object.fromEntries, regex match metadata, and callback arity.
4. Run genuine current-main RED, including unchanged original full native outputs.
5. Apply only the LANG guard-lifetime delta, preserving mutation restrictions.
6. Rerun unchanged oracles, originals/replay, cross-fix and broader tests, configured
   root/package/test types, lint, format, builds, and full tests with TERM unset.
7. Freeze a delta-only candidate, current-main preimages, exact tests, plan, evidence,
   and hash manifest for fresh independent Aquinas review; then resume CTX prep.

## Validation record

Artifacts are isolated under ignored `out/safejs-remediation/lang-01-integrated/`.

- Genuine pulled-main RED: unchanged independent oracle 36 failed / 5 passed;
  unchanged author oracle and new cross-fix cases 172 failed / 38 passed.
  All 8 cross-fix cases failed the native/current comparison before the source edit.
- Final focused GREEN: 202 unchanged author + 41 unchanged independent + 8 new
  cross-fix tests = 251 passed. These include nested callback method pairs,
  aliases, early exit, throws, retained mutation restrictions, active checkpoints,
  and completed replay. The two inherited test files retain their validated bytes.
- Five unchanged original sources: 10 complete native matches and 10 current-main
  reentry failures before the patch; afterward 10 native, 10 current, and 10
  completed replay matches. Every source runs twice. Full values, not summaries,
  are compared, including Cartesian ranking and all Householder QR fixtures.
- Broader SafeJS suite: 170 files passed / 1 skipped; 6,510 tests passed / 39 skipped.
- Workspace candidate build: 67/67 tasks passed. Root/package/new-test TypeScript,
  configured ESLint, changed-file Prettier, and `git diff --check` pass.
- Root types initially ran concurrently with package build and observed missing
  toolcraft declarations. The untouched type command passes after build completion;
  retain both logs rather than hiding the failed scheduling attempt.
- Full root suite: 960 files passed / 3 skipped; 23,895 tests passed / 41 skipped
  in 223.93 seconds. Final root build passes all 67 workspace tasks, schema
  generation, root TypeScript, bin wrappers, and bundle generation.

All test commands use `env -u TERM`, snapshot playback, and snapshot misses as
errors. Installation uses `SKIP_SYNC_SKILLS=1 npm ci`. New tests are pure and do
not create files or call an LLM. ESLint excludes only this ignored evidence tree,
which holds unchanged original JavaScript captures; no lint rule is disabled.

## Scope and limits

- The only production delta is 13 insertions and 2 deletions in array.ts. Generic
  collection guards, map/set behavior, callback thisArg, globals, interpreter,
  and array metadata behavior are not changed. The published own-property lookup
  remains byte-for-byte intact. No CTX or combined AR readiness is claimed.
- The first GREEN attempt retained four failures in serialization of arrays with
  own map shadows. A separate unchanged-main build reproduces all four failures
  without nested callbacks: `value.map is not a function` in graph-depth.ts.
  Those four new cross-fix cases assert full native/current behavior only; the
  other four also assert completed replay. Preserve both the failed log and the
  baseline reproduction. This separate ARRAYOWN serialization issue is not fixed
  or claimed resolved by LANG. The 41 independent tests and 5 original replay
  comparisons are unchanged and all pass.
- No original payload is rewritten. Reads use explicit nonexcluded immutable
  captures with hash verification; the 38-path exclusion list and security-tree
  exclusion are recorded before payload reads. No racing AR files are read.
- Build-generated untracked terminal-pilot assets remain untouched and outside
  the delta. No original clone, publisher, or frozen CTX candidate is written.
- Independent Aquinas review is still required. This is an author integration
  candidate, not a publication approval; main is pinned to the recorded base.
