# Approved profile fixtures — August 27, 2026

**Scoped fixture migration complete; broader emergency-output policy BLOCKED.**
Delegated leaf, no redelegation. No product, parser, root wiring, inactive-prefix
wording, native oracle, original frozen expectation, or repeat-policy changes.
The production README is deliberately unchanged: this source does not enforce
the requested normal-error quota policy, so no compliant contract is advertised.

## Immutable composition and ownership

- Test-only commit: `35db31aab5be6a6d98c8ba7f006f714fa1c5da13`.
  Its sole changed file is `tests/commands/expr/contracts.test.ts`.
- Baseline: `6f2f0abb0fb337715849adf8978d5429d086fb6d`.
  The runtime uses this selected committed source archive, not live product files.
  Only the contract test from the committed test-only change is overlaid between
  original and approved contract runs. This is an explicit two-commit composition,
  not a whole-repository archive gate or distribution/install acceptance.
- Frozen diagnostic input and driver:
  `d0fb3ef0bc9c3c04cae829a47454c10e565ad971`.
  Git blob/SHA256 bindings cover all **271** selected source/test/config files;
  compiled output inventories and actual test command arguments are retained.
- Evidence is committed separately, only within this new directory. Its final
  commit ID is reported in the handoff rather than invented inside its own bytes.

## Exact scalar assertion migration

The original two-iteration loop, argv `['length','abc']` / `['a','<','b']`, and
environment `{LC_ALL:'en_US.UTF-8'}` remain byte-for-byte unchanged. Only the
length iteration now expects status **0**, stdout **`3\n`**, and empty stderr.
The collation iteration keeps the exact original status2 and diagnostic regex
assertions. Arithmetic, unknown-name, bracket, unrepresentable-argv, and all other
controls are unchanged; no locale substitution or environment replacement occurs.

`run-01/contracts.original.ts.data` and `contracts.approved.ts.data` retain both
full bodies. `contracts.patch` and `assertion-delta.json` prove exactly one text
replacement, with every byte outside that replacement unchanged. This structural
check is separate from actual runtime acceptance. The original qualified
**240/241** raw result remains preserved as `historical-legacy240-of-241.json`;
there is no new 241-case run or inferred 241/241 result.

## Version 2 output cohort

`runtime-binding.v2.json` derives from the immutable diagnostic fixture. Its only
data changes are the two expected tuple fields of **`syntax-output-one`**:

| Field | Original frozen expectation | Version 2 expectation / observed |
| --- | --- | --- |
| argv | `["1","x"]` | unchanged |
| options | `{limits:{maxOutputBytes:1}}` | unchanged |
| status | 2 | 3 |
| stdout | empty | empty |
| stderr | `expr: syntax error: unexpected argument 'x'\n` | `expr: output bytes limit exceeded\n` |
| stderr bytes | 44 | 34 |
| worker starts | 0 | 0 |

Every other row and the original driver remain byte-preserved. The original
header metadata is retained as original-freeze provenance, not a claim that this
new version was uninspected. `runtime-expectation-delta.json` explicitly records
the inspected version's lineage and exact single-row/two-field delta.

The source was observed to match this specific authorized case before the new
expectation was created, and the archived source confirms it again before the
version2 replay. This is a new versioned policy expectation, **not native
recapture, rebaseline, or a rewrite of old failures**. The old and new cohorts
are each run with the unchanged frozen driver and original comparison rules.
All 12 actual status/byte/error-identity/worker-event tuples are identical between
runs; only one acceptance decision differs. Raw import traces are retained but
excluded from tuple equality because sequential cached imports differ.

The 34-byte emergency is outside the normal one-byte quota; it is not an
absolute stdout-plus-stderr cap. These twelve controls do not establish the
broader one-fixed-emergency/at-most-once/normal-write policy.

## Exact unresolved source blocker

`src/commands/expr/syntax.ts:17` checks the normal parser diagnostic's size, so
the selected 44-byte diagnostic is refused at quota1 and resource status3 wins.
However, `src/commands/expr/index.ts:59` catches and writes ordinary fixed errors
without the same output-quota check or a distinct emergency-only gate.
`src/commands/expr/evaluate.ts:60` throws division by zero directly.

The separate retained negative control `['1','/','0']`, with the same
`{limits:{maxOutputBytes:1}}`, expects resource status3 and the fixed emergency
under the user policy. Actual: **status2, empty stdout, 23-byte
`expr: division by zero\n`**. This control is **FAILED**, excluded from both
12-case denominators, and never changed to accept the bypass. It is recorded in
`run-01/ordinary-error-policy-blocker.json`.

The independent proof leaf's issue receipt is preserved separately as
`independent-proof-issue.txt.data`; its inspected index/evaluate/syntax SHA256s
match this candidate. That receipt corroborates the blocker; this leaf does not
substitute its own twelve-row replay for the concurrent independent proof's
constant, at-most-once, await, or normal-write audit. Source changes are required
and are outside this assignment. **Policy satisfaction is not claimed.**

## Bounded validation and preservation

| Cohort | Result | Qualification |
| --- | ---: | --- |
| Original contracts, same archived source | 26/27 | Original obsolete assertion remains a recorded failure |
| Approved contracts, same argv/env | 27/27 | Only the authorized assertion changes |
| Unchanged grammar, diagnostics, named-profile, inactive-prefix | 298/298 | Existing four files; no native oracle execution |
| Original frozen runtime cohort | 11/12 | `syntax-output-one` remains RED |
| New version2 runtime cohort | 12/12 | One authorized expectation delta, not global policy proof |
| Separate normal-error policy control | 0/1 | Ordinary diagnostic still bypasses quota |
| Archived build and scoped strict typecheck | PASS | Exact scopes and command receipts retained |

All new test runs have zero skips, cancellations, and TODOs. No native binaries
are executed or recaptured. No full gate, superiority, deployed-service,
universal parity, repeat promotion, or 72-hour duration claim is made.

The **205** committed files in the original diagnostics, frozen, fixture-output,
and qualified-final-review trees are authenticated and unchanged. Directory-entry
inventories also detect new entries in those four trees and the selected source
archive; this is not an append-proof claim about the entire live repository.
Original 11/12 reports, 240/241 raw results, and prior failures stay intact.

The unchanged runtime driver reports zero active workers at settlement, before
safety cleanup, and after cleanup. Named-profile tests report 74 workers, zero
active before/after cleanup. Synchronous bounded child commands have exited;
the exclusively owned `run-01/.work` archive/build tree is removed. Other workers'
files, staging, native scratch, and shared `dist` are untouched.

Capture interval: **20:12:47–20:13:13 UTC, August 27, 2026**. This is the recorded
replay interval, not total work duration. The new opt-in driver is outside
canonical discovery and refuses an existing output directory:

```sh
node tests/commands/expr-stress/approved-profile-fixtures-20260827/replay.mjs --replay run-review-02
```

Use a new lowercase alphanumeric/hyphen run name; never rerun into `run-01`.
`FILE-MANIFEST.json` binds artifact
integrity only and explicitly records the blocked policy; it is not an acceptance
seal. Canonical test discovery does not execute these version-specific drivers.

Verify the recorded artifact set without replaying or rewriting evidence:

```sh
node tests/commands/expr-stress/approved-profile-fixtures-20260827/verify.mjs
```

That check rejects new entries in the recorded evidence directory too. A future
opt-in capture is new evidence, not part of this immutable manifest.
