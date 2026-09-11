# Issue 672: portable checksum, randomness and timer primitives

## Scope and ownership

This worker removes Node crypto and timer imports from checksum execution,
mktemp, compression staging-name generation and the timeout scheduler. Root owns
the pinned dependency installation, manifests, lockfile, export/archive
integration, new test registration, complete-inventory browser graph, packed
consumers, workerd, build/lint gates and Git. The codec worker owns compression
streams, gunzip and archive processing. No README changes are included.

Issue 672 and its author comment were read with `gh issue view 672` on
2026-09-08. The issue's suggestion of a whole-input Web Crypto digest is not used:
incremental processing, existing admission limits and cancellation remain required.

## RED before production changes

Node v22.22.0 is selected using `/tmp/kamilio-toolchain.path`. From
`packages/safe-bash`, the maintained narrow runner is:

```sh
export PATH="$(cat /tmp/kamilio-toolchain.path)/bin:$PATH"
node scripts/test-reporting.mjs --import tsx --test-concurrency=1 \
  tests/commands/bytes/checksums/portable.test.ts \
  tests/commands/portable-random.test.ts \
  tests/commands/timeout-portable.test.ts
```

All three actual esbuild browser/workerd-conditions graphs failed:

- Checksums: `Could not resolve "node:crypto"` at checksums/index.ts:3.
- Randomness: the same error at metadata/mktemp.ts:1 and
  bytes/compression/files.ts:1.
- Scheduler: unresolved `node:perf_hooks` and `node:timers` at scheduler.ts:1-2.

These focused graphs use the existing browser platform adaptation for unrelated
core path/stream contracts and keep canonical safe-fs external. The staging graph
also explicitly leaves peer-owned stream/zlib dependencies external; it is not a
claim that the entire compression or public entry graph is already Node-free.
No crypto, performance or timer dependency is shimmed or marked external.

Additional pre-change tests made deterministic mktemp entropy observable and
specified rejection sampling and failure behavior. The four-file RED run had
12 passes and seven failures: three graph failures, the unchanged mktemp using
Node entropy instead of the supplied Web Crypto sequence, and three tests for the
not-yet-implemented random helper. The packed public graph failure reported by
root remains separate evidence.

Sandboxed process-isolated Node tests exited at file startup without reporting
test cases. The same maintained commands were run with approved escalation and
normal process isolation; no isolation waiver or alternate unit runner was used.
All emitted test bundles remain in memory (`write: false`). No unit test writes
host fixture files.

## Implementation

- Replace createHash with root-pinned `@noble/hashes@2.4.0` incremental MD5,
  SHA-1, SHA-224/256/384/512 implementations. Keep the 64-KiB processing blocks,
  cooperative yields, 32-MiB default cumulative input limit, manifest format,
  filename/line bounds and cancellation paths. Destroy hash state in finally,
  including input failures and aborts. CRC processing is unchanged.
- Generate mktemp character indices from receiver-bound Web Crypto
  `getRandomValues` calls. Reject the incomplete modulo bucket from the 32-bit
  sample space; do not reduce biased samples or use Math.random/Node fallbacks.
  Range validation happens before entropy acquisition; entropy errors propagate.
  Preserve collision retries, exclusive creation and private modes.
- Compression staging changes only the Node randomUUID import/call to
  `globalThis.crypto.randomUUID()`. Staging, collision, identity and cleanup logic
  are otherwise untouched.
- Bind standard performance.now to its performance receiver and global timers
  to globalThis. Preserve injected scheduler receivers, deadline accounting,
  timer chunking, numeric handle zero, idempotent retirement and late-wake guards.
  No Node fallback is installed.

## GREEN

From `packages/safe-bash` with the same Node 22 toolchain:

```sh
node scripts/test-reporting.mjs --import tsx --test-concurrency=1 \
  tests/commands/bytes/checksums/algorithms.test.ts \
  tests/commands/bytes/checksums/checksums.test.ts \
  tests/commands/bytes/checksums/streaming.test.ts \
  tests/commands/bytes/checksums/portable.test.ts \
  tests/commands/bytes/input-budget.test.ts \
  tests/commands/metadata/mktemp.test.ts \
  tests/commands/portable-random.test.ts \
  tests/commands/timeout-portable.test.ts \
  tests/commands/timeout-author-20260828/timeout.test.ts
```

Result: 120 passed, zero failed/skipped/cancelled, 3113.909561 ms.

The checksum browser bundle executes all six hash algorithms over empty, short
and multi-block binary inputs in a VM with no global Buffer, process or crypto;
results match the native test oracle. Existing GNU algorithm vectors, CRC,
manifest verification, input caps, blocked-source cancellation and cleanup tests
remain GREEN. A test-only initial expectation used the checksum utility format
for cksum; it was corrected to the existing tagged cksum output, without changing
production formatting.

The deterministic mktemp test rejects the biased tail, preserves an existing
colliding file, then creates a private replacement name. Random helper tests
check receiver binding, validation before entropy access and original entropy
failure propagation. The emitted scheduler executes with receiver-checking Web
globals and numeric timer handles, checking absolute deadlines, chunking,
retirement and harmless late callbacks without wall-clock sleeps.

New tests requiring root integration registration are exactly:

- `tests/commands/bytes/checksums/portable.test.ts`
- `tests/commands/portable-random.test.ts`
- `tests/commands/timeout-portable.test.ts`

No full lint, workspace build, pack, workerd qualification, staging, commit or
push is performed by this worker. The complete default/portable inventory and
runtime acceptance remain root-owned; this subfix alone does not close issue 672.

## Default-entry public fixture migration (2026-09-08)

After the API owner removed the public browser/portable entries and their preset
aliases, root assigned this worker only the `scripts/fixtures/safe-packages*`
consumer fixtures. No packaging, bundler, source, manifest or README edits are
part of this follow-up. The migration updates these six files:

- `scripts/fixtures/safe-packages-mixed-entry-runtime.mjs`
- `scripts/fixtures/safe-packages-browser.mjs`
- `scripts/fixtures/safe-packages-smoke.mjs`
- `scripts/fixtures/safe-packages-curl-output.mjs`
- `scripts/fixtures/safe-packages-types.mts`
- `scripts/fixtures/safe-packages-portable-search-types.mts`

The coordinated shared fixture exports `defaultEntry` and
`runNestedCommands(entry = defaultEntry, options = {})`. It imports only the
default package entry, creates the selected entry's Shell using the canonical
default filesystem and agent plugin, and allows explicit regexExecutor injection.
Its independently declared sorted 79-name inventory is compared against actual
createAgentCommands results, not an obsolete exported alias count.

The Node/Bun smoke imports the real `/node` entry separately, verifies shared
Shell/error/filesystem/carrier identities and forged/mismatched-carrier rejection,
and runs nested env/xargs with both the default provider and an explicitly
injected Node provider. Native grep/expr cases retain explicit injection. Full
Node POSIX assertions remain on the default Node and `/node` exports. Input-limit,
streaming/fallback, boxed-filesystem and curl buffered/mounted/cancellation
matrices remain intact across the two actual public Node modules.

The browser smoke imports the default entry only, retains canonical filesystem
identity and capability checks, checks the complete actual command inventory,
and exercises cut/pipelines, nested dispatch, and default/explicit-bounded regex
search. It does not import `/node` or claim that the canonical browser POSIX
subset implements the full native Node path API.

Shared portable-search types now use default AgentCommandsOptions and
regexExecutor injection without importing a Node entry. Native-provider type
coverage lives in the Node type smoke. Root can additionally typecheck the shared
search fixture with `--customConditions browser` against the installed core.d.ts
route; the main type fixture intentionally imports `/node`.

Validation: Node 22 syntax checks pass for all four changed MJS fixtures; no old
browser/portable entry or removed-preset references remain in safe-packages
fixtures; diff checks pass. With root's concurrently adapted maintained bundle
test, `npm run test:unit -- scripts/bundle-safe-bash.test.ts` passes all nine tests
(3.56 seconds), including the migrated shared fixture. This is not a claim that
the fresh Node/Bun/browser/type packed smoke has run: root owns the subsequent
build, conditional export packaging and installed-consumer verification.
