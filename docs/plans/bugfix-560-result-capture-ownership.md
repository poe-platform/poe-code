# Bugfix 560: terminal result capture ownership

## Scope and contract

- September 4, 2026; inspected root HEAD `3deecc0c4`.
- Own only `packages/safe-bash/src/shell/runtime.ts`,
  `packages/safe-bash/src/shell/shell.ts`, existing focused
  `packages/safe-bash/tests/shell/value-state.test.ts` and
  `packages/safe-bash/tests/shell/streaming.test.ts`, and this plan.
- Preserve `Capture.bytes()` as an independent live snapshot. Add terminal
  extraction which transfers a sole fully occupied backing buffer, compacts
  partial tails, flattens multiple chunks, and releases all capture-owned
  references before result decoding. Keep substitution snapshot calls unchanged.
- Preserve producer ownership, string/byte snapshots, the public result shape,
  zero output, shared stdout/stderr budget, external sink delivery, abort identity
  and cleanup settlement. No capture-free API or README changes.

## TDD and validation

- First add bounded tests for 0, 17, 4096, 4113 and 8192-byte captures, repeated
  snapshots/extraction, producer reuse, output mutation and reuse after extraction.
- Instrument actual `Uint8Array.set` calls on result buffers, backing identity,
  and capture references at `TextDecoder.decode` entry. End-to-end cases produce
  at most 8192 bytes per channel. No timing, GC, RSS or multiplier assertions.
- Record RED before production changes, then implement terminal extraction and
  record GREEN. Run existing capture/streaming, output accounting and cleanup
  coverage with isolated Node/npm from `/tmp/kamilio-toolchain.path`, private
  `TMPDIR` from `/tmp/kamilio-unit-tmp.path`, `env -u NO_COLOR`, disabled tsx cache,
  and repository-local Git variables cleared in the test child shell.
- Existing test files require no new guarded registry membership. Do not build,
  stage, commit, push, edit shared registries or run root integration gates.

## Evidence and limitations

- RED: 10 selected tests, 2 passes and 8 expected failures. Five failures identify
  the not-yet-implemented terminal method. Three shell-level failures directly
  validate the existing issue: a full 4096-byte channel incurred 4096 terminal
  copied bytes; 17-byte channels retained 2 chunks/34 used bytes at decoding;
  8192-byte channels retained 4 chunks/16384 used bytes at decoding.
- GREEN: the same 10 tests pass. Fully occupied sole backing buffers transfer
  with zero terminal copied bytes. Partial and multi-chunk outputs copy exactly
  their used length into exact-sized backing buffers. Both captures have zero
  chunks and zero used length at either result decoder entry.
- The unit tests retain pre-extraction chunk identities and live snapshots;
  subsequent writes must allocate different backing storage. Extracted-result
  mutation cannot alter those snapshots or a reused capture. The shell tests
  also mutate producer buffers and external sink inputs, assert cleanup before
  settlement and nonzero exit status, then mutate byte results without changing
  the returned strings.
- Adjacent validation: 150/150 pass across the complete two changed test files,
  output accounting and three cleanup suites. Includes shared stdout/stderr
  admission, prior output, abort identity, delayed/failed cleanup, BOM/raw bytes,
  substitution and concurrent execution coverage. No skips, cancellations or TODOs.
- Toolchain: isolated Node v22.22.0 and npm 11.19.1. Every execution was escalated
  with `NO_COLOR` unset and private TMPDIR. Tests ran uncached via
  `TSX_DISABLE_CACHE=1`; test fixtures use memory rather than host files or LLMs.
  Evidence logs are shell-captured output in private TMPDIR, not test fixture writes.
- Scoped `git diff --check` passed. No new test file or registry change is needed.
- The initial scoped strict test-file check reported zero diagnostics, but used
  the wrong declaration environment: running from the repository root without
  preserving `configFilePath` selected root `@types/node` 25.9.4 rather than the
  package-local 22.20.1 used by the maintained checker. This result does not
  establish package type correctness. The maintained audit found three new
  decoder-mock annotation errors alongside the independently established 24
  baseline diagnostics. Root corrected the annotations to derive types from
  `typeof TextDecoder.prototype` and `typeof originalDecode`, preserving runtime
  behavior. The earlier scoped log remains as evidence of the mistaken check.

### Evidence logs

- RED: `/var/tmp/poe-code-kamilio-unit.ln3MC7/bugfix-560-red.41jfcu.log`
- GREEN: `/var/tmp/poe-code-kamilio-unit.ln3MC7/bugfix-560-green.cPNkqH.log`
- Adjacent: `/var/tmp/poe-code-kamilio-unit.ln3MC7/bugfix-560-adjacent.bxThWo.log`
- Scoped strict test-file diagnostics: `/var/tmp/poe-code-kamilio-unit.ln3MC7/bugfix-560-scoped-types.Ecgdej.log`

The focused command (used before and after production changes), after the
environment setup above and clearing `git rev-parse --local-env-vars` in the child:

```sh
node --import tsx --test --test-concurrency=1 --test-reporter=spec --test-name-pattern="capture bytes retains|capture terminal extraction|terminal result extraction" packages/safe-bash/tests/shell/value-state.test.ts packages/safe-bash/tests/shell/streaming.test.ts
```

The adjacent command:

```sh
node --import tsx --test --test-concurrency=1 --test-reporter=spec packages/safe-bash/tests/shell/value-state.test.ts packages/safe-bash/tests/shell/streaming.test.ts packages/safe-bash/tests/shell/output-accounting.test.ts packages/safe-bash/tests/shell/invocation-cleanup.test.ts packages/safe-bash/tests/shell/invocation-cleanup-pipeline.test.ts packages/safe-bash/tests/shell/invocation-cleanup-lifecycle.test.ts
```

### Remaining limits

Initial worker-checked root HEAD was `3deecc0c4`. Pre-annotation-correction
source/test SHA-256 identities:

| Path | SHA-256 |
| --- | --- |
| `packages/safe-bash/src/shell/runtime.ts` | `9b64415c8466f67fe4c79b0211323c46c489f332061850bf1d4bb8a8df01175d` |
| `packages/safe-bash/src/shell/shell.ts` | `687e2d291481b73a913a7cc7a35a1b70360627c6f12ac8020b26897cb7bdf911` |
| `packages/safe-bash/tests/shell/value-state.test.ts` | `c4e008098fc3878194b661a45c7ecf2da083ef4f04bac22497483fe7938dd25c` |
| `packages/safe-bash/tests/shell/streaming.test.ts` | `5d63bd70ed72f58ee4fc73faf01eeca3e726b67cd702217b836ac9f76a7092ec` |

The initial worker handoff was write-frozen, not a frozen-archive or release-gate
qualification. Root subsequently ran the normal build, guarded ESLint, root
types, package lint and maintained public consumer types successfully, and the
full maintained SafeBash unit task passed 18,701 tests with 63 declared skips and
zero failures. These results precede the annotation correction and integration
of newer main changes. The separate maintained source audit correctly rejected
the three new test annotations; its failure is retained, not waived. Root owns
the final corrected-candidate validation, Git integration and publication.

The existing public result still requires contiguous bytes and decoded strings;
this patch does not remove either representation or introduce a capture-free API.
Multi-chunk flattening still temporarily needs both chunks and its contiguous
destination. Clearing capture references permits reclamation but does not force
GC or establish process RSS. Single-chunk transfer does not apply to multi-chunk
output. Historical 3.5x or 54–71 MB RSS claims remain unmeasured; runner durations
in logs are incidental, not performance evidence or test acceptance criteria.
