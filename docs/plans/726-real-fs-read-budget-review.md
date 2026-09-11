# #726: RealFileSystem direct-read allocation review

## Scope and provenance

Reviewed September 11, 2026 against the current local source. Retrieved the live
body of issue #726, authored by `kamilio`, using:

```sh
gh issue view 726 --repo poe-platform/poe-code --json number,title,body,author,state,comments
```

The issue was open with no comments at retrieval. It asks whether direct
caller-controlled allocation sizes have a supported untrusted-input path, and
requests non-vulnerability closure if none is established. This is a bounded
review of those read-size arguments, not a proof of global memory safety or an
audit of all plugins and deployment-specific extensions.

## Result

**Direct allocation admission confirmed; no maintained untrusted-shell path to
the excessive per-read size was established. Recommend non-vulnerability
disposition with the trusted-caller boundary documented.** No production change
is proposed without a concrete reachable defect and root approval.

### Direct API behavior

- `packages/safe-fs/src/fs/real/index.ts:681`: retained `read(position, maxBytes)`
  validates nonnegative/safe-integer range, positive size, and offset overflow.
  It allocates `Uint8Array(maxBytes)` before native read, without an operational
  maximum or file-size cap. A caught constructor refusal becomes `EFBIG`.
- `packages/safe-fs/src/fs/real/index.ts:727`: `readStream` defaults to 64 KiB,
  validates range/size, and allocates `min(chunkSize, endExclusive - position)`.
  An explicit enormous safe-integer chunk can reach the constructor even for a
  seven-byte file. A synthetic `RangeError` currently maps to `EIO` through the
  stream's ordinary error conversion.
- A caught allocation exception is not an OOM-prevention mechanism and does not
  guarantee the process survives a real excessive allocation. No such allocation
  or process-failure experiment was performed.

## Maintained caller trace

Source search included `openReadFile`, `readStream`, method aliases/`Reflect.apply`,
and retained `read` call sites under `packages/safe-bash/src`, followed through to
their argument producers. No claim is made about dynamically registered custom
commands or third-party adapters. The relevant maintained paths are:

| Path | Allocation-size boundary | Source |
| --- | --- | --- |
| Shell file redirection / shared stdin | Retained reads use `min(request, 65536, remaining input budget + 1, remaining safe offset)`; stream fallback supplies no custom chunk | `packages/safe-bash/src/shell/input.ts:12`, `:50`, `:101`; acquisition uses the host's shell input budget at `packages/safe-bash/src/shell/runtime.ts:2434` |
| `cmp`, including guest `-n`/skip values | Retained requests and stream fallback are capped at 4 KiB | `packages/safe-bash/src/commands/cmp.ts:10`, `:247`, `:255`, `:304` |
| `shuf` file random source | Retained and stream reads request 64 KiB | `packages/safe-bash/src/commands/shuf.ts:329` |
| `tail -f` retained reader | `min(65536, end - offset)` | `packages/safe-bash/src/commands/tail-follow.ts:191` |
| `truncate` retained reference | Acquires stat/seek authority; no retained byte-read call | `packages/safe-bash/src/commands/truncate.ts:430` |
| Encoding/checksum/compression commands | 8 KiB / 64 KiB / 64 KiB respectively | `packages/safe-bash/src/commands/bytes/encoding/shared.ts:7`; `bytes/checksums/index.ts:10`; `bytes/compression/stream.ts:8` under the same commands directory |
| `hexdump`, `iconv`, `pr`, `tsort`, HTML input | Fixed 16 KiB, including aliased `Reflect.apply` calls | `packages/safe-bash/src/commands/hexdump/io.ts:150`, `iconv/reader.ts:79`, `pr/io.ts:111`, `tsort/io.ts:101`, `html-to-markdown/input.ts:59` |
| `fmt`, `csplit`, SafeJS source loading | Fixed 64 KiB | `packages/safe-bash/src/commands/fmt.ts:432`, `csplit/io.ts:95`, `safejs/index.ts:101` |
| `file` sniffing | `min(16384, configured maxChunkBytes, configured maxSniffBytes)` | `packages/safe-bash/src/commands/file/index.ts:111` |
| Archive/ZIP/unzip | Host-installed archive limits; default 64 KiB, settings enforce 512 bytes through 1 MiB | `packages/safe-bash/src/commands/archive/internal.ts:41`, `:44`; `archive/zip/safety.ts:70`; `archive/unzip/safety.ts:53` |
| `split`, line-ending commands | Host-installed limits, default 64 KiB / 16 KiB. These configurable limits must themselves be trusted; they are not guest CLI chunk-size arguments | `packages/safe-bash/src/commands/split/options.ts:18`, `split/io.ts:61`, `line-endings/internal.ts:39`, `line-endings/io.ts` |
| Other maintained stream readers | No custom allocation chunk: RealFileSystem's default 64 KiB applies | `internal.ts`, `search`, `structured/jq.ts`, `table-text`, `text-programs/awk-runtime.ts`, `stream-inspection`, `stream-format`, `xan/io.ts`, `xml/index.ts`, `yq/index.ts`, `network/body.ts`, `diff-patch/shared.ts` under `packages/safe-bash/src/commands` |

Guest count/offset arguments may affect how much total data a command processes;
that is different from passing the count directly to the native read allocator.
`Shell` requires a host-supplied filesystem and its configurable limits are host
JavaScript options (`packages/safe-bash/src/shell/types.ts:45`). Very large trusted
plugin chunk settings, notably `split`/line-ending configuration, are not claimed
to have an independent operational upper bound.

### Guest JavaScript bridges

- The maintained SafeJS command supplies a filesystem module through
  `makeSafeJsFsModule`, not the raw `FileSystem`/`FileReadHandle` interface:
  `packages/safe-bash/src/commands/safejs/index.ts:130` and
  `packages/safe-bash/src/integrations/safejs/filesystem.ts:7`.
- The filesystem bridge has no `openReadFile` or `readStream` methods and accepts
  only `encoding`, `flag`, and `signal` for `readFile`; unknown allocation options
  are refused (`packages/safe-fs/src/bridge/filesystem.ts:139`). SafeJS's module
  option policy further constrains guest options
  (`packages/safe-js/src/modules/fs.ts:165`).
- The provider-backed `node` command computes its `readText` budget from fixed
  operation/aggregate limits and forwards it to `readFile`, not to a guest-chosen
  `chunkSize` (`packages/safe-bash/src/commands/node/host.ts:175`). SafeJS stdio also
  restricts `readBytes` requests to 1..65536
  (`packages/safe-bash/src/commands/safejs/io.ts:40`).

**Important limit:** whole-file reads, bridge result copies, aggregate retained
data, concurrent calls, and application-authorized large files still have memory
costs. In particular, bridge `readFile` is not evidence of a universal aggregate
input budget. This review does not establish absence of every resource-exhaustion
path; it establishes no maintained guest path to the two reported unchecked
per-read allocation-size arguments.

## Safe reproducible evidence

`packages/safe-fs/tests/real-read-budget-review.test.ts` has fourteen tests. All
adapter native filesystem calls use `memfs`. A temporary constructor proxy
records numeric `Uint8Array` requests and throws **before** any request greater
than 1 MiB reaches the real constructor. It is restored after each test.

- Direct retained `read(0, Number.MAX_SAFE_INTEGER)` reaches that guard, rejects
  `EFBIG`, performs no native read, and the handle closes.
- Direct stream `chunkSize: Number.MAX_SAFE_INTEGER` reaches the guard despite
  the small file, rejects `EIO`, performs no native read, and closes.
- Adding `start: 1, endExclusive: 4` limits the stream allocation/read to 3 bytes.
- Six invalid retained sizes reject `EINVAL` before allocation or native read.
  Offset overflow and a pre-aborted signal also refuse before allocation.
- Bridge options `chunkSize`, `maxBytes`, and `highWaterMark` are refused without
  forwarding an excessive request. Raw read-handle/stream methods are absent.
- Real maintained shell execution with native calls mocked verifies:
  `head -c 9007199254740991 /file` reads at most 65536 bytes per native request;
  `cmp -n 9007199254740991 /file /equal` reads at most 4096; and `cat < /file` uses
  at most 65536. The two `cmp` inputs are separate in-memory files to avoid its
  same-entry shortcut. All three actually issue reads and return expected output.

These are allocation-admission observations and representative caller tests,
not destructive OOM tests, real-host benchmarks, or exhaustive command fuzzing.

```sh
npx vitest run packages/safe-fs/tests/real-containment-review.test.ts packages/safe-fs/tests/real-read-budget-review.test.ts --reporter=dot
npx tsc --noEmit --target ES2023 --lib ES2023 --module NodeNext --moduleResolution NodeNext --strict --noUncheckedIndexedAccess --exactOptionalPropertyTypes --verbatimModuleSyntax --skipLibCheck --types node,vitest/globals packages/safe-fs/tests/real-containment-review.test.ts packages/safe-fs/tests/real-read-budget-review.test.ts
```

The focused tests run without host file creation, external commands, network,
hardlinks on disk, large allocation, or OOM. The test typecheck uses ES2023 because
the maintained safe-bash sources it imports use that library target; it does not
change either workspace's production configuration.

Validation on the review date: both new files passed all 21 tests; including
`packages/safe-fs/tests/retained-read-directory-real.test.ts` and
`packages/safe-fs/tests/real-trailing-separator.test.ts` passed all 102 tests across
four files. The scoped test typecheck above, `npx tsc -p
packages/safe-fs/tsconfig.json --noEmit`, and focused ESLint with
`--max-warnings=0` passed. No broad/unmaintained all-tests typecheck is substituted
for these scope-specific checks.

## Acceptance disposition and trusted-caller requirements

- **Admission validated:** direct caller-chosen safe-integer sizes reach the
  allocator, safely intercepted by tests; no operational maximum is asserted.
- **Reachability reviewed:** maintained read callers have the boundaries above;
  no supported guest path to an excessive per-call size was established.
- **Recommended disposition:** root may close #726 as a non-vulnerability after
  delivering this documented trusted-caller boundary. Do not describe closure as
  a new allocator limit or an across-the-board DoS fix.
- **Embedding requirement:** do not forward untrusted sizes or allow guests to
  choose trusted plugin limits. A custom command/service exposing these APIs must
  impose finite per-read, cumulative, concurrency, and lifetime budgets suitable
  for its environment before invoking them. Raw host JavaScript already has
  allocation authority; the adapter is not a sandbox for that code.
- **Reopen/fix gate:** a maintained or explicitly supported embedding that
  forwards guest-controlled sizes without admission would change this finding.
  Produce a guarded regression for that path and obtain root approval before
  changing product code.

No issue was closed, no Git operation was performed, and no production code,
README, dependency, export, or deployment configuration was changed in this
assessment. Review documents are the only documentation additions; no separate
package guide is needed for this bounded handoff.
