# Independent next-stream source review

Scope: the five source-only opt-in commands `seq`, `nl`, `rev`, `unexpand`,
and `split`. This independent leaf does not modify production code, author
fixtures, package exports, the default registry, or historical evidence.

## Pre-exposure freeze

`frozen/manifest.json` pins the input generator, native recorder and raw
outcomes before any new author source/test exposure or product execution.
The freeze contains 82 distinct command inputs, 71 GNU coreutils 9.7 controls
on Darwin, 82 separate Apple controls, and three sequentially captured native
pipeline workflows using GNU coreutils plus Apple rev. These are not 156
independent product tests and are not a full compatibility gate.

Each capture contains exact executable argv, controlled environment, stdin and
file setup bytes, stdout/stderr/status, initial and final namespace with file
bytes and symlink targets. Binaries are not vendored. The captured references
include SHA-256, actual GNU version output, Darwin/macOS identity, Node identity,
locale availability and the installed GNU 9.7 manual hash. The online manuals
are rolling guidance, not a claim they match the installed binary release.
There is no util-linux rev runtime evidence and no GNU/Linux claim.

Existing public/contracts/ByteIO/Shell/Memory+Real APIs and the old stream
module index/README were inspected read-only around 05:42–05:43 UTC on
August 27, 2026. New author API proposals were permitted; unpublished source
and author tests were not inspected before this freeze. Two initial coordination
notes accidentally used anticipatory 05:44/05:45 labels; they are not duration
evidence. The recorder's actual timestamp is authoritative.

The native capture ran successfully, with zero execution-helper faults. That
is **not a product pass**. `nl-invalid-blank-count` is a preserved misleading
fixture name: both runtimes accept `-l 0`, and the actual success is frozen.
Apple/GNU diagnostic, status, locale and destructive-alias differences remain
separate profiles; expectations are not rewritten to match implementation.

## Reproduction and release boundary

Native-only capture, requiring the already available pinned references:

```sh
node tests/commands/stream-next-stress/capture-native.mjs
```

This writes a uniquely named `.private/native-*` directory and a proposed
`apply_patch` publication; it never overwrites the frozen evidence. The original
native scratch and any failed attempts remain private. Do not republish altered
expectations without root authorization.

Product execution must wait for both authors actually CLOSED and root's
`/tmp/safe-bash-stream-next-review.ready` with source commit/hash evidence.
Before that gate, only corpus/harness preparation is permitted. Source-only
module imports do not establish public package/subpath support. Defaults must
remain 60; no whole-project, full-backend, performance, superiority, or duration
completion claim is made. Plato's frozen `e36dab2` gate and the old diagnostic
cohorts are unrelated and untouched.

The mandatory source release verification is:

```sh
node tests/commands/stream-next-stress/run-source.mjs \
  --release-file tests/commands/stream-next-stress/evidence/final/release.json \
  --source-commit 72f780d0dbe73f71702c89c33d29aa614170c403 \
  --verify-release
```

Its source is `independent.review.ts`, deliberately not a `*.test.ts` auto-glob
entry: ordinary project tests must neither bypass this immutable-source gate nor
fail on the explicit guarded-launch requirement. The original filename and
helper attempts remain in committed historical evidence. This is a launcher
boundary correction, not skipped tests or removed holdouts; the dedicated runner
still executes the same 82 inputs, three workflows and 16 contract groups.

The launcher rejects a missing/incomplete release, verifies the authorized
immutable source commit and original frozen hashes, snapshots committed source/config/lockfile/runtime
and compiler identity, and emits JavaScript into a unique owned private tree.
Its scoped TypeScript build follows the harness's actual source dependencies;
the test subprocess has no TSX loader, source fallback, or inherited Node options.
Compilation/launch faults are saved separately from product behavioral failures.
It preserves raw test output, strict and selected-semantic comparisons, secondary
Apple observations, contracts, workflow outcomes, and before/after index state.
The two backends are repeated executions of the same 82 inputs, not a doubled
independent-input claim. Native sequential-stage workflows are compared to actual
concurrent virtual pipelines; they do not establish native pipe backpressure.

Initial gated outcomes and helper faults are preserved in
`evidence/initial/REPORT.md`. The original selected diagnostic policy is weak;
the root-authorized `strong-diagnostics.mjs` reports a separate versioned meaning
profile and synthetic wrong-error/wrong-operand mutation controls. Original raw
inputs, expected results, strict counts and weak-selected counts remain unchanged.
The separately disclosed dangling-output regression is not part of the original
82-input independent cohort.

Final results, remaining strict differences, changed global-test discovery,
exact root/Plato additive release-job request, and `/tmp`-independent reproduction
are in `FINAL_HANDOFF.md`. Global `*.test.ts` tests alone do not execute this
guarded immutable review; the mandatory command must remain a separate release
check. This is not a skipped-test pass or full-project gate claim.
