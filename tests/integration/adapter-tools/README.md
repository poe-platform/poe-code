# Cross-adapter agent-tool integration checkpoint

## Run and recorded outcome

Run from the repository root; no credentials or optional comparator install:

```sh
node --unhandled-rejections=strict --import tsx --test --test-reporter=tap tests/integration/adapter-tools/matrix.test.ts
npm run typecheck
```

Recorded August 26, 2026, Node **v22.22.2**: **79 tests, 58 pass, 21 fail,
0 cancelled, 0 skipped, 0 TODO**. The focused suite exits **1**, deliberately.
Three consecutive final strict-rejection runs reproduced these totals (1.061,
1.062, 1.201 seconds). Earlier whole-repository `npm run typecheck` passed;
the final full check exited **2** on concurrent foreign work:
`tests/commands/safejs/helpers.ts(4,38): TS2307`, missing
`../../../src/commands/safejs/index.js`. No foreign files were fixed. The owned
tests plus their transitive source imports pass the scoped strict check below.
This is not a whole-repository test-suite result or current whole-repo type pass.

```sh
node_modules/.bin/tsc --noEmit --target ES2023 --lib ES2023 \
  --module NodeNext --moduleResolution NodeNext --strict \
  --noUncheckedIndexedAccess --exactOptionalPropertyTypes --verbatimModuleSyntax \
  --forceConsistentCasingInFileNames --skipLibCheck --types node \
  tests/integration/adapter-tools/fixtures.ts tests/integration/adapter-tools/matrix.test.ts
```

The inspected source tree at the earlier passing typecheck was
`8a3df6884238d9865ef7dbd163a030a2cc3f8eeb` (`HEAD`
`658ef25288a706e8fef3497f828523fa34d14ac0`). Final repetitions ended at `HEAD`
`1c66038ec8cee95bb10346067711014e56c1dd39` with concurrent uncommitted structured
command edits; this is an observed working-tree checkpoint, not an immutable
clean-source release benchmark. Aggregate plugin delivery `f4eb0b3` is included
in that history.

| Fixture / cases | Tests | Pass | Fail |
| --- | ---: | ---: | ---: |
| Required: memory | 11 | 11 | 0 |
| Required: real temporary directory | 11 | 11 | 0 |
| Required: S3 mock, default rename policy | 11 | 1 | 10 |
| Required: WebDAV over loopback HTTP | 11 | 5 | 6 |
| Mount: memory root, real `/work`, S3 `/objects` | 11 | 10 | 1 |
| Overlay: memory upper, S3 lower | 11 | 10 | 1 |
| Mount cross-backend pipeline and two copy directions | 1 | 0 | 1 |
| Overlay lower-byte preservation / removal masking | 1 | 1 | 0 |
| Readonly memory: read flow and nine mutation denials | 10 | 9 | 1 |
| Retained independent jq `split` capability reproduction | 1 | 0 | 1 |
| **Total** | **79** | **58** | **21** |

Required four-backend subtotal: **28/44 pass**, not pluggability acceptance.
The complete six-family write flow passes memory, real, mount-local real, and
overlay, but fails S3 and WebDAV. There are **no capability-based skips, xfails,
TODO substitutions, or backend-specific weakened expectations**.

## Actual public plugin dispatch

Every fixture imports `Shell`, `agentCommands`, `createAgentCommands`, and adapter
constructors from `src/index.ts`. Every shell installs **only**
`agentCommands()`: no manual individual-family registration, replacements,
custom command handlers, shell stubs, host command executors, or native oracle.
After awaiting setup, the tests compare the aggregate factory and installed
registry against the union of all six public family factories: **49 distinct
commands** at this checkpoint.

| Delivered family | Representative actual dispatch |
| --- | --- |
| `standardCommands` | `find`, `xargs`, `cat`, file operations |
| `textProgramCommands` | `sed`, `awk` |
| `structuredCommands` | `jq` |
| `searchCommands` | `rg`, including nested invocation through `xargs` |
| `byteCommands` | `sha256sum`, `gzip` |
| `diffPatchCommands` | `diff`, `patch` |

Observational middleware records registered command dispatch and awaits `next()`;
it does not change handlers, inputs, results, or builtins. Each writable backend's
named-file probe case **continues all ten probes even after failure**, asserts
all six families and all nine required representative command names dispatched,
then fails for any unmet expectation. Those are 60 probe assertions inside six
tests, not 60 additional test cases. Registration does not claim all 49 command
implementations were exercised.

The common flow sends `find` results through `xargs rg`, `sed`, `awk`, and `jq`,
writes/reopens a JSON report, compresses redirected binary input, hashes decoded
bytes, generates an exact unified diff (expected exit 1), patches the target,
and compares exact resulting text. Independent cases exercise external/empty
stdin, `cd` and execution cwd, stderr/input/output/append redirection, copy/move/
remove/touch, `sed -i`, patch stdin/reversal, binary sinks, checksum manifests,
missing paths, invalid patterns, unknown commands, cancellation, and output limits.
Ordinary compound flows stop on their first failed assertion; the named-file
probes prevent that from silently omitting entire command families. Cross-mount
write and both copy directions are independently attempted before failure is
reported. Later verification of their destinations requires those operations to
work and is not claimed as passed.

## Failure classification and owner handoff

All snippets below run inside the fixture shell in `/work`; files are seeded by
`fixtures.ts`. Expected success means exact fixture bytes, exit 0 and empty stderr
unless otherwise specified. These remain ordinary failing assertions, not
accepted limitations.

| Finding | Minimal reproduction / actual result | Classification and source-owner recommendation |
| --- | --- | --- |
| S3 content readers | `cat old.txt`: exit 1, `ENOTSUP` streaming read; `rg`, `sed`, `awk`, `jq`, checksum, `diff`, and patch-file reads also fail | **Integration bug**: consumers choose an always-throwing optional method by presence even though `readFile` works. Coordinate adapter/contracts and command owners on capability-aware bounded reads; preserve byte limits and cancellation. |
| S3 missing-file / output-limit checks | `cat missing.txt` reports streaming `ENOTSUP`, not `ENOENT`; `cat payload.bin` with a 32-byte output budget never reaches the intended limit rejection | Consequences of the reader-selection bug, not evidence that missing paths or output limits are accepted. |
| WebDAV shell `<` | `cat < old.txt`: `ENOTSUP` access permission checks; even missing-file redirection reports this instead of `ENOENT` | **Integration policy mismatch**: shell requires POSIX `access(path, 4)` while WebDAV rejects every nonzero mode. Shell/adapter owners must design remote-readable input handling without bypassing actual real-filesystem permission failures. |
| Named checksum / gzip | WebDAV `sha256sum payload.bin` requires absent `readStream`; `gzip -c payload.bin` rejects S3, WebDAV, overlay, and even the real path in the mixed mount | **Explicit byte-tool capability gaps**: checksum requires a method; gzip also rejects advertised `streamingRead: false`. A namespace-wide mount flag is not a per-path answer. Byte/wrapper owners should agree on bounded fallback or genuine streaming support; do not merely lie about capabilities. |
| S3 move | `cp payload.bin move-source.bin && mv move-source.bin moved.bin`: rename `ENOTSUP` | **Explicit adapter capability gap**, not corruption: default S3 disallows non-atomic rename. This matrix does not enable `allowNonAtomicRename` to make the row green. Any opt-in copy/delete matrix must be reported separately, without an atomicity claim. |
| Remote touch partially mutates | `touch touched.txt`: creates an empty file, then exits 1 on unsupported timestamps, on S3 and WebDAV | **Capability gap plus partial-effect behavior**: tests inspect the created bytes before asserting success. Core/adapter owners must decide and document timestamp policy; a failure does not imply rollback. |
| Mounted S3 traversal | `printf x > /objects/out.txt`, and copies in either direction, encounter `ENOTSUP` | **Wrapper/adapter integration mismatch**: mount traversal requires directory `access(..., 1)` that S3 cannot provide. Review namespace-aware permission policy. Mount also restricts cross-backend `copyFile` with `EXDEV`; that later barrier must be retested after traversal is fixed. |
| Readonly named gzip | `gzip payload.bin`: `ENOTSUP` streaming-write preflight instead of the required `EROFS` denial | **Capability/error-precedence gap, not a readonly escape**. Whole namespace and bytes remain unchanged. Eight other mutation cases assert actual `EROFS`; byte owner should distinguish readonly denial from missing streaming support. |
| jq raw line splitting | `jq -R -s 'split("\n") \| map(select(length > 0))'` with `alpha\nbeta\n`: exit 3, unsupported `split/1` | **Structured-language capability gap**, not adapter-specific. Preserved as a minimal red test; the common flow uses the already-supported `jq -R '.' \| jq -s '.'` composition on every backend. |

Useful source locations: `src/fs/s3/filesystem.ts` (access and optional stream
stubs), `src/commands/internal.ts` (core input),
`src/commands/text-programs/shared.ts`, `src/commands/search/shared.ts`,
`src/commands/structured/jq.ts`, `src/commands/diff-patch/shared.ts`,
`src/shell/runtime.ts` (redirection), `src/fs/webdav/webdav.ts` (access),
`src/commands/bytes/checksums/index.ts`,
`src/commands/bytes/compression/files.ts`, `src/commands/filesystem.ts` (touch),
`src/fs/mount/index.ts`, and `src/commands/structured/parser.ts`.
No source-owner fixes are included here. The independent read-only capability
review was consulted; these counts come from executing this owned suite.

## Determinism, isolation and limits

- Fresh fixtures per test. Setup uses real adapter methods to seed known text,
  JSON, patch bytes, and a 4,099-byte `index % 256` binary vector. Assertions use
  exact bytes/JSON values; Node crypto/zlib only independently verify hashes and
  compressed payloads. Gzip container metadata is not assumed identical.
- Real adapters are restricted to test-created `.real-*` directories **inside
  this subtree**. Tests neither execute host tools nor access product host files.
  All created real directories are removed in `finally`; no unrelated `.native`
  directories are touched. No persistent generated outputs are needed.
- S3 uses only `MockS3Client`, a fixed clock, isolated bucket/prefix, and two-entry
  pagination. It creates no cloud client and uses no credentials. **Full S3 remote
  credential/signing/provider interoperability is outside this local matrix.**
- WebDAV uses an ephemeral `127.0.0.1` HTTP server plus the existing unedited
  `tests/fs/webdav/mock.ts` protocol mock. Fetch is origin-guarded; redirects are
  rejected. Requests/responses are bounded to 1 MiB. Server sockets and pending
  handlers are closed/drained in `finally`, then mock files/locks are cleared.
- Shell output and overlay buffering are bounded to 1 MiB; execution has a
  150-command budget, 1-KiB pipe high-water mark, 15-second fixture abort, and
  20-second test timeout. DAV requests use a 3-second client deadline and
  5-second server request timeout. Cancellation waits for an actual stdin read,
  aborts with a fixed reason, checks caller-iterator cleanup, and checks that a
  pre-aborted call dispatches nothing. Its readiness watchdog is 3 seconds.
- All six writable backends pass the blocked **stdin pipeline** cancellation
  case; this does not establish cancellation of arbitrary in-flight remote/host
  side effects. Readonly snapshots compare the complete namespace and bytes,
  excluding legitimate read-induced timestamps.

Remaining scope: resolve the retained failures and rerun unchanged expectations;
real remote interoperability; readonly wrappers over other backends; additional
mount/overlay compositions, links, concurrency, host-operation cancellation,
large-file stress, and the remaining command/option surface. This checkpoint is
not full shell support, not a 72-hour work claim, not a complete product gate, and
not evidence of superiority over `just-bash`.
