# Portable bounded search

`@poe-platform/safe-bash/browser` exports `portableSearchCommands`, an explicit
plugin containing the existing `grep`, `rg`, and `sed` command implementations.
It does not change `browserCommands()` or automatically enable a host capability.
The same plugin and provider types are exported from the Node entry.

```ts
import {
  Shell, browserCommands, portableSearchCommands,
  type BoundedRegexProvider,
} from "@poe-platform/safe-bash/browser";
import { createMemoryFileSystem } from "@poe-platform/safe-fs/core";

declare const provider: BoundedRegexProvider;
const shell = new Shell({ fs: createMemoryFileSystem() })
  .use(browserCommands())
  .use(portableSearchCommands({ provider }));
try {
  await shell.exec("printf 'first\\nsecond\\n' | grep second");
  await shell.exec("printf 'first\\nsecond\\n' | rg second");
  await shell.exec("printf 'first\\nsecond\\n' | sed -n '/second/p'");
} finally {
  await shell.dispose();
}
```

These are candidate source APIs until a release containing them is published.
The integration acceptance consumes locally packaged public artifacts, not a
claim that an existing registry release contains these exports.

## Provider authority and containment

The provider is **trusted host code**, not a sandboxed extension. Its name and
TypeScript interface cannot establish that its execution is actually bounded.
No default provider, implicit network connection, Node worker polyfill, or host
process fallback is installed by this plugin.

`BoundedRegexProvider.createWorker(options)` synchronously returns a new owned
`RegexWorker` endpoint. The interface uses event names but requires no Node
EventEmitter: a Map of listener Sets suffices. A browser Worker adapter can wrap
`addEventListener`/`removeEventListener`, unwrap message `event.data`, and map
termination into an awaited ownership barrier. A workerd host can implement it
with a genuinely budgeted cooperative interpreter or an explicitly authorized
independently interruptible execution service. A service adapter must establish
actual remote retirement; aborting fetch alone does not prove that remote work
stopped. Browser Worker availability must not be assumed in workerd.

The provider MUST:

- Keep creation, event subscription, and message submission bounded and
  nonblocking. Emit `{ ready: true }` asynchronously after subscription is possible.
- Never run caller-controlled native `RegExp` on the command event loop. A timer,
  `Promise.race`, heuristic pattern check, or a microtask does not preempt native
  regex execution. Use independently terminable isolation with hard resource
  limits, or an interpreter with enforced work/storage budgets and frequent
  cancellation checkpoints. A cooperative engine must bound work between yields,
  including parsing, encoding, matching, result production, and cleanup.
- Enforce supported regex syntax and semantics explicitly; reject unsupported
  descriptors instead of silently changing their meaning. Compile and validate
  patterns even for requests with no rows. Account for pattern/input bytes,
  intermediate allocations/states/captures, and result storage before allocation.
- Treat the pool's `workerOldGenerationMb` and `workerStackMb` as Node-oriented
  resource policy, not evidence of a portable memory limit. A non-Node provider
  must enforce and document its own equivalent or tighter concrete bounds.
- Deliver exactly one reply for each request, never unsolicited/late messages.
  Do not mutate submitted rows/descriptors. The pool copies retained input before
  submission but this does not authorize mutation of retained provider data.
- Implement idempotent `terminate(): Promise<unknown>`. Close admission, abort
  active computation, observe late rejection, await every admitted cooperative
  job/resource, and settle only after owned computation is quiescent. Even normal
  successful invocations retire their last owned endpoint. Cleanup failure must
  reject rather than falsely claim retirement.
- Implement `on`/`off` for `message`, `error`, `messageerror`, and `exit` without
  throwing. Optional `ref`/`unref` are only liveness hints; they are not required
  in browser/Worker runtimes. Report fatal transport failures using the error or
  exit event, so the pool can retire the failed endpoint.

The pool enforces active-request and startup deadlines, bounded FIFO waiting
queues, input ownership, reply validation, and cancellation. A request deadline
does not include queue waiting. Abort removes queued work without dispatch;
active abort, timeout, malformed replies, and transport failure retire the
endpoint before returning the result. Invocation cleanup is registered before
opening a session. `Shell.dispose()` awaits owned cleanup. These guarantees
depend on truthful, bounded provider methods; the pool cannot forcibly stop
arbitrary host JavaScript or an uncooperative remote service.

## Wire protocol

Public types include `RegexWorkerRequest`, `RegexRequest`, `RegexReply`,
`RegexDescriptor`, `RegexRow`, `RegexMatch`, and the individual grep/search/glob
descriptor types. `RegexWorkerRequest` also describes the shared Node pool's
`expr-match` operation; the portable search plugin never sends that operation.
Providers implementing only this plugin need not implement expression matching.

`postMessage({ id, descriptor, rows })` receives owned arrays. The endpoint replies
with `{ id, results: Float64Array[] }`, one array per row, containing alternating
start/end byte offsets. `{ id, error: string }` reports a pattern/matching error.
`RegexExecutionError` and `RegexExecutionOptions` are public exports.

- `grep` patterns use byte strings: each code unit represents one input byte.
  BRE/ERE, fixed strings, case, whole-line, and word flags are explicit.
- `rg` patterns are Unicode strings. Matching results must map back to original
  byte offsets, including invalid UTF-8. Case mode, fixed, word, whole-line, and
  NUL-record policy are explicit.
- `glob` patterns are Unicode strings. Candidate rows are UTF-16LE path bytes,
  with directory and ancestor flags. Glob results are selection indicators
  encoded as a valid match span, not text regex matches. Empty rows validate
  glob patterns; nonempty batches pair each pattern with its candidate row.
- Rows exclude record delimiters; `terminated` records delimiter provenance.
  `all: false` permits at most one match. `all: true` requests enumeration, with
  command-specific zero-width progression and overlap semantics. Reply validation
  rejects malformed identities, row counts, offsets, and amplification beyond
  one possible match position per byte plus the terminal position.

Provider authors must implement the command's requested dialect, not assume that
one generic JavaScript regex engine has identical grep, rg, and glob semantics.

## Options and budgets

`PortableSearchOptions` has required `provider` and optional:

- `replace` (default false): preflight all three command collisions before any
  registration. Set true only for intentional replacement.
- `regex`: `requestTimeoutMs` 1000, `startupTimeoutMs` 3000, `maxWorkers` 2,
  `maxQueuedRequests` 64, `maxQueuedBytes` 134217728, `idleTimeoutMs` 100,
  `workerOldGenerationMb` 128, `workerStackMb` 4. Grep and rg share this pool.
  Queue limits bound waiting input, not active interpreter memory; the provider
  must enforce active-request bounds as described above.
- `search`: rg's `defaultInput` (auto), `maxOutputBytes` (16777216),
  `maxLineBytes` (1048576), `maxFileBytes` (67108864), and `maxFiles` (100000).
  Replacement and regex-pool options belong at the plugin level, not here.
- `sed`: `maxSteps` (5000000) and `maxBufferBytes` (33554432). Sed uses the existing
  bounded instruction interpreter, not the injected grep/rg transport. Pattern
  parsing/instruction bounds and cooperative command checkpoints remain in force.

Grep also admits at most 1,024 patterns and 33,554,432 cumulative pattern-input
bytes per invocation, across `-e`, `-f` (including stdin), or the positional
pattern. These fixed command ceilings apply to both Node and portable packs,
including `-F`; they are not provider or `search` options. Bytes include LF
separators, UTF-8 encoded argv, and raw pattern-file bytes. An empty file adds
no patterns; an empty argument adds one; a final LF adds no extra pattern.
Admission happens before argument encoding or streamed chunk retention and
before provider dispatch or subject reads. Exceeding a ceiling exits 2 with a
diagnostic, closing the pattern source. This deliberately rejects larger sets
previously accepted by grep; rg's existing 1,024-pattern limit is unchanged.
The byte ceiling reuses the existing 32 MiB buffer limit cumulatively rather
than independently for each pattern file. It is not an RSS bound or a limit on
bytes already allocated by the caller or filesystem provider.

Shell input/output limits and cancellation remain independently applicable;
provider, command, and shell budgets are not one interchangeable global budget.
This feature introduces no environment variables or runtime dependencies.

## Public cooperative ERE primitives

`EreLedger`, `compileEre`, and `matchEre` expose the existing pure asynchronous
ASCII ERE interpreter for provider authors. They never construct a native
RegExp from the submitted pattern. `EreSyntaxError`, `EreUnsupportedError`,
`EreProfileLimitError`, and `EreUsageUnknownError` distinguish failure categories.
Associated `Ere*` types are exported from both entries.

Create a ledger with `{ maxExpansionBytes, maxExpansionFields }`; an optional
second argument can only lower its derived `patternBytes`, `subjectBytes`,
`work`, `states`, `allocationUnits`, `captureBytes`, and `captureSlots` limits.
Compile with `await compileEre(pattern, ledger, signal)`; literal fragments can
be supplied as `{ text, literal }[]`. Match with
`await matchEre(program, subject, ledger, signal)`. A compiled program is bound
to that exact ledger, so swapping ledgers to reset its budget is rejected.
Read `ledger.usage` for cumulative accounting, and use the same signal for every
operation. The interpreter yields after 256 charged work units. Its accounting
is an algorithmic resource bound, not a process RSS or wall-clock hard-real-time
guarantee. Providers still own request admission, reply storage, and retirement.

This is a deliberately restricted ASCII ERE engine with leftmost-longest
matching. It is not a complete grep BRE, Unicode rg, or glob adapter. Do not
advertise those semantics merely because the primitives accept a regex string.

## Workerd acceptance

Follow `docs/plans/portable-search-workerd-acceptance.md` from the repository root.
Build and package normally, install the three resulting safe packages in a
separate consumer directory, bundle only their public installed imports under
workerd/worker/browser conditions, inspect the module graph, then execute
`workerd test` without Node compatibility flags. Require the explicit assertion
marker, and retain the temporary bundle/config and package identity evidence.

The acceptance adapter in `tests/integration/portable-search-workerd/provider.mjs`
uses the real public ERE interpreter with pattern/input/work/storage limits and
awaited cancellation. It is **test-only**, accepts one case-sensitive ASCII
pattern, supports selection rather than all-match enumeration, and rejects
unsupported flags/BRE extensions/globs. It proves public provider integration,
real matching, adversarial work limits, request deadlines, active cancellation,
dispose barriers, recovery, and command output/step budgets in workerd. It does
not qualify a full Unicode/glob provider or a deployed Cloudflare service. The
Node-backed focused tests separately cover the unchanged production matcher.
