# Runner-binding addendum — 2026-08-27

## Narrow correction

The runner criticism in report commit
`3904fbc012998f0d7e550ac3523283b0a1f12758` applies to the runner **at
`92f7626200d1509cf0efe17e4ee6c3d558f3a277`**, not the current reviewed runner
`7b983a73e9e484befe703246c1d170baf86c2a3f`. The latter's parent is exactly
`92f76262`; its entire delta changes only `run.mjs`: the fixture pin moves from
`0ec75ef320ecaea9fc66e1ba952f3961c917685c` to `92f76262`, and the authentication
scope uses `cases.length` instead of the stale literal 32. Byte authentication
and loaded-module hash checks remain intact. **The historical stale-binding
blocker is closed by 7b; it is not a current runner blocker.**

This does not authorize the revised fixture semantics. The earlier report's
semantic recommendations, including three additions and the changed deferred
operation, still await explicit root approval; the revised freeze remains
provisional. No candidate was routed, inspected, or accepted.

## Static attempt-3 evidence

Only `authentication.json`, `summary.json`, and `baseline-cohort.json` under
`/tmp/shared-stdin-independent-baseline-attempt-3/` were inspected from that
attempt. All three agree on baseline
`eaed12f88365e69597994c4f2e6324a020202b66` and fixture `92f76262`.
Independently hashing the three exact committed fixture blobs gives these
SHA256 values, each matching both hash and byte length in authentication's
`consumerBefore` inventory of the execution fixtures:

| Fixture | Bytes | SHA256 |
| --- | ---: | --- |
| `cases.mjs` | 4898 | `5bcaeaea781111d067df0041f7948a48d578c955c2c5d32f2859f4ce9ccc2bea` |
| `probe.mjs` | 17835 | `1bc6421bf27e5dc6a32a162e7f02ab6d4c324c0a666bd31fca6ace95ef9123a9` |
| `loader.mjs` | 1074 | `8008029a4d0771c217f96c617dd7f781acbbc52e3f0f74bed1e60b8e9873ca9e` |

The 7b runner copies those authenticated committed bytes to the moved consumer,
launches its fixture loader/probe, and compares every recorded loaded-module
hash against `consumerBefore` before admitting a row. Thus the reviewed runner
and completed attempt evidence support the loaded fixture hash match to 92f,
not merely matching revision labels. Individual load receipts and post-run
inventories were outside this followup's permitted reads: this is not a fresh
independent audit of those receipts or the entire archive's integrity.

- Preserve the original **18/32, 14 failures**, plus **two separately detected
  negative controls**, as historical evidence; do not replace or relabel it.
- Attempt 3 is **provisional 25/35, 10 failures**, plus **two separately detected
  negative controls**, not 27/37. Recounting the cohort yields 35 unique,
  non-mutant rows and 25 passes; its failure list matches the summary: three
  `shell-early-*`, three `shell-status17-unread-*`, `shell-deferred-early-return`,
  `shell-primary-read-zero`, `shell-primary-read-error`, and `shell-primary-sink-error`.
- The summary reports both controls detected, all children closed, zero watchdog
  expiries, and `BASELINE_ONLY_WAITING_FOR_EXPLICIT_ROOT_CANDIDATE` with
  `candidateNotInspected: true`. Control receipts were not separately inspected.
  Recorded runtime: Node v22.22.2, Darwin arm64; run interval
  `2026-08-27T15:58:33.377Z`–`2026-08-27T15:58:49.775Z`.

Evidence SHA256 receipts:

- `authentication.json`: `a94530269528f3a816d2b3bb2c8d3529552df114a219acf64281fc8ff4a5d3ad`
- `summary.json`: `183a714c10bb247732ffbd3c78b77d85dd8c8f8e80e983a2a3d096c1c57ade69`
- `baseline-cohort.json`: `8a20a0ff6731724ca201ec7faeeb8833f2b33a3a2fcda24446d6d0f2a8f68441`

Static-only followup: no builds, tests, replay, product/live/candidate `input.ts`
inspection, or background processes. Existing report, fixtures, evidence, and
concurrent files remain untouched. No candidate acceptance or full-gate claim.
