# Two-case direct registered curl result

## Scope and result

Exactly **2 cases executed once: 1 pass, 1 genuine failure**, no skips,
cancellations, TODOs, extra probes or reruns. This is public-root **source-import
via existing tsx**, actual `CommandRegistry` registration and public
`CommandDefinition.execute(context)`. It is **not Shell, pipeline, packed-package,
native curl parity or deployed-provider evidence**. No external requests occurred.

| Case | Initial upload | 307 replay | curl exit | Test |
| --- | --- | --- | --- | --- |
| Reused nonzero-offset Buffer | Exact frozen bytes | Twelve `238` (`0xee`) bytes | 0 | FAIL |
| Reused nonzero-offset native Uint8Array | Exact frozen bytes | Exact frozen bytes | 0 | PASS |

Both literal expected upload vectors, committed before execution:

```
[0,255,128,195,40,10,13,0,254,65,226,40]
```

Buffer actual replay:

```
[238,238,238,238,238,238,238,238,238,238,238,238]
```

## Attribution and contract

`src/commands/network/body.ts:142` caches `chunk.slice()`. For Buffer chunks this
retains the producer's backing storage; `src/commands/network/body.ts:124` replays
another slice of that storage. The observed replay equals the source finalizer's
fill byte, while the first upload is intact. Native Uint8Array slice copies and
the matched counterpart passes with unchanged expectations.

The source mutates only upon its next requested read and in its finally block.
The trusted transport snapshots into number arrays before requesting the next
chunk, never mutates/transfers request bytes, and authorizes only the two literal
synthetic same-origin URLs. Four empty offset views and three binary data views
exercise the same source in each case. There is no arbitrary concurrent mutation.

`AGENTS.md` requires ownership of retained ByteSource fragments before advancing
or finalizing a producer. `src/contracts/io.ts` defines ByteSource as an async
iterable of Uint8Array and forwards borrowed chunks through readBytes.
`src/contracts/command.ts` exposes stdin on CommandContext, the actual registry,
and the command execute handler. `src/contracts/command.md` explicitly permits
direct/custom hosts without registerCleanup. Network types and README require
byte preservation/backpressure and document bounded stdin 307/308 replay. No
inspected contract transfers stdin ownership or authorizes transport mutation.

## Status, lifecycle and errors

In each case there are exactly two PUT requests, two authorization calls,
response statuses `[307,200]`, and curl exit code 0. Stdin finalization counts at
request admission are `[0,1]`; its finalizer ran exactly once before replay and
before execute settlement. Both response dispose callbacks have already started
once at execute settlement; their idempotent completion promises are also awaited
by harness cleanup. Both response generators are closed. The unread redirect
generator's finally count is 0 (return before start); the consumed final response
generator's finally count is 1, as frozen.

At execute settlement and after cleanup: zero active upload iterators and zero
active transport calls. No execution/cleanup errors, stdout or stderr bytes.
Neither watchdog fired; the child closed normally with test-failure exit code 1
and no signal. Post-cleanup resource types are only two PipeWraps (test harness
stdio), with no Timer/Timeout or network handle reported. Strict unhandled
rejections remained enabled. This checks owned cooperative fixture work, not
universal host-work preemption or Shell cancellation barriers.

The Buffer finding was written immediately, before its failing assertion and
before the native counterpart, to `/tmp/byte-remaining-direct-curl-findings.txt`.
The original red assertion and raw TAP are preserved; there was no harness
correction and no expectation relaxation.

## Frozen source and evidence

- Initial observed user HEAD: `656ee2b04aa91b1cc40da865173be1b472a2c4ce`.
- HEAD when source hashes were frozen: `61fe8ff8952d8b9575a991db13007a5cdc528158`.
- Pre-execution fixture freeze: `3163946e8983ee8424d0a20578aa48d9eb35e14c`.
- `src/commands/network/body.ts` SHA256:
  `29a8a744b043447eacc09d09ca651f2b0a34bdf08e08ddf3065729dbc486edbf`.
- `src/contracts/io.ts` SHA256:
  `e925ab08a5ad41862d3f5c031164cc7310bc28397455b11b37b75b55a9dbacdb`.
- Inventory of 212 tracked source paths and their hashes SHA256:
  `a5cbbfc87ae6fd3dc9627824837372d1df26203b561d6461a761ae4c867c3e21`.

All pinned source-file hashes, the complete tracked-source inventory digest and
frozen fixture hashes matched before/after execution. Source status was clean at
both boundaries. Concurrent unrelated files/commits are not product modifications
by this leaf. The runtime profile is Node v22.22.2, Darwin arm64.

Evidence: `source-pin.json`, `artifacts/before.json`, `artifacts/after.json`,
`artifacts/run.json`, `artifacts/raw.tap`, empty `artifacts/stderr.txt`, and both
per-case JSON observation files. The runner records the full executable command
and fixture freeze commit; it refuses to overwrite existing execution artifacts.
Reproduction uses the frozen fixture in a clean evidence destination, not a
second invocation over the retained artifact directory.

Scoped strict TypeScript check passed without executing additional cases:

```
node_modules/.bin/tsc --noEmit --target ES2023 --lib ES2023 --module NodeNext --moduleResolution NodeNext --strict --noUncheckedIndexedAccess --exactOptionalPropertyTypes --verbatimModuleSyntax --skipLibCheck --types node tests/stress/byte-ownership-20260827/remaining-consumers/direct-curl/direct-curl.test.ts
```

No production fixes, source/FS/runtime/root/dependency changes, common collector
retests, parent-fixture edits, or broader completion claims. Production changes
require separate user permission; the parent packed Shell matrix is independent.
