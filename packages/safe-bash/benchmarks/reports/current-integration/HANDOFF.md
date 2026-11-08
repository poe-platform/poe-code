# Final durable owner handoff

## Identity and unchanged result

The source anchor remains **DIRTY `57d9d9860bd51fabd910814efeea4efbca0e4c26`**,
not the evidence commit or a committed-only product validation. Final frozen input
digest: `5905112264b83a5e12ca549eec5a88d90f956b2838d54095e97bcec545c91560`;
product source digest: `20b8ecb2d2b6e47fc86784b23ba0094f0486a1197fcfcb71dcb61731cfea31ab`.
Retained snapshot: `/tmp/safe-bash-current-integration-69dbdy0m/source-clean`.
Independent review confirms 1,266 regular selected files, 13 untracked, 174
exclusions and unchanged frozen inputs/dependency copies. Later live observations
remain separate in `clean-after.json`; no later source is credited as tested.

- Full `npm test`: **9,920 unique checks = 9,686 pass + 164 fail + 70 skip**;
  zero TODO/cancelled, exit 1. No reruns or overlapping slices inflate this total.
- Root typecheck/build exit 0; contracts **82/82**, exit 0, overlapping full tests.
  Benchmark typecheck exits 2: TS2345 at
  `benchmarks/shell-stress/diagnostic-profiles/run.ts:12`.
- Existing comparison: virtual **118 pass**; pinned just-bash 3.4.2 **108 pass,
  9 fail, 1 unsupported**; exit 1. Its older six-family memory configuration is
  not the 52-command aggregate, optional curl/SafeJS or remote interoperability.
- The 70 skips remain **62 private-engine SafeJS + 8 conditional/unavailable GNU
  byte/checksum/encoding oracles**. No private checkout was inspected or executed.

## Required provenance qualifications

**Alias scope:** no live-source alias execution was identified in the checked
executed entrypoints/resolutions and reviewed 530-file static import closure.
This is not a universal computed-import/path or whole-inventory claim.
Unexecuted historical `tests/shell/first-read-independent.snapshot.mjs:4` retains
live-source imports at lines 4–5; `tests/shell/first-read-guard.snapshot.mjs:5`
selects the live root. These scripts were not run, changed or credited as covered.

**Initial environment: INFERRED/RECONSTRUCTED.** `environment.json` was overwritten
and now has the corrected `rg` PATH. No original per-phase initial environment
capture is retained. The initial environment/PATH description is reconstructed
from helper, checkpoint and run evidence, not contemporaneously captured data.
Any backfilled initial environment carries this same limitation. Final
`clean-*.environment.json` files are contemporaneous captures of each corrected
clean phase. Initial 9,089/674/157 and corrected 9,686/164/70 results remain intact;
the existing `rg` correction changed 510 fails and 87 skips to passes, not source.

This handoff supersedes only the unqualified alias/environment wording in the
historical `/tmp/safe-bash-current-integration-detail.txt`, without rewriting its
evidence. `INDEPENDENT_REVIEW.md` identifies the independent review inputs/hashes.

## Owner routing and stop boundary

Six disjoint failure groups still sum to **164**:

| Failures | Owner handoff |
| ---: | --- |
| 99 registry preflight | Curie/Poincare/Archimedes: 52 actual commands vs 49 expected; 79 matrix + 8 diagnostics + 12 jq interop stop before workflow callbacks, not 99 proved backend defects |
| 42 jq exact vectors | Archimedes: 30 status/stdout differences and 12 stderr-only differences |
| 8 diff/patch | Faraday; coordinate Poincare for backing metadata/identity effects |
| 9 live-native shell | Sagan; preserve dialect/diagnostic qualifications and all failures |
| 5 first-read lifecycle | Sagan with Archimedes/Poincare: before-first-byte producers remain pending after `head -n 0` |
| 1 S3 mode contract | Poincare: capability/creation-mode stress disagreement |

Existing slices remain remote cancellation 24/24, late WebDAV 10/10, stdin-shell
35/35, pipeline closure 20/25, remote safe API workflows 6/6 and metadata
integration 6/6. None replaces the blocked **0/79** required adapter-tool matrix.

This finalization changes owned reports only: no validation rerun, source/test/
expectation/dependency fix, private-repo access or archive investigation. An atomic
evidence-only commit does not commit or validate the audited dirty source state.
Full-shell/provider scope, the exact superiority requirement and 72-hour request
remain unmet/unproven. Stop after evidence verification and owner handoff.
