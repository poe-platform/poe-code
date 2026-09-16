# Opt-in virtual character devices

## API and composition

`createDeviceFileSystem(): DeviceFileSystem` constructs a fixed device namespace.
It takes no configuration, reads no environment variables, opens no host files,
and starts no native processes. Device entries are `/null`, `/zero`, `/random`,
and `/urandom`; `/` is the containing directory. Mount it explicitly at `/dev`
to obtain conventional shell paths. Nothing is installed in memory filesystems,
the default command registry, or the default shell.

The single fixed behavioral profile is the qualified GNU-on-Darwin device profile.
There is no platform detection, portable-profile option, or host-device access.
Historical portable-profile observations below remain historical evidence, not
current behavior or a Linux qualification.

Source-level example from the repository root, using the TypeScript loader:

```ts
import { createDeviceFileSystem } from "./packages/safe-bash/src/fs/devices/index.js";
import { createMemoryFileSystem, createMountFileSystem } from "poe-code/safe-fs";

const fs = createMountFileSystem({
  root: createMemoryFileSystem(),
  mounts: { "/dev": createDeviceFileSystem() },
});

for await (const bytes of fs.readStream("/dev/urandom", {
  endExclusive: 1024,
  chunkSize: 256,
})) {
  await consume(bytes);
}
```

`consume` is a caller-supplied byte consumer. Pass this `fs` to `new Shell({ fs })`
and explicitly register the commands needed by that shell. This module is not a
published package subpath or default/browser-barrel export. Normal-build admission,
package exports, and public-consumer qualification are root-owned integration work.

## Reads and resource limits

| Entry | `readStream` | `readFile` |
| --- | --- | --- |
| `/null` | Immediate EOF, no emitted chunk | Fresh empty `Uint8Array` |
| `/zero` | Endless zero bytes | `EFBIG` |
| `/random` | Endless Web Crypto bytes | `EFBIG` |
| `/urandom` | Endless Web Crypto bytes | `EFBIG` |

`readFile` means reading through EOF, not sampling a device. Since three devices
have no EOF, buffered reads reject immediately, even when `maxBytes` is absent or
zero. A supplied `maxBytes` must be a nonnegative safe integer. It is a collection
limit, not a requested sample length; no partial success or arbitrary default
sample is returned. Rejection requires no random generation or payload allocation.

`readStream` is a pull-based async iterable. There is no background producer or
prefetch. Each chunk has fresh owned storage; producers never reuse or modify
previously yielded bytes. Chunks default to 65,536 bytes. Any larger valid requested
`chunkSize` is capped at 65,536 before allocation; zero, negative, fractional,
nonfinite, or unsafe chunk sizes reject with `EINVAL`.

`start` and `endExclusive` must be nonnegative safe integers, with the end at least
the start. A finite range emits at most `endExclusive - start` bytes. These are
stateless output windows, not seekable stored contents: `start` neither burns
random bytes nor permits replay. Omitted end means endless output, independent
of `stat.size`. A zero-length range emits no bytes and needs no random provider.

Random generation uses `globalThis.crypto.getRandomValues` directly on byte arrays.
The 65,536-byte ceiling also respects Web Crypto's per-call quota. Both random
names use this same secure API; they are not repeatable streams or a seeded
user-space PRNG. Missing Web Crypto rejects an actual random read with `ENOTSUP`;
provider exceptions become `EIO` retaining their cause. There is no `Math.random`,
host-filesystem, or native-process fallback. The embedding host must supply genuine
Web Crypto; arbitrary host JavaScript is not sandboxed.

Every resumed read checks cancellation. Between chunks, the implementation uses
the existing portable `yieldTurn` helper so an endless consumer does not starve
timer-driven cancellation. Breaking iteration closes the generator. Cancelling a
signal preserves its exact reason, including falsey reasons. Synchronous Web Crypto
work is not interruptible mid-call; each such call is bounded to one chunk.

## Canonical retained descriptors

`open(path, options)` uses the public safe-fs `openFileDescriptor` builder. Each
successful open retains a distinct cursor starting at zero and the selected
virtual node identity. The builder validates options, enforces read/write access,
serializes admitted operations, preserves signal reasons, blocks new work after
close, drains admitted work, and releases the retained backend on idempotent close.
Closing one handle does not close another. No operation reopens a path.

All four nodes advertise `position`, `readObservation`, `openTruncate`,
`positionedRead`, `positionedWrite`, `positionedAppendWrite`, and
`delegateZeroLengthWrite`. Effective read/write capabilities are masked by the
builder for the acquired access mode. `getPosition()` reports the retained cursor;
`probeRead()` returns `ready` without consuming bytes, including for write-only
handles. Read attempts on write-only handles and write attempts on read-only
handles still fail with `EBADF`, including zero-length calls.

Null reads return EOF without touching the caller buffer or advancing the cursor.
Other successful descriptor reads fill the entire requested view. Zero and random
reads process it in chunks of at most 65,536 bytes, yielding between chunks for
cancellation; this is an implementation work bound, not a native syscall ceiling.
Random reads reuse one bounded, owned ArrayBuffer-backed staging array before
publishing each chunk into the caller's view, including shared storage. A failing
or canceled entropy chunk is not published. Earlier successfully published chunks
remain visible; sequential cursors advance by precisely that committed prefix
even if a later chunk fails. Positioned reads never change the sequential cursor.
Errors/cancellation are not converted to a successful partial count. Callers must
keep their destination view valid until settlement and treat rejected reads as
potentially having partial effects. No byte equality or replay guarantee exists
for random reads.

Sequential successful reads/writes advance the cursor by the returned count.
Positioned operations do not change it. The Darwin profile accepts positioned
character I/O and positioned writes on append handles; append does not reset a
sequential cursor to stat size zero. Offsets do not select stored contents or burn
random bytes. A sequential cursor beyond JavaScript's safe-integer range refuses
with `EFBIG` rather than publishing an imprecise position. This numerical limit is
not a native off_t-range parity claim. Large descriptor reads yield between bounded
chunks; unbounded loops of small reads remain responsible for yielding and
cancellation/budgets.

Open truncation and writable `truncate(length)` are no-ops preserving identity,
cursor, size, and timestamps. The descriptor advertises `truncate: true`, while
the separate filesystem-level pathname truncate capability remains false.
`sync(false)`, `sync(true)`, and synchronization open options succeed as volatile
no-ops, never a claim of durable storage or persistence. Exclusive creation fails
with `EEXIST` for existing entries; missing nodes remain `ENOENT` for every creation
policy. Opening the directory as a device fails with `EISDIR`.

## Writes and namespace

`writeFile`, `appendFile`, and `writeStream` accept only `Uint8Array` payloads.
Null, zero, and random accept and discard writes. Urandom rejects actual writes
with `EPERM`, including explicit empty `writeFile`, `appendFile`, and descriptor
`write` calls. Access and writable open still succeed: refusal occurs on writing,
not acquisition. Bulk stream empty chunks are not explicit write syscalls: an
empty source or only empty chunks succeeds without writes. A nonempty urandom
stream chunk fails and closes the producer without pulling subsequent chunks.
Writes never store contents, change read results into stored data, or truncate a
device. Flags `w` and `a` are supported; `wx` and `ax` reject existing
entries with `EEXIST`. Unknown flags and invalid modes reject with `EINVAL`.
Creation modes do not change existing device permissions.

Streaming writers consume sequentially until EOF, propagate producer failures,
and yield between chunks, including empty chunks. They do not retain or accumulate
payload bytes. They validate the target before acquiring the source iterator.
The shared `readBytes` cancellation protocol requests iterator cleanup and observes
late failures; cancellation does not wait forever for an uncooperative pending
`next()` or force arbitrary host work to stop. Cooperative generators finalize.

Namespace entries cannot be created, removed, renamed, linked, or changed
by chmod or utimes. Canonical descriptor truncation is a no-op, not a namespace
mutation; pathname truncation remains unsupported. Unsupported capabilities are false;
required mutation methods reject with `ENOTSUP` after path admission. Specific
nonmutating results remain meaningful: recursive mkdir of `/` succeeds, ordinary
mkdir of an existing entry gives `EEXIST`, force-removing a missing path succeeds,
rmdir of a device gives `ENOTDIR`, and rmdir of `/` gives `ENOTEMPTY`.
This fixed namespace is not a writable devfs or a general-purpose copy engine.

`copyFile` supports a genuine streaming copy between distinct existing device
nodes. It validates both endpoints, directories, exclusivity, and same-node
identity before reading the source. Null reaches EOF immediately; zero and the
random devices stream until cancellation or failure. Destination writes discard
the bytes without accumulation, except nonempty urandom writes fail with `EPERM`.
Missing destinations fail with `ENOENT`, existing
destinations with `exclusive: true` fail with `EEXIST`, and same-node aliases fail
with `EINVAL`. `copy: true` advertises this operation, not creation of device nodes;
`exclusiveCopy` remains false. The mounted cross-backend streaming route can also
copy an ordinary memory file into a device without changing that source.

Paths are resolved component by component, not lexically collapsed across leaves.
Relative paths start at the device root. Repeated separators are accepted; dot and
dot-dot at the root stay at the root. A missing component gives `ENOENT` even if a
later dot-dot would hide it. Traversal through a device, including trailing slash,
dot, or dot-dot, gives `ENOTDIR`. Empty paths give `ENOENT`; NUL and nonstring paths
give `EINVAL`. Realpath returns absolute device-local names. The mount adapter
handles global names, symlinks outside the device namespace, and global error paths.
No unknown device is silently created.

## Metadata and capabilities

Both `stat` and `lstat` return `type: "character"`, never `"file"`, and mode
`0o020666` for devices. The directory uses type `"directory"` and mode `0o040555`.
`size: 0` is conventional special-node metadata, not a stored length or EOF
prediction. Timestamps describe creation of this virtual namespace and stay fixed;
they do not report host-device timestamps or payload access history. Each factory
call owns a distinct fixed virtual namespace and a private symbol `identityScope`.
Its five nodes have stable distinct virtual inode numbers with virtual `dev: 0`.
Aliases mounted from the same instance retain identity; separate factory instances
contain different nodes. These are truthful identities of the virtual namespace,
not native inode or backing-device claims. Native major/minor numbers, ownership,
and physical allocation remain omitted. Metadata is returned as fresh snapshots.

Reading, stat, listing, realpath, access, writes, append, streaming read/write/append,
streaming copies, retained descriptors, and an explicit containing directory are
supported. Canonical positioned I/O does not authorize the legacy filesystem-level
read/modify/replace random-access contract: `randomAccessWrite` remains false.
Mutation of permissions/timestamps, namespace changes, and exclusive creation are not supported.
`readOnly` is false because payload writes succeed. `permissions` is false because
the mode is a fixed virtual policy, not mutable host permission enforcement.
Access permits device reads/writes but rejects execution; the directory permits
reading/search but rejects writing. Readdir supports the shared `maxEntries` limit
and rejects overflow with `EFBIG`, never a silently truncated listing.

## Native differences and integration boundaries

This implements one fixed Darwin I/O profile, not a complete kernel device driver.
Web Crypto has no reseeding API: accepted virtual random-device writes are
discarded, **not entropy contributions**. Boot-time entropy blocking, entropy
accounting, ioctl, lseek mutation, mmap, and native minor/major numbers are not
emulated. Stream fragments and bounded internal crypto calls are not native
syscall-size limits. Successful large descriptor reads preserve the full requested
count observed in the qualified Darwin matrix.

The preserved Darwin receipts establish urandom `EPERM` even for an explicit
zero-byte write, despite successful access/open. The former portable acceptance
of those writes is repaired; its original assertions and captures are retained.
Native random bytes cannot be compared for equality. The secure-generation
guarantee rests on the embedding host's Web Crypto, not output-distribution tests.

Shared safe-fs integration requires `"character"` in `FileType`. Bridges must
preserve character type/mode and implement `isCharacterDevice`; Bash renderers and
type predicates must recognize the new type. The mount implementation forwards
device identities, stats, streams, and destination-specific capabilities.

Single and multiple shell input/output redirects work with explicit mounts.
Canonical retained-output routing now uses `open` where supported. The explicit
`independentWriteStreams: true` capability permits separate concurrent sequential
output streams to the same discard target. It does not assert offsets, random
access, stored content, cross-stream ordering, or append atomicity. Each descriptor
owns its stream and cleanup; closing or canceling one does not close its peers.
Stream-only consumers consult destination-specific capabilities; the assertion
does not disable canonical retained-descriptor support on other providers. This is a provider assertion,
not a capability inferred from a `/dev` pathname or character mode. Shell input
and output budgets still apply even to devices. A large producer chunk may exceed
a very small shell input budget before `head` consumes its requested prefix; devices
do not bypass those guards. Unbounded `cat`/`tail` needs consumer cancellation or
shell limits. Buffered/script consumers must not infer EOF from special-node size.

## References and scoped evidence

Current fixed-profile receipts are retained, not rerun by canonical unit tests:
`/tmp/device-canonical-profile.5twqzP` (104 observations),
`/tmp/device-writable-profile.tTzWN8` (149),
`/tmp/device-random-write-profile.aYgenT` (55), and
`/tmp/device-sync-zero-profile.LyFRyx` (135). These distinguish running Darwin
behavior from Apple source evidence. No new native device I/O is authorized by
the commands below. Rooted-real adapter containment and special-file refusal are
unchanged; virtual character-device support does not widen host `/dev` access.

The additional read-only native receipt
`/private/tmp/device-large-read-boundary-pRZM7K/handoff.json` and its `result.json`
cover 16 syscalls: reads of 65,536, 65,537, and 262,144 bytes and positioned reads
of 65,537 bytes at offset 3 for all four nodes. Non-null nodes returned full counts;
null returned zero. Positioned reads retained cursor 7. The retained probe binary
SHA256 is `474170b0f7cfc81c7d55e8e0f403c65ff4ac6c85799a570311ade0250af6bf91`.
No native rerun was performed for the implementation. The earlier artificial
65,536-byte descriptor return cap and its author-test expectation are superseded;
original source/test bytes and the 12-failure test run remain in
`/tmp/device-full-read-author.lYmyBW`. Stream chunk behavior is unchanged.

Safe focused tests (no host-device I/O):

```sh
node --import tsx --test packages/safe-bash/tests/fs/devices/canonical-descriptor.test.ts packages/safe-bash/tests/fs/devices/canonical-author.test.ts
node --import tsx --test packages/safe-bash/tests/fs/devices/canonical-independent.test.ts packages/safe-bash/tests/fs/devices/native.test.ts
node --import tsx --test --test-name-pattern='^descriptor order native/null: (readiness|positive)' packages/safe-bash/tests/shell/extensions/read/descriptor-order.test.ts
```

The eleven read cases use authenticated frozen Bash 5.3 records, not fresh native
execution. Canonical49 retains every assertion with only the approved fake-backend
`delegateZeroLengthWrite: true` opt-in. Its original bytes and red runs are in
`/tmp/device-canonical-author.pllnYw`.

`native.test.ts` now authenticates the bounded `native-reference.json` fixture
and exercises virtual APIs only. It does not open host devices or spawn native
processes. Captures A-E preserve the raw receipts and C sources described above.
Capture F adds four recorded RW/append/nonblocking opens, one 256-byte read per
device, four closes, and the five original malformed-path lstat observations.
That separately authorized probe requested 1024 bytes total and performed no
device writes. The virtual API comparisons do not invent a nonblocking option,
equate host/virtual inode numbers, or turn separate access calls into an identical
combined native access call.

Exact one-byte native writes remain distinct from five-byte virtual regressions.
Large reads compare recorded counts and cursor deltas, not an identical native
seek setup. Historical random-sample comparisons are diagnostic sampling, not
proof of secure generation or freshness. The original test and TAPs remain inert
historical data; their preservation does not establish a missing contemporaneous
execution binding. Fixture authentication, normal and guarded replay, and
tampered/empty/oversized/symlink refusal controls are independently reviewed.

Legacy virtual tests now expect urandom write refusal. Stream-only conflict and
lifecycle fixtures explicitly omit canonical open and advertise `open: false`;
positive iterator-admission checks prevent cleanup assertions from passing
without exercising their streams. Original programs and other assertions remain
preserved. The native-free legacy cohort passes 34 tests.

**Do not use a device-directory wildcard as a no-native-I/O test command.**
Eleven other legacy cases and the separate `shell.test.ts` still invoke ambient
native tools; those were not included in the safe retained qualification. They
are not counted as passes or as a newly pinned native profile. Requalifying them
requires pinned oracle admission and explicit operation authorization. Exact
printf diagnostics for urandom write refusal also remain a separate command-level
qualification gap, not a property established by C syscall errno captures.

### Historical portable candidate (not current qualification)

Primary references inspected September 4, 2026:

- Linux man-pages `null(4)`: <https://man7.org/linux/man-pages/man4/null.4.html>.
- Linux man-pages `random(4)`: <https://man7.org/linux/man-pages/man4/random.4.html>.
- Linux man-pages `inode(7)`: <https://man7.org/linux/man-pages/man7/inode.7.html>.
- W3C Web Cryptography, `getRandomValues`: <https://www.w3.org/TR/webcrypto/#Crypto-method-getRandomValues>.
- Apple XNU `random_write`: <https://github.com/apple-oss-distributions/xnu/blob/main/bsd/dev/random/randomdev.c>.

The historical directory-wide test command is retired here because it performs
native random-device writes and invokes unpinned native Bash. Its old outcomes
below describe earlier candidates only; they are not safe current run instructions.

TDD evidence: the first suite failed with `ERR_MODULE_NOT_FOUND` before production
code existed. A subsequent operation-label regression failed with `stat !== lstat`
and passed after fixing error attribution. Native comparison first exposed the
Darwin urandom `EPERM`; the comparator now separately asserts that intentional
platform difference rather than suppressing it.

Native checks use existing device handles without creating files. The observed
profile was Darwin 25.4.0, Node v22.23.2, Bash 3.2.57(1)-release. Separate native Bash cases compare exact
stdout bytes for null EOF, finite zero prefixes, input/output/append redirects,
and an early-closing pipeline. Native-device and shell comparisons are not evidence
of a Linux-host run, deployment qualification, or universal Bash parity.

An in-memory esbuild browser bundle was evaluated without Node `process`, `Buffer`,
or filesystem globals. All four devices produced the expected EOF/byte counts and
character metadata; the bundle reported no external/native imports. This is a
scoped portability check, not package-browser-export or release qualification.
Canonical test inventory, build inclusion, export qualification, and commits stay
with root. No README or shared/default registration is changed by this module.

September 4, 2026 working-tree run: 31 tests passed, zero failed/skipped, including
18 device-contract tests, five native-device tests, and eight shell tests (seven
native byte comparisons and one virtual random-byte smoke check). The Darwin
urandom write mismatch is explicitly characterized, not a parity pass. These are
uncommitted source observations; dependencies were working-tree/built workspace
inputs, not an authenticated release archive.

SHA-256 bindings for that initial owned candidate and native tools (not future source seals):

| Input | SHA-256 |
| --- | --- |
| `src/fs/devices/index.ts` | `f25812d69d30ee4430a7ec11003ab61b9b33ea9cd4eb84a7bb0fec25c926a78d` |
| `tests/fs/devices/devices.test.ts` | `7282b83315c98887e7ea3ef880cab0722fff61260c30372cb922ba94745dc1d2` |
| `tests/fs/devices/native.test.ts` | `d1c0ef3e12f925f7da65312fd4ef4566dee914dbba63e0764f70edd742bb9593` |
| `tests/fs/devices/shell.test.ts` | `4befd66cba44217c45d8f325cf81c83da9ee950d0f28753b5b72537596eb5d23` |
| `/bin/bash` | `35536aea9733aa345b61134a98d00232380898e55b2ea2a07c497011f7dfc7a3` |
| `/bin/cat` | `580599dd318fa34bb0f91c29106894852c49c3a3df724b637113df95c6758fe6` |
| `/usr/bin/head` | `b4d147753ce0a14a40c5f9aaca06c04eb7697f2d56c207c0a5e7ce16f31ebfc1` |

### Historical independent review, September 4, 2026

`tests/fs/devices/review.test.ts` independently reproduced the simultaneous
`printf x >/dev/null 2>/dev/null` failure before adding the capability and a
one-condition change in the shell output-redirection branch. It also reproduced
a random-provider exception overriding a simultaneous cancellation reason; the
device catch now checks cancellation before wrapping the provider exception.

Additional failing tests reproduced mounted `cp /input /dev/null` refusal,
missing authoritative node identities, and unsupported direct streaming copies.
Stable private virtual identities and real source-to-discard streaming fixed
those cases without changing the shared mount or cp identity guard. Existing
same-node aliases remain rejected. The original author's test requiring
`copyFile('/null', '/zero')` to return `ENOTSUP` describes the superseded initial
profile. Root subsequently assigned that specific assertion to the reviewer.
Its replacement compares a bounded native Bash copy and zero-byte sample, checks
successful native status, unchanged virtual destination metadata and character
type, null EOF, fixed namespace membership, and rejection of missing/exclusive
destinations. All unrelated mutation-rejection assertions remain unchanged.

The review covers native Bash null descriptor bytes/status, descriptor duplication
and ordering, nested opens, append combinations, stream cleanup on later-open
failure, 1 MiB fragmented dual-stream output without accumulation, normal-backend
negative controls, namespace admission before source acquisition, falsey
cancellation, independent writer lifetimes, mounted copy, and same-instance versus
separate-instance identity. Native comparisons use bounded Bash execution and
existing devices, not native temporary files. The native null-to-zero copy is
finite; endless virtual copies are canceled in memory. No native random stream
is collected without a bound.

Darwin urandom write refusal versus virtual discard remains an unresolved
exactness difference, not a pass or a repaired kernel-compatible profile.
The original author's counts and hashes above remain evidence of its earlier
candidate, not certification of this reviewed candidate. Shared contract typing
and capability documentation belong to the safe-fs owner: the requested explicit
declaration is `readonly independentWriteStreams?: boolean`, with the semantics
specified above. The current extensible capability dictionary already admits the
runtime assertion, but that does not substitute for the named contract/docs update.
Root subsequently added the explicit capability declaration and its concurrent
sequential-writer contract to safe-fs. Independent root tests also exposed and
corrected character-device-number loss in readonly, mount and overlay snapshots;
the four focused metadata/bridge files now pass 67 tests. The device module remains
outside the default build and exports. Its dedicated test TypeScript project
passes, and actual Shell output was visually inspected in the ad-hoc image
`/tmp/safe-bash-scripting-oracles-20260904/devices-visual-review.png`.

The final focused review run passed 27 review tests plus all 129 maintained
`tests/commands/filesystem-output.test.ts` regressions: 156 passes, zero failures
or skips. That includes cleanup on caller cancellation and output-budget failure
with two active discard streams. Strict NodeNext no-emit compiler checking of the
device source, review test, and shell runtime with their import closure found zero
diagnostics. This is not a full package build/typecheck or release gate.
After reconciling the specifically assigned copy assertion, the complete device
and device-metadata selection passed all 79 tests with zero failures/skips in
approximately 1.2 seconds. A fresh strict no-emit check including the updated
author test also reported zero diagnostics. The native urandom write difference
remains explicitly characterized rather than counted as exact Darwin parity.

On root resumption, the combined device, device-metadata, and maintained
filesystem-output selection passed 208 tests with zero failures or skips in
approximately 1.7 seconds. A fresh strict no-emit check of the device source,
author test, independent review test, and shell runtime import closure reported
zero diagnostics. The named shared capability declaration was still absent at
this check; its coordination remains with the safe-fs owner. No further product
change was needed for this rerun.
