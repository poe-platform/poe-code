# Frozen sequencing controls receipt

No product source was edited. The proposal in `DESIGN.md` awaits root approval.
Only this new evidence directory and the requested `/tmp` coordination receipts
were written. Other workers' sources/fixtures/staging were not changed.

## Immutable inputs

- Accepted source: `21220b465537bf45ffcfb36740956a69f43bf75e`.
- Freeze commit: `e9ff18dc` (all cases and execution drivers sealed before execution).
- Source archive SHA-256: `b2de2b86a834f1b5c3ba7a98c347d3aa9668632ff3af2a073cf2c45c6b6bfef5`.
- Native binary SHA-256: `e8a4e2b58a33d2ad6bfa9eb8a4ed5f62775ab9ceac4b9421680c98973fd9109c`.
- Native profile: official GNU coreutils 9.7 fixture on Darwin 25.4.0/arm64,
  `LC_ALL=C`, not Linux and not the system BSD expr. Node v22.22.2.
- The archive includes committed source, expr tests and build/package inputs;
  source/tests are compressed data, outside canonical TypeScript discovery.

## Results (baseline, not a repaired candidate)

| Cohort | Passed | Total | Meaning |
| --- | ---: | ---: | --- |
| Native prerequisites | 3 | 3 | Version/hash checked; positive/false/runtime-error executable controls |
| GNU/Darwin semantic assertions | 44 | 44 | Independently frozen argv and exact bytes/status expectations |
| Product on those semantic inputs | 25 | 44 | 19 ordering/submission failures, not waived |
| Product-specific controls | 15 | 17 | 2 inactive-prefix evaluation failures |
| Product combined | 40 | 61 | 21 total red controls |
| Actual Shell/registry replay | 3 | 5 | Overlapping inputs, not extra unique coverage |
| Original old-cap assumption | 0 | 1 | Separate, unchanged red fixture |

The 19 semantic failures comprise 11 arithmetic/noninteger error-order failures
and 8 regex ordering/submission failures. Three regex cases already have the same
final diagnostic but incorrectly submit zero jobs. Exact results/events are in
`baseline-01/product.json`; oracle prerequisites are separate from semantic
assertions in `baseline-01/native-controls.json` and `native-semantics.json`.

The two product-specific failures show current inactive `length` performing locale
evaluation and inactive `substr` performing numeric conversion. They assert the
user's explicit no-evaluation requirement, not GNU's incidental skipped-prefix
implementation. No nullable normative cases were created.

All four cancellation controls pass (pre-admission, admitted worker, after first
worker result, evaluator checkpoint), retaining the same errno-shaped abort reason
and no output. The shared-budget control records two ordered, nonoverlapping jobs
with decreasing allowance in one Budget. Structural node/depth, argv bytes, work,
numeric, allocation and output controls pass. Worker exits precede observed execute
settlement; repeated cleanup calls complete; zero workers remain. These observations
cover the instrumented cases only, not all possible resource schedules.

The old `syntax-output-one` input remains `['1','x']`, `maxOutputBytes:1`, expected
status 2/full syntax diagnostic. It still returns 3 and
`expr: output bytes limit exceeded\n`. Its assertion is preserved separately, not
reclassified green by the new maxOutputBytes:4 safety control.

## Validation, integrity and limits

`node --check` passed for the frozen driver, capture and freeze scripts. The archived
accepted source builds successfully using the existing local TypeScript tooling;
no dependencies were installed, shared dist rebuilt, or global tests run. Tooling
was not independently rebuilt/pinned beyond the archived package/lock inputs.

Source archive, frozen cases/drivers and native binary hashes agree before/after
capture. Complete extracted source/test inventories agree, including new-entry
detection; generated dist and the explicit development node_modules symlink are
excluded from that source inventory. `SEAL.json` separately authenticates evidence
files with append-aware verification. No claim of append-proof compiled dist is made.

One capture, `baseline-01`, completed without infrastructure failure. Native/build
children were waited; the driver retired its owned workers; its archive extraction
was removed in `finally`. Source remains immutable. The archive-mode harness neither
imports unrelated live edits nor rejects them. Canonical tests never execute these
opt-in capture drivers and never rewrite evidence.

To verify without writes: `node tests/commands/expr-stress/sequencing-design-20260827/seal.mjs --verify`.
`capture.mjs --capture UNIQUE-OUTPUT-NAME` is the original explicit baseline capture
entry, but adding evidence now would deliberately invalidate this directory's seal.
Any new replay therefore needs a separately authorized evidence location and new
binding/driver revision preserving the frozen inputs and baseline captures. Do not
overwrite this seal or silently substitute live source/HEAD in the baseline driver.
