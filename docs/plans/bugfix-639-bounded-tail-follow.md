---
$schema: https://poe-platform.github.io/poe-code/schemas/plans/plan.schema.json
kind: plan
version: 1
---

# Bugfix #639: bounded tail follow

Retained readers, wrapper composition, bounded follow, and the required Shell
cleanup/checkpoint repairs are implemented. Root's
[command implementation profile](bugfix-639-command-profile.md) supersedes
conflicting historical command-state proposals below. The
[tail contract](../../packages/safe-bash/src/contracts/tail-follow.md) records
command behavior and focused qualification, including both repaired Shell
regressions. Local qualification, remote-main delivery, and successful
publication remain separate milestones; historical handoffs below are not
claims that a later candidate has passed its final gates.

## Phase A authorization: September 6, 2026

Root explicitly authorized Phase A on clean HEAD
`6dd3b12baafeac38fb53234ab5f20ab959241dc7`, after #644 qualification, with fresh
TDD and no concurrent build/test/lint. This supersedes the older statements
that no source work is authorized, but only for the following seven paths:

- `packages/safe-fs/tests/retained-read.test.ts`
- `packages/safe-fs/src/contracts/filesystem.ts`
- `packages/safe-fs/src/fs/memory/index.ts`
- `packages/safe-fs/src/fs/real/index.ts`
- `packages/safe-bash/src/contracts/filesystem.ts`
- `packages/safe-bash/src/contracts/filesystem.md`
- `docs/plans/bugfix-639-bounded-tail-follow.md`

Approved API: optional `openReadFile`, optional `retainedRead`, and the minimal
`FileReadHandle.stat(FsOptions?)`, `read(position, maxBytes, FsOptions?)`,
`close()` interface. Identity uses only existing `FileStat` fields. Implement
stock Memory/Real retention, owned bytes, fresh metadata, numeric admission,
pre-abort, modified-adapter refusal and drain-safe native release, with a narrow
public type re-export and contract documentation. Preserve finite streams.

Wrappers, `capabilities.ts`, command factories, actual tail following, registry,
README, Git operations, shared builds and full guards are not authorized in
this phase. Root owns subsequent frozen qualification and delivery. The 28
additional native observations recorded below inform command design but do
not silently approve their command-state details.

## Root decisions after bounded native validation

September 5, 2026: the following decisions supersede conflicting earlier draft
proposals in this document. They approve a partial compatibility/admission
profile, not implementation or completion of #639.

- EOF applies only to consumed stdin. Default empty stdin never stops named
  followers, and mixed-input EOF retires stdin without stopping named readers.
- After `-F` reports name unavailability, suppress reads from the old resource
  while that name remains unavailable. The eight native observations support
  that output rule; they do not prove native descriptor retention or the still
  unvalidated same-resource reappearance behavior.
- Select the observed forced-polling recovery status profile: an initial
  admission failure retains exit 1 after recovery; recovered later name loss
  does not itself force failure. Preserve the differing default two-file native
  result as a compatibility difference. The earlier rule making every printed
  retry diagnostic permanently fail the invocation is not approved.
- Add a separate configurable per-tail admitted-handle cap with default 64.
  Use the public name `maxTailFollowHandles`, not the generic draft name
  `maxActiveFollowHandles`. Accept nonnegative safe integers; zero disables
  named follow only. Count current, reserved/in-flight, candidate and closing
  readers until release settles. Reserve a comparison slot for `-F`, and reject
  excess demand with `EMFILE` before I/O. The standard/browser/agent forwarding
  described in the addendum is approved in principle under this tail-specific
  name; it does not alter tee's cap or create a process-wide resource guarantee.

Permissions, unrecovered failures, same-size replacement, observed truncation,
same-resource reappearance, finite count/header/EOF parity, concrete retained
reader interfaces and backend implementations still require the scoped RED
tests and remaining native checks. Their draft details are not established by
the eight completed observations. No source implementation is authorized by
this preparatory documentation commit.

## 1. What we're building

Bounded `tail -f` / `tail -F` over the injected virtual filesystem, with optional
`--max-idle SECONDS`, upstream EOF for stdin input, and the existing shared Shell
wall-clock, CPU and cancellation limits.

- `-f` follows an opened resource, including after rename or unlink.
- `-F` follows a name with retry and detects replacement using the identities of
  actual opened resources, not pathname metadata or size/mtime guesses.
- Preserve ordinary finite tail, its line/byte selection and diagnostics, head,
  tee #631, the other stream commands, and unrelated concurrent work.
- No native process, watcher, network privilege, unbounded native-tail promise,
  new default idle timeout, or independent absolute follow deadline.
- No duplicate handle identity field, fallback that silently weakens retained
  reading, factory replacement-by-name, README change, or unrelated filesystem fix.

### Reviewed baseline and evidence

- Reviewed on September 5, 2026 at HEAD
  `d17a11832251969d2b7406736cc17b80b36408b0`. Root reports this baseline fully
  qualified; no build, tests, lint, typecheck or native probes were rerun for this
  plan. The current jq changes are outside this plan's implementation scope.
- Reread kamilio's issue #639 using
  `gh issue view 639 --repo poe-platform/poe-code --json number,title,body,author,url,updatedAt`.
  Current title: `safe-bash: tail -f / -F (bounded live follow) is unsupported`;
  issue updated at `2026-09-05T18:43:32Z`.
- The issue explicitly rejects native unbounded following, asks for cooperative
  virtual-filesystem polling, names optional max-idle and upstream EOF, and
  requires existing `maxCpuMs` / `maxWallClockMs`. Its mention of max line count
  does not redefine `-n` as a total-output termination limit.
- Read `packages/safe-bash/AGENTS.md` fully. Root retains integration-registry,
  final frozen-tree gates and any later Git/release ownership. This round writes
  only this plan. Existing evidence under
  `/home/kjopek/kamilio-validation-569-575.RoFXyZ` remains untouched.
- Earlier read-only observations at the earlier `af9f1b23b` baseline were invalid
  follow options and snapshot-only Memory streaming. They are historical evidence,
  not newly executed RED results for this HEAD. Implementation starts with fresh
  deterministic RED tests against its actual then-current source.

Reviewed source SHA-256 values:

| File | SHA-256 |
| --- | --- |
| `packages/safe-bash/AGENTS.md` | `add0cac1e0c87194a1718dd340a7919119e9aa68ea642979ecd1629f7b6afcfa` |
| `packages/safe-bash/src/commands/streams.ts` | `6f68e032bc4a0bef05f5ecd6d01836a7f394d66f3d7e827894d96108fc3defc3` |
| `packages/safe-fs/src/contracts/filesystem.ts` | `8a3996632dedca4debcae8b724c2e88ed2c3e51713b40935db51844f9b83413a` |
| `packages/safe-bash/src/contracts/filesystem.md` | `c3224e690ce5b4b014ead1d4c25cbd76cd3f3c7717e9023bbd2567151e746e7e` |

These are provenance, not hashes to pin in reusable tests.

## 2. User-facing shape

Examples, running inside a Shell with its existing configured limits:

```sh
tail -n 0 -f /logs/app.log
tail -n 20 -F --max-idle 2 /logs/app.log
tail -c 128 -f --max-idle 0.5 /logs/app.log
producer | tail -f -n 2
```

### Proposed command profile

- Preserve all existing finite invocations unchanged, including legacy `-NUM`,
  `-n`, `-c`, `+N`, `-q`, `-v`, multiple operands, `--`, byte handling, and errors.
  `-n N` / `-c N` select the initial suffix, not the lifetime output count.
  `-n 0` / `-c 0` suppress initial contents, not future appends.
- Add `-f` and `-F`. If both occur, the last mode occurrence wins, including
  combined short options; retain argument order rather than relying on the
  existing options parser's unordered flag set. `--follow`, `--retry`, `-s`, and
  a new total-line-count flag are not part of this change.
- Add optional `--max-idle SECONDS` only with follow. Accept finite nonnegative
  decimal seconds, including fractions; reject missing, negative, nonnumeric,
  nonfinite or unrepresentable millisecond values as usage errors before I/O.
  Zero means initial selection only, with no follow/retry wait. Omission adds no
  idle deadline. No environment variables or new Shell limit defaults.
- Idle is invocation-wide inactivity across selected sources. Initial selection
  finishes before the idle window starts. Nonempty source progress, including
  bytes skipped for `+N`, resets inactivity; successful delivery of that progress
  establishes the next idle window. Empty reads, metadata changes, repeated
  retry errors and empty-file replacements do not reset it. Do not classify an
  awaited output write as idle or discard an admitted write to report idle
  success; the shared Shell deadline/cancel still governs that wait.
- Idle exhaustion and actual stdin EOF are normal completion absent earlier
  operand failures. Usage errors retain exit 2; operand failures retain exit 1.
  Follow errors are reported in operand order, with accepted stdout prefixes
  preserved. Retry diagnostics occur once per error-state transition, not on
  every poll. Recovery does not erase an already reported operand failure in
  this proposed profile.
- A named `-f` operand must open successfully initially; a missing operand fails
  rather than becoming name-follow. An opened descriptor remains readable
  across rename/unlink, without reopening the old pathname.
- `-F` retries transient name/type/access failures: `ENOENT`, `ENOTDIR`, `EACCES`,
  `EPERM`, and `EISDIR`. An unsupported retained reader, unknown identity,
  cancellation, output failure, or other non-retryable backend failure is not
  disguised as a retryable missing file.
- Proposed name-follow cutover: when the name is unavailable, retain the old
  reader only for identity continuity and suspend its data reads. Once a
  candidate opens, compare both pinned resources. Resume the old offset for
  the same identity; for a distinct identity, close the old reader and begin
  the replacement at byte zero. Do not chase an ever-growing old file before
  switching. An initially missing file's first successful open receives normal
  initial selection; subsequent replacements start at zero.
- `-f` with stdin uses the finite stream behavior and terminates at upstream EOF;
  it does not poll or reopen stdin. `+N` remains able to stream before EOF.
  `-F` requires named operands: following stdin by name fails explicitly.
  Never consume otherwise-unused stdin solely to discover EOF, or let the
  default empty stdin terminate named-file follow. With mixed stdin and named
  operands, EOF retires stdin while named followers remain active. An optional
  idle stop on active stdin must finish its retained suffix and drain its
  admitted iterator work before completion.
- Initial multi-file headers retain current order and `-q` / `-v` behavior.
  During follow, emit a header only when emitting data requires a source switch;
  metadata-only polls and retries must not produce headers repeatedly.

The retry, cutover, idle and stdin rules above are the concrete proposed profile
for root review, not a claim of complete GNU compatibility. Bounded native
comparison precedes implementation of those observable decisions; differences
must be reported rather than silently changing the approved profile.

### Boundaries of the promise

The normal Shell supplies shared cancellation and budgets. A directly invoked
custom command host still supplies a meaningful deadline/signal and cooperative
filesystem/output implementations, as with existing stream commands. Optional
idle bounds inactivity, not arbitrary host execution or cleanup. No promise
preempts synchronous host code, forces a hostile promise to settle, or detects
unobserved truncate-and-regrow/ABA events. Output byte limits remain existing
Shell/output policy, not a second tail-specific budget.

## 3. Implementation details and technical decisions

### Current contracts and integration points

| Current location | Verified fact and implementation consequence |
| --- | --- |
| `packages/safe-bash/src/commands/streams.ts:129` | `headTail` parses only finite options and selects bounded `prefix` / `suffix`; retain this path for non-follow invocations. |
| `packages/safe-bash/src/commands/streams.ts:271` | The array directly contains `headTail("head"), headTail("tail")`; change this tail member, not each factory. Preserve tee and other members byte-for-byte. |
| `packages/safe-bash/src/commands/index.ts:21` and `packages/safe-bash/src/browser.ts:31` | Standard and browser compositions already call `streamCommands`; agent composition delegates to standard. No name-search or command-shadow registration is needed. |
| `packages/safe-fs/src/contracts/filesystem.ts:6` | `FileStat` already has optional `identityScope`, `dev` and `ino`. |
| `packages/safe-fs/src/contracts/filesystem.ts:105` | `ReadStreamOptions` has `start`, `endExclusive`, `chunkSize` and signal; a finite stream is not a reusable live reader. |
| `packages/safe-fs/src/contracts/filesystem.ts:111` | `FileSystem` has optional stream methods and `capabilitiesFor`, but no public retained-open reader. |
| `packages/safe-fs/src/node/filesystem.ts` | The separate `NodeFsImplementation` bridge's selected native methods do not include `open`; it is not an existing retained-reader contract. Leave it unsupported unless separately authorized. |
| `packages/safe-bash/src/contracts/filesystem.md:156` | Complete identities require actual backing authority plus valid device/inode; wrappers cannot invent scope. |
| `packages/safe-fs/src/fs/mount/comparison.ts:37` | Entry-view comparison resolves current paths. Do not use `compareEntry` or fresh path stats to compare a historical open reader. |
| `packages/safe-bash/src/contracts/command-requirements.ts:68` | Requirement admission rejects explicit unsupported capabilities but permits unknowns; new follow admission also explicitly requires positive retained capability and a callable method. |
| `packages/safe-bash/src/contracts/output.ts:14` | `createOutputOperation` registers cleanup before acquisitions and respects owned-output closure. Its `acquire` registers a new disposer each time; do not use it once per poll. |
| `packages/safe-bash/src/contracts/yield.ts:41` | `yieldTurn` runs the checkpoint attached to the exact supplied signal, then schedules a real turn. Use the original context signal for shared CPU accounting. |

### Minimal retained-reader interface

Proposed additions to the existing SafeFS contract:

```ts
export interface FileReadHandle {
  stat(options?: FsOptions): Promise<FileStat>;
  read(position: number, maxBytes: number, options?: FsOptions): Promise<Uint8Array>;
  close(): Promise<void>;
}

export interface FileSystemCapabilities {
  readonly retainedRead?: boolean;
}

export interface FileSystem {
  openReadFile?(path: string, options?: FsOptions): Promise<FileReadHandle>;
}
```

These are additive members of existing interfaces, not duplicate declarations to
paste wholesale. The handle has no `identityScope` property.

- Acquisition opens a regular file with existing path, confinement and read
  permission semantics. `stat` and positional `read` always address that same
  opened resource, never a later pathname lookup. Appends and observed
  truncations become visible after EOF; EOF does not close the handle.
- `stat` returns a fresh metadata snapshot. Complete identity comes only from
  its `FileStat.identityScope/dev/ino`. Preserve zero IDs; require finite,
  nonnegative safe-integer IDs and an object/symbol scope. Missing or invalid
  components mean unknown, even if the numeric IDs match.
- `read` validates a nonnegative safe-integer position, positive safe-integer
  maximum, and checked offset arithmetic before admission. It returns an owned
  `Uint8Array` no larger than requested; short reads and empty EOF are allowed.
  Retaining or mutating returned bytes must not change backend storage or a
  later result. It does not promise a transactionally stable whole-file view.
- Every operation checks pre-abort before backend work and preserves falsey
  thrown/cancellation reasons. `close` takes no already-aborted signal, is
  idempotent, blocks new operations, drains admitted operations, and attempts
  underlying release exactly once. Operations after closing reject `EBADF`.
- `retainedRead: true` certifies resource retention, not identity completeness;
  `-f` can use a truthful reader whose identity is unknown. `-F` additionally
  requires complete identity on each admitted reader. Neither optional method
  existence alone nor `streamingRead: true` grants retained-read admission.
- This is a new optional injected VFS read-lifetime contract, not a new ambient
  host privilege. Do not add watchers, native subprocesses, or object-store
  guarantees that the backend cannot supply.

### Backend and wrapper implementation

| Backend/wrapper | Existing behavior | Retained-reader implementation/admission |
| --- | --- | --- |
| Memory, `fs/memory/index.ts:540` | `readStream` captures `node.data` and a finite end. `snapshot` at line 251 publishes the store scope only while its owned-store check is intact. | Resolve once and retain the file node, not its current byte array. Each read uses that node's current data; each stat snapshots the same node. Keep scope truthfulness and existing ownership guards. Audit subclass/instance overrides: do not silently bypass a customized read/permission policy with inherited stock acquisition; refuse until the host explicitly provides compatible retained semantics. |
| Real, `fs/real/index.ts:492` | A native `FileHandle` is already opened using confined resolution, `O_RDONLY`, `O_NOFOLLOW`, `O_NONBLOCK`, regular-file validation, positional reads and finally-close. It is currently private to one finite generator. | Expose a separate retained acquisition sharing those security checks and typed errors, not a path-reopening stream loop. Use native handle stat/read/close. Preserve the existing truthful native identity scope; late acquisition after abort must still close. |
| ReadOnly, `fs/readonly/index.ts:33` | Explicit wrapper methods; `fs/capabilities.ts:7` whitelists read capabilities. | Add `retainedRead` to that whitelist and add explicit acquisition forwarding together. Preserve backing handle identity, read-only authority and owned bytes; never advertise a method the selected backend lacks. |
| Quota, `fs/quota/index.ts:161` | Proxy forwards/binds unknown methods; `quotaCapabilities` preserves other capability fields. It deliberately masks `canonicalizeMissingTarget`. | Audit and test genuine forwarding of this read-only handle, including pre-abort and identity. Keep existing quota/mutation authority and the #620 canonicalization mask unchanged; do not accidentally expose a mutation method or strengthen capability. |
| Mount, `fs/mount/index.ts:162` and `:582` | Per-path capabilities and stream reads resolve the selected mount; snapshots preserve backing identity. | Add the new method to the optional-method handling and resolve once per open. Hold the actual backend reader through rename/rerouting, never re-resolve stat/read. Check selected backend capability and method inside open; preserve virtual-path diagnostics and synthetic-directory errors. |
| Overlay, `fs/overlay/index.ts:121` and `:829` | Selected entry views/streams choose upper or lower. There is currently no `capabilitiesFor`; global capabilities summarize both layers. | Add truthful selected-entry `capabilitiesFor` and per-open revalidation. Pin the selected backend handle without copy-up. Lower readers stay lower after copy-up; later opens can select upper and carry its genuine scope. Preserve other capability answers rather than broadening existing mutation claims. Mixed-backend support must not be lost to a global negative summary or fabricated from global unknown. |
| S3, `fs/s3/filesystem.ts:243` and `:835` | Metadata has no inode identity; streaming uses conditional/ranged object GET with ETag checks. Mock S3 advertises streaming, not live inode retention. | Keep retained reading absent/false and refuse follow with `ENOTSUP`. No GET-after-EOF emulation, ETag-to-inode conversion or invented object-version live handle. Finite tail continues to work. |
| WebDAV, `fs/webdav/webdav.ts:605` and `:742` | Path metadata lacks inode identity; `readStream` fetches and slices a finite response. | Keep retained reading absent/false and refuse follow with `ENOTSUP`, including through wrappers. Existing finite reads are unchanged. |

Implementations must verify capability at the resource-opening authority, not
only in a preceding path query. `capabilitiesFor` is useful for admission and
diagnostics, not a lease: a route can change before open. A missing-name query
must remain a retryable path failure for `-F`, not be flattened into unsupported.
Generic wrappers may preserve a genuine capability; they cannot manufacture
retention or scope from wrapper identity, mount name, URL, credentials or ETag.

### Follow state machine and scheduling

1. Parse/validate all options and check pre-abort before any filesystem work.
   Keep non-follow invocation on the unchanged finite handler. Declare separate
   finite-input and retained-follow support metadata; evaluate actual selected
   paths rather than rejecting a supported mounted file using global summaries.
2. Register one invocation-owned follow session before the first open or timer.
   Acquire named operands in argument order. Each successful initial handle
   stat establishes an initial end offset. Read no further than that initial
   boundary for initial suffix selection; concurrent appends belong to follow.
   A short read/truncation cannot cause a spin waiting for the old size.
3. Reuse/extract existing bounded suffix/prefix algorithms only where necessary;
   keep the existing 32 MiB tail-buffer policy and exact incomplete-line/byte
   behavior. Stream initial scanning in bounded chunks, rather than readFile.
   For `+N`, retain the skip counter across future appends until satisfied;
   a new replacement restarts at zero, not a second initial-suffix selection.
4. Use a small default poll delay of 100 ms and reads of at most 64 KiB. These
   are work granularity, not lifetime limits. Capture a finite size observation
   for each round; do at most one bounded read per active file per round,
   rotating fairly. Drain an observed backlog in cooperative rounds without
   sleeping between every chunk. Never chase an increasing file size in one
   synchronous or microtask-only loop.
5. `-f`: stat/read the pinned reader only. If observed size falls below the
   acknowledged offset, report the truncation transition and reset to zero.
   Growing size exposes appended bytes. Short reads advance only by bytes
   actually accepted; a zero read ends that round, not the lifetime reader.
6. `-F`: periodically open a candidate from the name even when size/mtime are
   unchanged. Compare its pinned stat to the current pinned stat while both
   readers remain held. Same complete tuple means same resource; differing
   scope or IDs means distinct. Close an equal candidate immediately; a
   distinct candidate replaces the current reader under the cutover rule.
   Unknown identity fails closed before emitting that candidate's data. Do not
   compare stale cached path stats or claim safety against malicious adapters.
7. In-place same-size overwrites are not appends; do not replay bytes on mtime
   alone. Replacement of the same size and mtime but different actual identity
   must be detected. A truncate-and-regrow entirely between observations can
   escape detection; the current stat/read interface cannot promise otherwise.
8. Await every stdout/stderr write. Keep offsets/output-prefix state consistent
   with acknowledged writes; do not prefetch unbounded output. Newline/header
   handling and cancellation checkpoints must also work for split UTF-8 and
   newline-free binary chunks without decoding the data path.
9. Check operation-signal cancellation around I/O, and call
   `yieldTurn(context.signal)` between bounded initial/follow rounds and after
   waits. The derived output-operation signal alone does not carry the Shell's
   registered CPU checkpoint. Never create/reset a Shell or its budgets.
10. Implement poll/idle scheduling with a small injectable monotonic scheduler
    matching the existing `SleepScheduler` shape in
    `commands/time-env/shared.ts:3`. Keep injection internal to the tail helper
    for deterministic tests, with production defaults at the stream member.
    No public command-factory options are needed. Clear timers/listeners on
    every stop; bound native timer slices for large delays without reducing the
    caller's configured limit. Recheck time/signal after wakeup.

### Resource ownership, late acquisition and failure ordering

- Use `createOutputOperation` for owned-output close/cancellation and accepted
  writes. Register a single session owner before resource acquisition, not a
  fresh permanent cleanup callback on every candidate open. The current
  `acquire` callback array would otherwise grow with every `-F` poll.
- Keep one current reader per admitted operand, one sequential candidate/open
  slot, bounded active stat/read work, and one scheduled wait. Close/discard
  equal or rejected candidates before the next acquisition. Drain and remove
  retired resources rather than accumulating historical handles/promises.
  Metadata scales with operand count, not elapsed poll count. Do not introduce
  an unrelated default file-count or PATH-entry cap.
- Mark the session closed before stopping admission. A native/adapter open
  that settles after cancellation, downstream closure, idle stop, or another
  failure is still owned and must be closed once. A race that simply rejects
  the command and abandons the pending open is insufficient.
- Finish/drain admitted stat/read/open/close work before session cleanup
  completes. Keep an admitted read buffer owned until its operation settles.
  Owned downstream consumer closure stops new polls and opens. Invocation
  cleanup must see the same drain promise as command finally/abort cleanup.
- Preserve the package hierarchy: root caller cancellation, then escaping
  execution/control failure, then local cancellation, then cleanup-only error.
  Preserve exact falsey reasons and accepted stdout prefixes; cleanup failures
  do not replace primary failures. A close-only failure on otherwise normal
  completion remains observable. A finished invocation starts no detached
  timer, filesystem work or output.
- A cooperative API cannot guarantee bounded drain of an arbitrary host
  operation that never settles or ignores cancellation. Make this limit
  explicit in the contract rather than claiming a timer preempts host work.

## 4. Interfaces and test plan

### Proposed module boundary

```ts
interface TailFollowOptions {
  readonly scheduler?: SleepScheduler;
}

function tailFollowCommand(
  finiteTail: CommandDefinition,
  options?: TailFollowOptions,
): CommandDefinition;
```

Place this meaningful finite/follow dispatch and state machine in a new
`packages/safe-bash/src/commands/tail-follow.ts`. The existing stream member
becomes `tailFollowCommand(headTail("tail"))`. This is one direct member
integration, not registry shadowing. Keep the helper internal; do not add a new
package export or duplicate tail registration. If extracting existing selection
helpers is necessary, move only those helpers without semantic changes and
prove byte-preserving no-follow behavior; do not refactor tee or other members.

SafeFS's contracts and core barrels already export the filesystem module.
SafeBash's explicit re-export in `src/contracts/filesystem.ts` needs the new
type. Extend the existing filesystem contract documentation with retention,
identity, ownership and cancellation semantics; do not add a README section.

### Deterministic RED/GREEN matrix

Use Memory and tiny fake readers/schedulers; use `memfs` with mocked native
handles for Real, following `safe-fs/tests/cleanup-semantics.test.ts` and
`directory-admission.test.ts`. No unit test creates host files, sleeps for
seconds, allocates large logs, or infers heap/OOM/performance from elapsed time.

| RED case before implementation | Required GREEN/control |
| --- | --- |
| `tail -n 0 -f` is rejected by the current finite parser. | A three-byte append is emitted once, after initial suppression; cancel/idle cleanup finishes deterministically. No-follow control stays byte-identical. |
| There is no reusable public reader after EOF. | Memory and mocked Real read `a`, empty EOF, then appended `b` through the same handle. Assert one acquisition, bounded read sizes and owned returned buffers. |
| Reopening a pathname cannot retain a renamed/unlinked file. | Open old file, rename/unlink it, append through an independent reference, and create a different file at the old name. `-f` emits only the old resource's append. |
| Size/mtime-only replacement detection misses a replacement. | Same-size, same-mtime replacement with a different inode emits new bytes from zero under `-F`; ordinary in-place same-size overwrite does not replay. |
| Numeric IDs alone collide between backends. | Two scopes with equal dev/ino are distinct. Aliased mounts of the same backing resource remain equal. Upper/lower copy-up changes identity only for new opens; the old lower reader remains pinned. |
| Missing/invalid identity cannot prove same or distinct. | Absent scope, malformed IDs, and identity loss while retained refuse `-F` without candidate output; truthful identity-free reader still supports `-f`. Zero IDs remain valid. |
| Global capability summaries misclassify mixed wrappers. | Supported Memory path inside mixed Mount/Overlay works; S3/WebDAV route refuses. Test false/unknown flag, absent method, method-only host, selected-route changes between query and open, readonly whitelist and quota mask. |
| An inherited stock reader could bypass customized read policy. | Modified-adapter controls refuse or explicitly opt into truthful custom acquisition; no policy bypass or fabricated stock identity. Preserve #620 CP hook masking/dispatch controls. |
| Opening a missing `-F` operand currently fails immediately. | Script ENOENT, creation, append; first admission applies initial selection once. Retry errors are transition-bounded; `-f` missing does not retry. Missing/candidate-unknown/nonretryable I/O are distinguished. |
| Truncation invalidates the saved offset. | Observe size below offset, reset once, emit rewritten content; repeat with zero truncation. A tiny truncate/regrow-between-polls control documents the undetectable case rather than a false pass. |
| A same-reader candidate needlessly switches/replays. | Candidate closes once, current reader and offset survive. Test symlink retarget, equal identity through another mount, disappearance/reappearance, and distinct replacement while an old read is pending. |
| Follow can starve timers or other operands. | Immediately resolving stat/read promises still hit real yield checkpoints. A continuously growing tiny fixture cannot monopolize a round; a second file progresses. Exact read/open counts follow scripted rounds. |
| A derived output signal can miss shared CPU checkpoints. | A Shell-attached original-signal checkpoint stops the loop; existing wall deadline/caller abort also stop it. A command earlier in the same execution consumes the shared budget; tail does not reset it. |
| A hardcoded idle/absolute limit would shrink Shell configuration. | Fake time passes 5 seconds idle without `--max-idle`, and 30 seconds of continued progress under deliberately longer existing Shell limits, without tail-specific termination. Explicit idle stops exactly under the proposed inactivity profile. No real-time long test. |
| Option parsing can lose ordering or alter finite syntax. | Test `-fF`, `-Ff`, separate repeated modes, `--`, filename `-f`, `-NUM`, n/c conflict, q/v, `+N` crossing an append, count zero, partial final line, binary bytes and split UTF-8. Usage failures make zero FS calls. |
| EOF and inactive default stdin can be confused. | Actual stdin finite EOF returns; default empty stdin does not stop named-file follow; mixed-input EOF retires stdin only. `-F -` refuses name following. Active-stdin idle releases/drains the iterator and emits its bounded suffix. |
| Retry or empty metadata polls can continually reset idle. | Missing path and repeated empty replacements still reach explicit max-idle. Progress on any operand resets global inactivity. A blocked output write remains awaited rather than being dropped as idle success. |
| Cancellation/consumer closure can leak a late open. | Deferred open resolves after prearranged abort or owned-output closure: close once, no stat/read/output afterward, command/root cleanup await the same drain. Pre-abort makes zero FS/timer calls. |
| Poll acquisitions can accumulate cleanup entries. | A small fixed number of equal-candidate rounds retains constant session slots, closes each candidate before the next, and leaves no timer/listener/current/candidate after final cleanup. Assert ownership state/counters, not heap usage. |
| Cleanup can replace the actual failure. | Table of `undefined`, `null`, `false`, `0`, empty-string and Error failures; root abort plus read/write/close failures preserve exact primary reason. Close-only failure surfaces on normal exit. |
| Output backpressure can start excess work. | A deferred sink write blocks new reads/open work; releasing it preserves exact prefix/order. Consumer close during the write stops admission, drains pending work and emits no later header/data. |
| One operand error can corrupt another operand's output. | Tiny two-file corpus asserts headers, first diagnostics, accepted prefix, retry transitions and final exit status; initial selection/error order remains stable. |

Fresh RED evidence must identify the failing assertion and current source hash;
absence of the new method is a contract RED, not a claimed runtime crash. Add
tests before each implementation slice, then run the same assertions GREEN.
Do not count historical observations, unavailable backends or mocks as native
service acceptance.

### Bounded native comparison, after root approves execution

This is a manual validation procedure, not a generated QA script. Use only a
fresh small directory in the existing approved evidence base, never `/tmp`
large fixtures or repository source files. Obtain approval for any required
outside-root writes. Record native tail/tool versions and the exact invocation.

1. Start native `tail` under an independent short supervisor deadline, with
   explicit stdout/stderr capture and readiness established by a unique
   initial output marker. Use a small polling interval where native supports
   it. Do not infer readiness or correctness from a fixed sleep.
2. With a file containing at most a few short lines, append once, rename while
   retaining an independent writer, append to the old resource, then create a
   new file at the old name. Run descriptor and name modes separately and
   synchronize mutations with observed output or diagnostics.
3. Exercise an initially missing name, temporary disappearance/reappearance,
   observed truncation, and a same-size/same-mtime replacement. Verify the
   original and replacement identities really differ; equal metadata is a
   control, not the identity oracle.
4. Check finite `-n`, `-c`, `+N`, `-n 0`, headers and pipe EOF with byte-for-byte
   tiny fixtures. Compare only the intended shared profile. Native tail has no
   required `--max-idle` counterpart; test that extension with the deterministic
   scheduler instead of falsely labeling it native parity.
5. Stop every child and close every writer within the supervisor budget
   (target at most three seconds per case). Supervisor timeout is expected
   termination for a live native follow, not a successful product exit. If a
   case cannot establish its handshake within the bound, mark it inconclusive;
   do not enlarge fixtures or infer a performance defect.
6. Record observed native retry/cutover/status differences before encoding them
   as compatibility tests. Report discrepancies to root; do not silently widen
   or narrow the proposed profile. Repeat the approved shared cases against
   RealFileSystem only when its implementation and native test authorization
   exist. The current plan round performs none of these writes or probes.

### Validation ownership and autonomy checklist

- Root approves this profile and source/test scope before any implementation.
  Re-read applicable scoped instructions and then-current source; preserve
  unrelated edits and all historical evidence. No branch, commit or push is
  authorized by this plan.
- Use focused source tests during disjoint work, without shared dist mutations.
  SafeFS tests are currently owned by root Vitest discovery, not a SafeFS
  workspace `test` script. The maintained focused route is
  `npm run test:unit -- packages/safe-fs/tests/retained-read.test.ts packages/safe-fs/tests/retained-read-composition.test.ts`.
- Focused SafeBash development uses its existing Node/tsx execution shape,
  `node --import tsx --test --test-concurrency=1`, with the exact owned test
  paths from the package directory and the admitted toolchain. This is focused
  development evidence, not a substitute for the maintained discovered suite.
  Do not run whole-package gates or rebuild declarations while workers write.
- Root adds new SafeBash test paths literally to
  `packages/safe-bash/scripts/integration-inputs.test.mjs`; do not change the
  registry concurrently or exclude new tests. Preserve authenticated historical
  membership and seals.
- After a root freeze, use maintained selected-workspace build closure and
  package/source/test/consumer type gates, package discovered tests, root tests
  appropriate to the cross-package contract, and current export-consumer gates.
  Do not typecheck against stale declarations or claim existing baseline gates
  qualify new code. Use uncached maintained routes and actual task declarations.
- Guarded ESLint is `npm run lint:eslint` from root, with only its supported
  options. There is no approved arbitrary owned-path lint route; lint remains
  pending until root's maintained run. No bypass, direct ESLint invocation,
  forbidden path operands, full concurrent build or dist write.
- Alongside new tests, run finite streams, filesystem-output, tee-target
  admission, copy-preflight canonicalization, realpath-missing admission and
  copy-identity controls. Preserve #620/#645/#631 rather than reimplementing
  their behavior. Later final report separates RED/GREEN, native observations,
  pending gates and limits, with exact source/plan hashes.

## 5. Code plan

All paths below are prospective implementation scope, not authorized edits in
this documentation-only round. Coordinate phase ownership with root; shared
contract changes must precede dependent implementation, not race jq work.

### Phase A: retained-reader contract and stock backends

1. Add RED contract tests in new
   `packages/safe-fs/tests/retained-read.test.ts`, using Memory and mocked Real
   handles. Cover append-after-EOF, rename/unlink, owned bytes, stat identity,
   cancellation, close/drain and modified-adapter admission before production
   methods. Extend the existing cleanup test only if necessary to reuse its
   native mock; keep test ownership explicit.
2. Change `packages/safe-fs/src/contracts/filesystem.ts` for the proposed
   `FileReadHandle`, optional `openReadFile`, and `retainedRead` flag. Existing
   SafeFS barrels already forward the type; do not add redundant exports.
3. Implement `openReadFile(path, options)` in
   `packages/safe-fs/src/fs/memory/index.ts` and
   `packages/safe-fs/src/fs/real/index.ts`. Keep existing finite streams and all
   unrelated filesystem methods unchanged. If sharing opening logic, extract
   only the security/ownership primitive required by both readers.
4. Add `FileReadHandle` to the explicit SafeBash type re-export in
   `packages/safe-bash/src/contracts/filesystem.ts`; update
   `packages/safe-bash/src/contracts/filesystem.md` with the additive contract
   and its unknown-identity/non-preemption limitations. No README edits.

### Phase B: composition and truthful admission

1. Add RED cases in new
   `packages/safe-fs/tests/retained-read-composition.test.ts` for readonly,
   quota, mixed mounts/overlays, copy-up, aliases, late acquisition and false
   capability/identity claims. Test S3/WebDAV refusal with bounded existing
   mock transports; no network or live-service test.
2. Change `packages/safe-fs/src/fs/capabilities.ts` and
   `packages/safe-fs/src/fs/readonly/index.ts` together for the read-only
   whitelist and method forwarding. Quota's existing proxy may already suffice;
   change `packages/safe-fs/src/fs/quota/index.ts` only if a RED proves a real
   retained-read admission/ownership gap. Preserve its canonicalization mask.
3. Change `packages/safe-fs/src/fs/mount/index.ts` for one-time selected-backend
   open and pinned forwarding. Change
   `packages/safe-fs/src/fs/overlay/index.ts` for truthful selected-entry
   `capabilitiesFor(path, options)` and pinned `openReadFile(path, options)`.
   Keep stat snapshots' genuine backing identity; no wrapper-derived scope.
4. S3/WebDAV need no pretend implementation. Their unchanged absent capability
   is sufficient refusal; modify a capability declaration only if explicit
   false is necessary for accurate existing support reporting. No protocol
   client, ETag or transport redesign.

### Phase C: tail only

1. Add parser/behavior REDs in new
   `packages/safe-bash/tests/commands/tail-follow.test.ts`, with tiny retained
   fake readers and deterministic scheduling. Capture finite-tail controls
   before extracting or changing any selection helper.
2. Add `packages/safe-bash/src/commands/tail-follow.ts` for the parser,
   meaningful finite/follow dispatch, per-operand state, scheduler and one
   invocation-owned session. Keep identity comparison local to pinned
   `FileStat` tuples; do not misuse pathname `compareEntry`.
3. Change only necessary tail integration/import/helper extraction in
   `packages/safe-bash/src/commands/streams.ts`. Retain the existing
   `streamCommands(maxTeeTargets)` API. Preserve tee and all other command
   members byte-for-byte; no per-factory `find`, filter or name-shadow logic.
4. Keep `commands/index.ts`, `browser.ts`, `plugins/index.ts` and package
   exports unchanged unless an independently demonstrated integration defect
   requires root-approved scope expansion. Tests verify standard/browser/agent
   compositions expose exactly one tail with the new behavior and keep tee
   configuration unchanged.

### Phase D: lifecycle integration and qualification

1. Add new
   `packages/safe-bash/tests/shell/tail-follow-lifecycle.test.ts` for original
   signal CPU checks, shared wall-clock/deadline, falsey cancellation, output
   backpressure/consumer closure, late open/drain, prefixes and cleanup failure
   precedence. No tests alter Shell defaults or substitute a fresh Shell per
   poll. Root registers both new SafeBash test paths.
2. Run focused GREEN plus adjacent tests:
   `packages/safe-bash/tests/commands/streams.test.ts`,
   `packages/safe-bash/tests/commands/filesystem-output.test.ts`,
   `packages/safe-bash/tests/commands/tee-target-admission.test.ts`,
   `packages/safe-bash/tests/commands/copy-preflight-canonicalization.test.ts`,
   `packages/safe-bash/tests/commands/realpath-missing-admission.test.ts`, and
   `packages/safe-bash/tests/commands/copy-identity.test.ts`.
3. Execute the approved bounded native cases, report semantic differences and
   limits, and obtain root's frozen-tree maintained qualification. If feature
   priority metadata is to change, root separately owns that update; this plan
   does not expand into README, priority documents or registry edits now.
4. Return exact files/hashes, actual RED/GREEN results, optional backend support,
   unresolved qualification and the host-cooperation limits. Stop before any
   commit or delivery action unless root explicitly authorizes it.

## Native validation addendum: September 5, 2026

This addendum records the subsequently authorized native-only investigation.
The earlier statements that no probes ran describe the original planning round,
not this follow-up. Product/source/tests, README, registry, build output and Git
state were not edited by this investigation. Existing concurrent changes and
earlier evidence were left alone.

### Approval boundary

Root approved EOF applying only to consumed stdin: default empty stdin must
never terminate named-file follow. That approval does not approve the other
proposed stdin options or grant implementation authorization.

Root has not yet approved either old-resource suppression after name loss or
the final-status policy for recovered errors. The native observations below
inform those decisions; they do not constitute approval. In particular, do not
implement the earlier blanket sticky-error proposal as settled policy: the
recovered later-error controls contradict it. No new idle/absolute timeout
default is proposed or inferred from the supervision limits used here.

### Oracle, isolation and bounds

- Actual executable: `/usr/bin/tail`, reporting `tail (GNU coreutils) 8.30`.
  Executable SHA-256:
  `00483d769f2d15f6d3c0f6f2d9c3c8dde3d377094d8411738f0f3b335008cf84`.
- Host: Linux `5.15.0-1084-aws`, `x86_64`; the owned fixture location reports
  XFS. Child locale was explicitly `LC_ALL=C`, `LANG=C`.
- Six-case cohort started at `2026-09-05T23:29:25.751157+00:00`, against the
  same repository HEAD `d17a11832251969d2b7406736cc17b80b36408b0`. Only GNU
  tail and a controlled `/usr/bin/cat` PID sentinel ran per case; no product
  code, mocked backend, service, build or test suite ran.
- Six sequential cases; at most two child processes simultaneously; three
  seconds per protocol, one second per observable barrier, 8 KiB combined
  stdout/stderr per case, a 24-second cohort alarm and a 30-second external
  supervisor. Emergency child cleanup used bounded waits and owned-PID-only
  escalation, but no escalation was needed. Actual largest file was 57 bytes,
  largest case fixture total 127 bytes, and largest captured output 950 bytes.
- A separate two-case singleton cohort checked the surprising initial-error
  status without the healthy control operand. Its bounds were two seconds
  per protocol, 0.8 seconds per barrier, two simultaneous children, 4 KiB
  output per case, 64 fixture bytes, a six-second cohort alarm and an
  eight-second external supervisor. Each actual fixture was 31 bytes.
- No arbitrary sleeps established transitions. Every mutation followed a
  captured stdout/stderr barrier. Tail's `-s 0.05` is oracle polling cadence,
  not a product timeout or a substitute for a readiness observation.
- All eight protocols completed with stdout/stderr EOF and normal `--pid`
  termination. The parent closed the sentinel's stdin and reaped its exit 0;
  tail then exited itself. No tail received SIGTERM/SIGKILL, no supervisor
  fired, and no failed/unavailable protocol was omitted. Status 1 in the
  tables is an observed normal tail result, not a harness failure.
- All owned tail/sentinel children were reaped and pipe/writer handles closed.
  Only explicitly created fixture names were unlinked and the six empty case
  directories removed. Small JSON evidence remains in the two unique owned
  outside-repository directories; no shared `/tmp` artifacts or existing
  evidence were overwritten. No broad process or filesystem cleanup ran.

Raw evidence, including literal argv/PIDs, complete stdout/stderr, transition
order, cleanup records and return codes:

| Cohort | Report | SHA-256 |
| --- | --- | --- |
| Six two-operand cases | `/home/kjopek/kamilio-validation-569-575.RoFXyZ/tail639-native-20260905.qi8ya7ji/report.json` | `5ec83081cb6514bf51fd91cbae0ef4e538bf1dc5f6c15152df44cd52eff7715d` |
| Two singleton initial-missing cases | `/home/kjopek/kamilio-validation-569-575.RoFXyZ/tail639-singleton-20260905.690xj46x/report.json` | `6ab37754c6e8711f4247ddffee39529b44accc1146f307916eff63951b79aac1` |

The first report is 21,942 bytes; its complete directory retained 41,481 bytes
of JSON after fixture cleanup. The second cohort is separate, not an overwrite
or an undocumented increase of the first cohort's six-case admission bound.

### Exact invocation shapes and transition barriers

Default profile:

```sh
/usr/bin/tail -F -n +1 -s 0.05 --max-unchanged-stats=1 --pid=SENTINEL_PID TARGET CONTROL
```

Forced-polling profile adds the accepted GNU option `---disable-inotify` before
`-F`. Descriptor controls substitute `-f`. Singleton initial-missing controls
omit `CONTROL`. Actual absolute paths and numeric PIDs are in each report.
"Default" describes unforced invocation, not a separately instrumented proof
that the process selected inotify internally.

For rotation/retry, await both initial data markers, rename `TARGET` to the
owned old name while retaining a writer, then await the target diagnostic
`has become inaccessible: No such file or directory` before appending
`OLD_AFTER_MISSING` to the old resource. Append `CONTROL_AFTER_MISSING` to the
healthy control and await it on stdout. Create a replacement at `TARGET`, await
`has appeared;  following new file` and `NEW_TARGET` on stdout, then append
`OLD_AFTER_REOPEN` to the old writer and `NEW_APPEND` to the replacement.
Await replacement/control data before releasing the PID sentinel. The recorded
old-file contents prove both old writes actually reached that resource.

Descriptor controls use initial stdout as readiness, rename, then await both
old-resource and control markers; no unavailable-name diagnostic is expected
in descriptor mode. Replacement bytes must not become descriptor-follow data.

For initially missing names, await `cannot open ... for reading: No such file
or directory` before creating the file. Await the appearance diagnostic and
recovered data, append one more marker, and await it before releasing the
sentinel. Two-operand cases additionally await the healthy control's startup
marker; singleton controls have no second file.

### Observations

| Profile | Case | Old append after missing/rename | Old append after replacement | Replacement/recovery data | Normal tail status |
| --- | --- | --- | --- | --- | --- |
| Default | `-f`, two files | Emitted | Emitted | Replacement not emitted | 0 |
| Forced polling | `-f`, two files | Emitted | Emitted | Replacement not emitted | 0 |
| Default | `-F`, initially present, loss then recovery | Not emitted after unavailable diagnostic | Not emitted | Replacement and append emitted | 0 |
| Forced polling | `-F`, initially present, loss then recovery | Not emitted after unavailable diagnostic | Not emitted | Replacement and append emitted | 0 |
| Default | `-F`, initially missing plus healthy control | Not applicable | Not applicable | Recovery and append emitted | 0 |
| Forced polling | `-F`, initially missing plus healthy control | Not applicable | Not applicable | Recovery and append emitted | 1 |
| Default | `-F`, initially missing singleton | Not applicable | Not applicable | Recovery and append emitted | 1 |
| Forced polling | `-F`, initially missing singleton | Not applicable | Not applicable | Recovery and append emitted | 1 |

Both name-follow profiles suppressed old-resource writes after the observed
unavailable-name diagnostic, while positive descriptor controls delivered them.
This supports the proposed output-suppression rule for the tested rename/loss
sequence. It does not establish whether GNU closed or retained the old internal
descriptor, what happens before that diagnostic, or every permission/unlink/
same-identity reappearance case. Our pinned-reader identity requirement remains
a separate contract decision; native stdout does not authenticate its internals.

Recovered later name loss ended with status 0 in both profiles. Therefore an
already printed retry diagnostic cannot by itself justify sticky exit 1.
Recovered initial absence ended with status 1 in both singleton controls and
the forced-polling two-file control, but status 0 in the default two-file
control. Preserve this distinction: there is no single uniformly observed
"GNU recovered-error status" across these exact profiles. Do not replace
the default two-file observation with an assumed status, or explain its
implementation cause without additional evidence.

Recommended profile for root review, not approved: suppress old-resource data
after reported name loss; distinguish initial admission failure from later
recoverable follow errors. A coherent polling-oriented choice is initial
admission failure remaining exit 1 after recovery, while recovered later name
loss does not itself force failure. This matches the forced-polling cases and
singleton initial controls, but intentionally differs from the observed default
two-file recovered-initial status 0. Root must select/document that compatibility
target before the relevant product status assertions are finalized.

This cohort does not qualify the remaining native protocol: permissions,
unrecovered errors, same-size replacement, observed truncation, same-resource
reappearance, count/header/EOF parity and RealFileSystem integration remain
unexecuted here. No timing, heap, OOM, throughput, universal-GNU or arbitrary-host
preemption claim follows from these eight tiny controls.

### Active-handle admission proposal, not a requirement

The earlier lifetime-independent ownership bookkeeping is insufficient as a
resource admission policy: one retained reader per operand can still retain
thousands of resources within an argv allowance. An argv byte/field limit is
not a useful explicit bound on live readers. Recommend a separate public
`maxActiveFollowHandles?: number`, with proposed default **64** per tail
invocation. This is a reviewable safety-policy choice, not a measured capacity,
an author requirement, the tee/PATH cap reused under another name, or a limit
on ordinary finite tail. Root approval is required before adding it.

- Count reader instances, including reserved in-flight opens, current readers,
  comparison candidates, late acquisitions and closing readers until release
  settles. A reused slot must not allow an earlier pending close to overlap
  outside the cap. Do not infer backend resources from JS object identity or
  deduplicate alias operands in a way that changes output semantics.
- Reserve one shared comparison slot for named `-F` before any filesystem work.
  With a total cap of 64, admit at most 64 named `-f` operands or 63 named `-F`
  operands. A missing `-F` operand reserves its eventual current-reader slot;
  otherwise recovery could overcommit after initial admission. Reserve the
  comparison slot even for a zero-idle follow invocation for a simple,
  mode-consistent admission rule. Candidate processing remains sequential.
- Validate configuration as a nonnegative safe integer at construction. Zero
  disables named follow but not stdin-only `-f` or finite tail. A cap of one
  permits one named `-f` but no named `-F`. Reject excess demand before any
  path capability query, open, output header or timer, using a specific
  `FsError("EMFILE")` diagnostic and exit 1. `EMFILE` already exists in
  `packages/safe-fs/src/contracts/errors.ts`; do not silently stop processing
  operands, evict readers or switch descriptor-follow into path reopens.
- Retain current parse/pre-abort/error ordering and test exact boundary counts,
  zero, invalid configuration, named/stdin mixes, aliases, missing retries,
  candidate close, late open/drain and cancellation with tiny injected caps.
  No thousands-of-files fixture or host descriptor exhaustion test is needed.
- The cap limits admitted handles in one cooperative tail invocation, not
  process-wide native descriptors, other commands/invocations, arbitrary host
  method internals, output bytes or elapsed time. It is not a substitute for
  the existing Shell budgets or host resource policy.

Conditional public wiring if root approves this cap:

1. Add the optional field to `StandardCommandsOptions` at
   `packages/safe-bash/src/commands/index.ts:15`, `BrowserCommandsOptions` at
   `packages/safe-bash/src/browser.ts:25`, and `AgentCommandsOptions` at
   `packages/safe-bash/src/plugins/index.ts:28`.
2. Extend the existing internal signature at
   `packages/safe-bash/src/commands/streams.ts:211` to
   `streamCommands(maxTeeTargets = 64, maxActiveFollowHandles = 64)`. Pass the
   new value only to the existing tail member/helper; preserve tee's parameter,
   validation and member bytes. Do not shadow tail by name in any factory.
3. Forward the value through the existing standard call at
   `packages/safe-bash/src/commands/index.ts:32`, browser call at
   `packages/safe-bash/src/browser.ts:35`, and agent-to-standard options at
   `packages/safe-bash/src/plugins/index.ts:74`. Extend the proposed internal
   `TailFollowOptions` with the cap while retaining its scheduler seam.
4. Test the actual standard/browser/agent factory routes and option types,
   default/override admission, and unchanged tee behavior. Existing plugin
   forwarding should inherit the field; no new CLI flag, environment variable,
   Shell default, package export, registry shadow or SafeFS global limit.

This conditional wiring would expand Phase C's original no-factory-change
scope. It is explicitly proposed here for root review, not silently authorized
by the earlier plan or by the native-only cohort authorization. No cap or
product-status implementation was made in this follow-up.

## September 6 native sidecar: 28 additional observations

These observations were collected before Phase A, on clean HEAD
`a4567fa3e5d0a9f7f88d33417b294ea3d8714d4b`. The committed plan then had SHA-256
`4a9e82f06fd7aedc73d026e2270e7411d3a637b2ce3cae10a9117b76735d9fcb`.
The installed oracle remained GNU tail 8.30 with executable hash
`00483d769f2d15f6d3c0f6f2d9c3c8dde3d377094d8411738f0f3b335008cf84`.
The earlier eight controls and their differing default-profile results remain
preserved; these additional live cases selected forced polling only.

### Bounds and literal evidence

The primary sidecar admitted 15 live and nine finite cases, at most two children
at once, three seconds per live protocol, one second per transition barrier,
4 KiB output per case, and 512 fixture bytes per case. Its cohort alarm was
30 seconds with an external 35-second supervisor. The four-case boundary
follow-up used three-second protocols, 0.8-second barriers, the same child and
output caps, 256 fixture bytes per case, and 12/16-second cohort/supervisor
bounds. Neither cohort used arbitrary sleeps as readiness or mutation barriers.

Live argv used `/usr/bin/tail ---disable-inotify`, `-s 0.05`,
`--max-unchanged-stats=1`, and `--pid` for a controlled cat sentinel. Mode/count
variants and actual operand names are recorded literally in the reports. The
sentinel exited normally after its stdin was closed; finite cases used actual
stdin/file EOF. No SIGTERM/SIGKILL or supervisor timeout supplied an asserted
successful status. Every child was reaped, writers/pipes were closed, and only
owned fixtures were removed. No repository file was written by that sidecar.

| Report | SHA-256 |
| --- | --- |
| `/home/kjopek/kamilio-validation-569-575.RoFXyZ/tail639-sidecar-20260906.l0k38zq4/report.json` | `961da1afebf2eaa2dd66679fa6bf342a508dc2961cf9d79354158e7436cce063` |
| `/home/kjopek/kamilio-validation-569-575.RoFXyZ/tail639-boundary-20260906.dcn1_by3/report.json` | `d7d2827c8ad741cca782c1746a7e67522c5bbc1994940dd78918f74fd796bf3f` |

The first directory retained 94,987 bytes of JSON, the second 23,796; neither
retained fixture files/directories. Maximum captured case output was 1,025
bytes. The raw reports contain actual argv/PIDs, stdout/stderr, metadata where
needed, mutation barriers, statuses and cleanup records.

### Outcomes and remaining command decisions

| Cases | Observed result |
| --- | --- |
| Same-size replacement, `-F` / `-f` | Verified equal size and nanosecond mtime, distinct dev/ino identity. Name-follow emitted replacement bytes; descriptor-follow emitted only old-resource appends. Both exited 0. |
| Observed truncate then append, both modes | Truncated to zero and awaited native `file truncated` before appending. Both read the reset contents and exited 0. This was not an unobserved truncate/regrow inference. |
| Same-resource reappearance after ENOENT, `-F -n 1` | Verified unchanged dev/ino and no old data while unavailable. Reappearance emitted the whole resource from zero, replaying earlier lines, not resuming the saved offset. Exit 0. |
| Initially missing, recovered / unrecovered | Both exited 1. On recovery, `-n 1` emitted both initial lines from zero, not a newly selected last-line suffix. |
| Later missing, unrecovered at termination | Suppressed old-resource output and exited 0 under controlled normal termination. |
| Initially EACCES, recovered / unrecovered | A separate open proved actual permission denial for the non-root test UID. Both exited 1. |
| Later EACCES, recovered / unrecovered | Both exited 0. Recovery replayed the same inode from zero; transitions also emitted empty target headers. |
| Initial ENOTDIR, recovered | Became readable and emitted data from zero; exit 1. |
| Initial directory, `-F -n +1` | Native exited 1 before reading the healthy control operand. The intended recovery protocol could not proceed. This is the one honest early-exit protocol failure, not an unavailable oracle or a product test failure. |
| Initial directory, `-F -n 1` | A separate follow-up observed diagnostics, recovery to a regular file, replay from zero and exit 1. |
| Later directory replacement, `-F -n 1` | Observed untailable-file diagnostic, recovery to regular-file contents from zero and exit 0. |
| Mixed stdin/named `-f` | Consumed pipe EOF retired stdin; a later named-file append still appeared. Exit 0. |
| Seven finite count/header controls | Captured `-n 1`, `-c 3`, `-n +2`, `-c +3`, multi-file headers, quiet and verbose output, including a final unterminated line. All exited 0. |
| Standalone stdin `-f` / `-F -` | Descriptor mode emitted the requested suffix and exited 0 at actual EOF; name mode rejected stdin with exit 1. |
| Follow `-n +4` with initially short file | GNU emitted subsequent second/third lines; it did not carry an unmet initial line-skip counter across EOF. Exit 0. |
| Follow `-c +5` beyond initial EOF | GNU emitted existing bytes and a truncation diagnostic even though this fixture was never truncated, then followed appends. Exit 0. This is distinct from the observed-truncation controls. |

Accounting is **28 observations, 27 completed intended protocols, one preserved
early-exit recovery-protocol failure**. The first report's
`normal_pid_termination` boolean overgeneralized positive exit plus successful
sentinel cleanup for the initial-directory `-n +1` case. The second report
explicitly corrects that classification: native exited before the initial
control barrier and before sentinel release. Do not count it as `--pid`
termination; the original report remains unchanged. There were zero cleanup
signals across both cohorts.

These observations contradict the draft's saved-offset reappearance rule,
initial-suffix-on-delayed-open rule, persistent `+N` skipping and universally
data-only follow headers. They also show that later unrecovered ENOENT/EACCES
do not independently force native failure under the selected profile. Root
must approve the concrete command-state interpretation before Phase C; Phase A
does not encode those choices. EPERM/EIO, unobserved ABA/truncate-regrow,
cross-backend composition and arbitrary host preemption were not qualified.

## Phase A local TDD and qualification boundary

Fresh RED preceded production edits on the authorized clean baseline. Command:

```sh
PATH=/var/tmp/poe-code-kamilio-toolchain.GzqQj3/bin:$PATH npm run test:unit -- packages/safe-fs/tests/retained-read.test.ts
```

The initial test file SHA-256 was
`6282b30cb69f0c54825379b21a3bce316fbb8800272befc664d266df652eb417`.
Result: **81 failed, two finite-stream controls passed, 83 total**. The missing
optional acquisition method was the deterministic RED; no timeout, large
fixture or native performance inference was used.

After implementation, fixture corrections kept acquisition counters separate
from fixture-writing handles and used memfs's append operation rather than its
FileHandle null-position append behavior. The adjacent contracts suite already
contains a special adapter for that memfs append limitation. Native-link-count
after unlink is also a memfs limitation: Memory checks zero links, while mocked
Real checks retained bytes and missing paths and forwards native metadata
without inventing zero. These are disclosed mock limitations, not source fixes
or claims of native service acceptance.

The intermediate runs were 17 failed / 66 passed before the setup/append
correction and one failed / 82 passed before correcting the mock-only link-count
expectation. Those failures were not counted as successful qualification.

An additional diagnostic RED required invalid Real ranges to retain the virtual
operand and syscall: **11 failed, 81 passed, 92 total**. Production validation
then preserved those diagnostics. Final owned suite: **92 passed**.

Normal-isolation focused adjacent command:

```sh
PATH=/var/tmp/poe-code-kamilio-toolchain.GzqQj3/bin:$PATH npm run test:unit -- packages/safe-fs/tests/retained-read.test.ts packages/safe-fs/tests/contracts.test.ts packages/safe-fs/tests/cleanup-semantics.test.ts packages/safe-fs/tests/directory-admission.test.ts packages/safe-fs/tests/real-trailing-separator.test.ts packages/safe-fs/tests/command-capabilities.test.ts packages/safe-fs/tests/migration/fs/memory/faithful-binding.test.ts packages/safe-fs/tests/migration/fs/memory/comparison.test.ts
```

Result: **269 passed across eight files**, including the 92 new tests. No
isolation bypass, host fixture, build, full guard, native repro rerun or Git
mutation was used. Test output is the current tool transcript; no additional
repository report or generated test artifact was authored.

Implemented behavior includes live pinned-node/native-handle reads, fresh
resource stat, owned positional bytes, EOF reuse, rename/unlink/truncate,
safe-integer/overflow checks, pre-abort/falsey reasons, conservative modified
stock-adapter refusal, native flag/confinement/regular-file checks, late-open
cleanup and idempotent close that drains admitted stat/read work before a
single native close attempt. Existing finite stream bodies remain unchanged.

No scope expansion was required. Wrapper admission/identity and command
factories remain Phase B/C work; the approved command cap is not implemented
here. A host close failure is observable, not proof of successful release;
uncooperative host calls may prevent drain from settling. Range bounds are not
a global allocation quota. Full source/test/public-consumer type qualification,
maintained builds, guarded lint and frozen integration remain root-owned and
pending. This is a local partial implementation of #639, not a commit, push,
release or completed issue.

## Phase B authorization and frozen local handoff

September 6, 2026: root authorized Phase B after reporting delivery of the older
fixes at `eff72fa252a36a5867c27553967fd255799fdb94`. Root reported the restored
Phase A seven-file patch byte-identical, normal build and 26 public type-consumer
groups passing, fresh 92 Phase A tests passing, and Euler's nine independent
controls without a concrete blocker. Those are root/reviewer qualifications,
not builds or reviews rerun by this worker. No Git commands were used to
independently requalify that baseline during Phase B.

Authorized and edited paths, with no scope expansion:

- `packages/safe-fs/tests/retained-read-composition.test.ts`
- `packages/safe-fs/src/fs/capabilities.ts`
- `packages/safe-fs/src/fs/readonly/index.ts`
- `packages/safe-fs/src/fs/mount/index.ts`
- `packages/safe-fs/src/fs/overlay/index.ts`
- `packages/safe-fs/src/fs/quota/index.ts`, conditional authorization exercised
  only after the fresh RED below proved admission and late-cleanup gaps.
- `packages/safe-bash/src/contracts/filesystem.md`
- `docs/plans/bugfix-639-bounded-tail-follow.md`

Phase A production and test files remain byte-identical to their restored
inputs. No wrapper change weakens the stock modified-adapter guards. The root
command profile is linked at the top of this plan, not edited. Jason's parallel
command work, root registry, Git/publication, README, builds and full guards
remain outside this worker's ownership. This handoff freezes Phase B for
root's combined qualification; it is partial #639, not closure or delivery.

### Fresh RED and controls

The initial test-only run had 60 failures and one pass among 61 tests. One
failure was a fixture mistake: stock Memory has `rm`, not `unlink`. Correcting
that fixture and rerunning before any production changes yielded **59 failed,
2 passed, 61 total**, on the exact new test file hash
`e48bcd950632c2e5d0fa161b383f1cdd6b4cf7f362de2d1dc7a1750051635b9d`.

```sh
PATH=/var/tmp/poe-code-kamilio-toolchain.GzqQj3/bin:$PATH npm run test:unit -- packages/safe-fs/tests/retained-read-composition.test.ts
```

ReadOnly/Mount/Overlay lacked acquisition and/or truthful retained capability
forwarding. Quota's incidental proxy opened paths with false/unknown or denied
path capabilities, advertised a missing method, made one backend call on
pre-abort instead of zero, and returned a late handle without closing it.
Those concrete failures justify its narrowly scoped explicit admission branch;
its mutation implementations, traversal and canonicalization mask are unchanged.

After initial production changes, the mock WebDAV fixture incorrectly used `/`
as its configured base although `MockDav` strips `/dav`. The observed routing
`EACCES` was preserved as a fixture failure, not softened into an acceptable
refusal. Correcting the base to `/dav/` yielded the first six-file GREEN:
243 tests, including the original 61 composition tests and Phase A's 92.

Additional falsey/lifecycle controls produced a second concrete RED:
**7 failed, 94 passed, 101 total**. Mount's new acquisition path converted six
falsey backend rejections into `EIO`, and converted a pre-aborted `NaN` reason
into `EIO` because the existing error helper compares reasons with `===`.
Only the new `openReadFile` catch now preserves falsey failures; other Mount
operations and their existing error mapping are unchanged.

The final routing controls initially included an incorrect cross-mount-symlink
success expectation: **1 failed, 106 passed, 107 total**. Existing Mount
resolution intentionally returns `EACCES` when a followed symlink crosses its
backend boundary. The final control asserts that refusal plus successful
within-mount symlink retention; no confinement code was changed. An intermediate
380-test run selected 11 actual files: a misspelled authority-test selector did
not select a twelfth file and is not credited as a pass. The final command below
uses the actual authority-test path and separately reports its 29 tests.

All controls use Memory, mocked native handles through memfs, or existing mock
S3/WebDAV transports. No host fixtures, native probes, network, LLM calls,
isolation override, shared builds, typechecks, lint bypasses or Git operations
were run. Gate/deferred-promise transitions drive cancellation and late-open
tests without sleeps, stress inputs or timing-based liveness claims. Results
are in the tool transcript; no extra repository evidence artifacts were written.

### Final focused GREEN

```sh
PATH=/var/tmp/poe-code-kamilio-toolchain.GzqQj3/bin:$PATH npm run test:unit -- \
  packages/safe-fs/tests/retained-read-composition.test.ts \
  packages/safe-fs/tests/retained-read.test.ts \
  packages/safe-fs/tests/contracts.test.ts \
  packages/safe-fs/tests/cleanup-semantics.test.ts \
  packages/safe-fs/tests/command-capabilities.test.ts \
  packages/safe-fs/tests/quota-scan-admission.test.ts \
  packages/safe-fs/tests/quota-hardlinks.test.ts \
  packages/safe-fs/tests/quota.test.ts \
  packages/safe-fs/tests/mount-copy-options.test.ts \
  packages/safe-fs/tests/migration/fs/mount/identity-scope.test.ts \
  packages/safe-fs/tests/migration/fs/mount/identity-authority-review/authority.test.ts \
  packages/safe-fs/tests/migration/fs/mount/comparison.test.ts \
  packages/safe-fs/tests/directory-admission.test.ts --reporter=default
```

September 6, 2026, 05:49:47 UTC: **13 files, 459 tests passed**, normal isolation.
The cohort contains 107 owned composition tests, 92 unchanged Phase A tests,
and 260 adjacent tests. Per-file adjacent counts are contracts 37, cleanup 17,
command capabilities 12, quota scan 40, quota hardlinks 24, quota 14, mount copy
16, identity scope 9, authority review 29, comparison 18 and directory admission
44. This is focused runtime evidence, not maintained build, type-consumer,
guarded lint, deployed-provider or complete command qualification.

The composition tests establish positive method-plus-capability admission,
unknown path capability preservation, selected-route support on mixed backends,
zero-call pre-abort, late-open cleanup settlement before rejection, unchanged
backend close barriers, falsey errors, real backing identity and unknown
identity preservation. They cover EOF/append/truncate, rename/unlink, alias
mounts with equal inode numbers in different scopes, copy-up with an already
opened lower reader, and an upper appearing while a lower acquisition is
pending. They prove mock S3/WebDAV refusal without finite content reads and
retain readonly mutation refusal and quota traversal/mask controls.

### Public limits and remaining integration

Admission and late-cleanup logic is shared, but successfully admitted handles
are returned unchanged. No duplicate handle identity or proxy-only lifetime
layer is introduced. Mount's acquisition errors use its virtual operand;
subsequent handle errors use the selected backend's diagnostic namespace.
Tail must label its own operand, not assume that handle error paths are mount
paths. Overlay's new path capability query specializes retained support while
retaining its composed mutation flags, and uses the potential upper route for
a missing final entry. It does not make a missing entry readable.

Routing/capability observations are not atomic with opening or protected from
external mutation. The actual returned resource, not a path stat or wrapper
scope, remains authoritative. Overlay holds its queue through acquisition and
any required late cleanup, not for the returned handle lifetime. An opaque host
that never settles can still block that acquisition/queue/drain; wrappers add
no arbitrary-host preemption, deadline, global handle limit or memory quota.
Custom hosts must honor their own retained-reader guarantees and clean up an
acquisition that rejects without returning a handle. Unknown opened identity
remains unsupported for the later `-F` consumer.

The root-selected `maxTailFollowHandles` command policy and its public wiring
remain command work, not filesystem limits implemented here. No new default
idle/absolute timeout is introduced. Root schedules combined source/test/type,
normal build, guarded lint and command integration gates after both workers
freeze. There is no known Phase B scope blocker from these focused controls;
those remaining gates are not claimed as passed for this changed composition.

### Frozen Phase B SHA-256 inputs

The plan's own final hash is reported separately to avoid self-reference.

| Path | SHA-256 |
| --- | --- |
| `packages/safe-fs/tests/retained-read-composition.test.ts` | `b9c857c7a8c5d7aac3f3f668b673177f3a74926fb8232e7369bb9d8881383fd8` |
| `packages/safe-fs/src/fs/capabilities.ts` | `c01dd9dd533465af77e4e4305849427d00f7f459ad334faebf5438ee3fc551fb` |
| `packages/safe-fs/src/fs/readonly/index.ts` | `3ac77a59c941ec0f25905209b07c6b80d3417ef2c1362a3f6d43a40e5d7def46` |
| `packages/safe-fs/src/fs/mount/index.ts` | `54bea1593f6a61646ff64fa64aac37d90abb349d5c6dbbd48b539ab6d4ce73ad` |
| `packages/safe-fs/src/fs/overlay/index.ts` | `e19144e8ab9785d18e1c8dca2f5fdd4a1f523c1c157015b10b9fefa257970abf` |
| `packages/safe-fs/src/fs/quota/index.ts` | `4162fabf9ea792bd21ad17f58ec4d6d93812c390530758a7ebe965e55b8872bc` |
| `packages/safe-bash/src/contracts/filesystem.md` | `acc051d70721018d22ee90f1a550c4278e213b52ea19f05975d63c8a72646d0b` |

The preserved Phase A files were rehashed after the last test run:

| Path | Unchanged SHA-256 |
| --- | --- |
| `packages/safe-fs/tests/retained-read.test.ts` | `d7c5e1b33d326a2e12d7d3264b2d42c90aaf9820cdfd3fe526e82d89f4cb594f` |
| `packages/safe-fs/src/contracts/filesystem.ts` | `2fb418e478a93353769e018e5dd380a88e464217ace7fcf952de973e51c391b1` |
| `packages/safe-fs/src/fs/memory/index.ts` | `2682459c562be16234ba3796a8214c0aa2de9e212d03f4fb45d738654de47207` |
| `packages/safe-fs/src/fs/real/index.ts` | `9792815bb2b85ec090b18abb576d416fea909d2f380396d986e5e7cb4231e6c5` |
| `packages/safe-bash/src/contracts/filesystem.ts` | `11fe310d085bdd3d4e980ba716855861ba77b8a40fc28b220ead9970526e39be` |
