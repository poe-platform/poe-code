# #613: bounded filesystem writer task observation

## Scope and verified mechanism

- Issue #613 author was verified as `kamilio`. The current defect is a native
  promise reaction registered on the same pending filesystem writer task for
  each output slice by `Promise.race([accepted, task])`.
- The candidate starts from `0eb220284c6be903e95a385782c31d20c525f972`.
  `filesystem-output.ts` still matches the reviewed baseline SHA-256
  `ecce83814d2c33c8f6e701c5daed0195d66cf4732f7bffc19b1bae2297d5d2b9`.
  The existing direct-write budget path is unchanged.
- Scope is `packages/safe-bash/src/contracts/filesystem-output.ts`, the new
  `packages/safe-bash/tests/contracts/filesystem-output-task-reactions.test.ts`,
  and this plan. No parser, runtime, shell, registry, README, or other source edits.
- OOM magnitudes, heap/RSS growth, and the original large script were not
  reproduced. The evidence measures task subscriptions with bounded inputs.

## Implementation

- Keep one current acknowledgment slot; normal consumer advancement resolves
  and clears it. Each serialized slice awaits only its own acknowledgment.
- One task lifecycle observer wakes that slot on success or failure. Failure
  remains wrapped in an object to preserve `undefined`, `null`, `false`, `0`,
  and empty-string reasons. Existing destination closure/abort handling remains.
- After acknowledgment, check recorded task failure and operation cancellation.
  Do not introduce a shared pending failure promise raced for every write.
- Preserve the constant startup race, awaited task completion, cleanup joining,
  output accounting, 64-KiB slicing, producer borrowing, and public signatures.
  This bounds task observation across writes, not arbitrary host memory use.

## TDD and bounded checks (2026-09-05)

Work was performed only in private scratch while root's repository write freeze
and separate #614/#615 delivery gates were active:

`/home/kjopek/kamilio-validation-569-575.RoFXyZ/tmp/613-candidate.gzYFTT`

The owned source and two adjacent tests were copied exactly; unchanged dependency
paths are read-only symlinks to the live checkout. Node `--preserve-symlinks`
keeps dependency imports within the scratch module graph, so existing direct-write
budget controls exercise the candidate contracts too. Tests use memory-backed
filesystems, not host file writes.

- RED, before production edits: 38 new controls, 28 passed and 10 failed.
  Streaming and append fallback added 8/16 subscriptions for one-byte writes,
  one for a single chunk, and two at the 65,537-byte slice boundary.
- GREEN: 87/87 controls passed across the new file and unchanged adjacent
  `filesystem-output.test.ts` and `filesystem-direct-output.test.ts`.
- Strict scoped TypeScript check: exit 0, `--noEmit`, ES2023, NodeNext,
  `--strict`, `--noUncheckedIndexedAccess`, `--exactOptionalPropertyTypes`,
  `--verbatimModuleSyntax`, `--forceConsistentCasingInFileNames`, `--skipLibCheck`,
  `--types node`, and scratch-only `--preserveSymlinks`; the roots are the owned
  source and those three focused tests. This is not maintained full-gate clearance.
- New controls cover 8/16-byte streaming/fallback and single-chunk subscription
  counts, one 64-KiB boundary, delayed consumption/backpressure, producer reuse,
  queued and empty writes, early writer return, falsey fallback failures, parent
  cancellation identity, and overlapping abort/registered cleanup joining.
  Adjacent controls retain streaming falsey failures, capabilities, direct-output
  budget admission, and cleanup semantics. No crash, stress, or heap probes ran.
- The observer forwards native `Promise.race` and `.then` without adding its own
  subscriptions; it identifies the startup task and counts further native `.then`
  calls while the writer is still pending. Descriptors are restored in `finally`.

Commands (from the scratch root, with Node 22.22.0, private `TMPDIR`,
`TSX_DISABLE_CACHE=1`, `NO_COLOR` unset, and child Git variables cleared):

```sh
node --preserve-symlinks --import tsx --test --test-concurrency=1 --test-timeout=5000 packages/safe-bash/tests/contracts/filesystem-output-task-reactions.test.ts
node --preserve-symlinks --import tsx --test --test-concurrency=1 --test-timeout=5000 packages/safe-bash/tests/contracts/filesystem-output-task-reactions.test.ts packages/safe-bash/tests/contracts/filesystem-output.test.ts packages/safe-bash/tests/contracts/filesystem-direct-output.test.ts
node --preserve-symlinks node_modules/typescript/bin/tsc --noEmit --target ES2023 --lib ES2023 --module NodeNext --moduleResolution NodeNext --strict --noUncheckedIndexedAccess --exactOptionalPropertyTypes --verbatimModuleSyntax --forceConsistentCasingInFileNames --skipLibCheck --types node --preserveSymlinks packages/safe-bash/src/contracts/filesystem-output.ts packages/safe-bash/tests/contracts/filesystem-output-task-reactions.test.ts packages/safe-bash/tests/contracts/filesystem-output.test.ts packages/safe-bash/tests/contracts/filesystem-direct-output.test.ts
```

Evidence is `evidence/red.log`, `evidence/green.log`, `evidence/types.log`,
baseline copies/hashes, and `evidence/candidate.sha256` below the scratch root.
The frozen candidate is `evidence/candidate.patch`. No live repository files or
Git state were changed. Root owns authorization to apply after unfreezing,
literal registration of the new test path above, Git, and all full delivery gates.

## Root integration verification

Applied after verified delivery of #614/#615 on main at
`a31e6943baf46d88e27c9ae33a934dbd16e6ba39`. Root independently reproduced
the unchanged-production RED result (10 failures, 28 passes), then applied the
reviewed observer and ran all 87 focused controls successfully in the actual
checkout without scratch import overrides. The new test is explicitly asserted
in the maintained canonical discovery checks. Logs remain at the evidence base
as `issue613-root-red.log` and `issue613-root-green.log`. Full delivery gates and
publication are separate requirements; these focused results do not establish them.
