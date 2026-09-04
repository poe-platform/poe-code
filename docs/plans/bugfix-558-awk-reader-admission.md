# Bugfix 558: awk reader pre-admission

## Scope and validation plan

- Date: September 4, 2026. Inspected root HEAD: `cf742f0ea`.
- Own only `packages/safe-bash/src/commands/text-programs/awk-runtime.ts`,
  existing awk-owned `packages/safe-bash/tests/commands/text-programs/awk.cases.ts`,
  and this plan. Do not edit shared integration-input membership.
- Current `Reader.fill` copies the incoming chunk with `Buffer.from`, converts
  it to a Latin-1 byte string and concatenates carry before `Budget.check`.
- Reproduce with a 128-byte budget and at most 129 incoming bytes. Instrument
  actual owned copies and decoding, both with empty carry and 64 retained bytes,
  through ordinary input and redirected `getline`. Assert unchanged status,
  diagnostic, prior output, pull count and producer cleanup.
- Add preservation cases for exact admission, split UTF-8, empty chunks,
  byte-not-character accounting, invalid bytes, producer reuse and EOF.
- After recording red, reject incoming bytes exceeding remaining capacity before
  copying or decoding. Retain the admitted ownership/conversion and final check.
- Run focused reader tests, existing awk cases and adjacent text-program tests
  using isolated Node from `/tmp/kamilio-toolchain.path`, private `TMPDIR` from
  `/tmp/kamilio-unit-tmp.path`, `env -u NO_COLOR`, escalated execution and no tsx
  cache. No build, stage, commit, push, disk/LLM test effects or giant RSS run.

## Evidence and handoff

- RED, unchanged production reader: seven selected tests, three preservation
  passes and four expected failures. Each failure observed exactly one owned
  `Buffer.from(rejected)` copy and one decoding of that copy before rejection.
  The empty-carry chunk was 129 bytes; the carry case rejected 65 new bytes with
  64 pending bytes. Error, output, pull-count and cleanup assertions passed.
  Duration: 232.600112 ms.
- GREEN after the pre-admission guard: reader selection 7/7 (579.481805 ms),
  complete awk-owned cases 22/22 (687.598566 ms), adjacent text-program suite
  49/49 (1291.964011 ms). No skipped, cancelled or TODO cases in these runs.
- All commands used isolated Node v22.22.0, `TSX_DISABLE_CACHE=1`, private TMPDIR,
  `env -u NO_COLOR` and `--test-concurrency=1`. Repository-local Git variables
  were unset in the child shell using `git rev-parse --local-env-vars`.
  Exact test invocations after that environment setup:

  ```sh
  node --import tsx --test --test-concurrency=1 --test-name-pattern="awk reader" packages/safe-bash/tests/commands/text-programs/awk.cases.ts
  node --import tsx --test --test-concurrency=1 packages/safe-bash/tests/commands/text-programs/awk.cases.ts
  node --import tsx --test --test-concurrency=1 --test-reporter=spec packages/safe-bash/tests/commands/text-programs/text-programs.test.ts
  ```

- The first invocation supplied both RED and GREEN evidence. Existing
  `text-programs.test.ts` already imports `awk.cases.ts`; no new test file or
  shared registry edit was necessary. Tests use in-memory streams/filesystems,
  with no host fixture writes or LLM calls. Scoped `git diff --check` passed.
- Tested SHA-256 for `packages/safe-bash/src/commands/text-programs/awk-runtime.ts`:
  `b893c52a507364d3a950a4f0232962cf41cd465a75d628c965dcb81cda52add9`.
- Tested SHA-256 for `packages/safe-bash/tests/commands/text-programs/awk.cases.ts`:
  `af3c785a964302a77366d54b32d0e796911b8ede443126e85bae15fa8ac7f088`.

The guard compares incoming `byteLength` with `maxBufferBytes - buffer.length`.
The buffer remains a Latin-1 byte string: one string code unit per input byte,
not decoded UTF-8 character count. Admitted copying, conversion, carry processing,
final checking, cleanup and diagnostic remain unchanged. This does not introduce
per-record slicing to accept previously rejected oversized multi-record chunks.

This is a live worktree candidate, not a frozen archive or integrated/released
result. Final inspection observed root HEAD advance to `5fd0a94cd`; both owned
source/test hashes still matched the tested values. This worker made no commits.
No build, typecheck, repository-wide lint/test, native-oracle qualification,
stage, commit or push was performed; root owns integration. No unrelated defect
was established or fixed. Historical 192 MB / 1.3 GB RSS figures are issue context
only, not measurements from this bounded reproduction. The fix avoids the reader's
rejected copy/decoding; it does not bound producer allocation or total process RSS.
