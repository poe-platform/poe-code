# Issue 616: guarded Memory descriptor write streams

## Authorization and ownership

September 6, 2026: root authorized the SafeFS slice after reporting #624
delivered at `72d29b57fec2b54670ab4ed9322b3faf40350fcd`, closed at 09:44:19 UTC,
and a clean pull/rebase. Root rechecked issue author `kamilio` and reported the
author's bounded follow-up retracting the unverified 85x/OOM claims and noting
that remote adapters are not on the shell's EOF-probe path. This worker used no
Git commands to independently qualify that delivery or reread the remote issue.

Root accepts the optional `descriptorWriteStream` capability and correct
positional Memory `w`/`wx` semantics under interference, without a new stream
mode or writer API. SafeFS source/tests/contract documentation and this plan are
worker-owned. Jason owns Bash output selection/tests/documentation. Root owns
the Bash registry, Git, builds, lint, frozen qualification and delivery.

## Prior evidence, not repeated

The 48-control evidence remains unchanged under:

`/home/kjopek/kamilio-validation-569-575.RoFXyZ/616-followup.xBif3h`

`comparison-summary.json` SHA-256:
`cfc458e311b41bc6935504a0227476e2a2128520b8ceec70867354ee7363e3a0`.
`probe.log` SHA-256:
`e5f922e324b15805477091440ee97a8906ea8f2bf0ab9ef99dfa08a18d1064a5`.

Those controls separate fixed #613 writer-reaction retention from remaining
chunk copies, shell byte-image duplication and append/metadata dispatch. Their
tiny mock-S3 fallback witnesses do not establish a per-record shell EOF probe
on remote adapters. No historical evidence, fixture or assertion was weakened.
No heap/RSS/OOM experiment, live benchmark or rerun of those 48 protocols was
performed for this implementation.

## Implementation

- Add `FileSystemCapabilities.descriptorWriteStream?: boolean`; unknown is not
  positive support. No public writer handle or extra stream option is added.
- Stock Memory advertises through a dynamic guarded capability getter. No
  `Memory.capabilitiesFor` method is added: introducing a bound method could
  bypass existing decorators' overridden capability snapshots. The getter
  checks exact stock prototype, owned store/capability object and unchanged
  relevant data-method descriptors, without invoking replaced policy accessors.
- Reuse the existing pinned `openWrite` node. `w`/`wx` use a per-stream cursor;
  `a`/`ax` use the node's current EOF. A common private positional storage helper
  retains geometric growth, current suffix bytes and zero-filled gaps. Stream
  chunks copy directly into storage; ordinary `writeFile`/`appendFile` keep their
  existing input-copy boundary. Empty chunks do not grow the file or cursor.
- Readonly, Quota and Overlay explicitly mask the flag false. Mount forwards
  genuine selected support, not a positive missing-method, readonly or disabled
  stream declaration. Global Mount flags remain construction-time summaries;
  fresh path capabilities observe later changes to stock Memory write methods.
- Real does not opt in. S3/WebDAV, remote fallback append costs, retained-reader
  semantics, canonicalization masks and quota traversal are not redesigned.

Jason confirmed the Bash selection condition will prefer a positive descriptor
stream even when an incremental fallback callback exists. It retains existing
readOnly/access/streaming admission and pre-consumption `ENOTSUP` fallback; input
already consumed must not be replayed. That worker's qualification is separate
from the SafeFS counters below. No Bash production/test file is edited here.

## Fresh TDD evidence

Exact first command:

```sh
PATH=/var/tmp/poe-code-kamilio-toolchain.GzqQj3/bin:$PATH npm run test:unit -- packages/safe-fs/tests/descriptor-write-stream.test.ts
```

09:50:02 UTC: **33 failed, 12 passed, 45 total**, before production changes.
Test-only SHA-256:
`6ffab23014282d0156c442b78200da1d6cf7b408f59afef8f28b2675b3890313`.
Failures establish absent/unguarded capability support, incorrect append-like
non-append streams, redundant per-chunk Memory copies, and missing composition
masks/admission. Existing append, source ownership, pinning and cancellation
controls were preserved rather than counted as newly fixed failures.

09:51:01 UTC: **45/45 GREEN**. Additional substituted-capability and contradictory
Mount declaration controls then produced a second RED at 09:51:55 UTC:
**2 failed, 47 passed, 49 total**. Fixes bind the guarded getter to its original
capability object and prevent a global Mount positive claim when streaming
writes are explicitly false. No historical test expectation was relaxed.

Per 128-byte direct-stream fixture, chunk sizes 1, 4 and 32 previously invoked
the internal copying `bytes` helper 128, 32 and 4 times; each now invokes it zero
times. The tests also retain one `openWrite`, zero public `stat`/`appendFile`
calls, and allocations of 64 then 128 bytes. The latter dispatch counts were
already properties of direct Memory streams, not newly reduced SafeFS calls.
Bash routing must separately demonstrate elimination of the shell's old calls
and mirror. Input bytes still copy into storage and prefixes copy during growth;
these counters do not measure peak heap or establish an allocation upper bound.

Copy/allocation counters explicitly instrument private Memory methods and run
direct streams; such instrumentation intentionally withdraws the stock
capability. Separate intact-stock controls establish positive enrollment.
Buffers are at most 128 data bytes in these counter fixtures, with no timing or
large-input performance predicate. Other cases use tiny files and deterministic
generator boundaries, not sleeps or host fixtures.

## Focused qualification and limits

Root authorized the complete maintained SafeFS unit selection:

```sh
PATH=/var/tmp/poe-code-kamilio-toolchain.GzqQj3/bin:$PATH npm run test:unit -- packages/safe-fs --reporter=default
```

The first sandbox attempt at 09:52:23 UTC had 1450 passes and three failures
among 1453 tests, plus one unhandled listen error. Existing loopback tests hit
`listen EPERM`; the S3 loopback test timed out as a consequence. This is retained
as failed/unavailable evidence, not a passing gate. The approved escalated retry
at 09:52:51 UTC passed **1453 tests in 55 files**, normal isolation, using the
existing loopback mocks and no live services. No timeout was increased and no
test or transport was bypassed.

Root-requested readonly contradiction, missing-method global admission, and
post-construction Memory-policy controls then passed without further production
changes. The final owned file contains 51 controls. A four-file run at
09:53:25 UTC passed **207 tests**: the new 51, retained-read composition 107,
contracts 37, command capabilities 12. It verifies current selected-path
withdrawal even when the global Mount snapshot was previously positive.

Final SafeFS run at 09:55:40 UTC, using the same complete unit command and
approved loopback access: **1455 tests in 55 files passed**, normal isolation,
no failures or unhandled errors. This includes the final 51 owned controls and
unchanged retained-reader, quota, directory, wrapper and capability suites.

The exact readonly capability fixture root identified is actually
`packages/safe-bash/tests/fs/readonly/readonly.test.ts:332`, not a SafeFS file.
Its literal expected object needs `descriptorWriteStream: false`. Root/Jason
were notified; it is outside this worker's write scope and was not normalized,
edited or claimed as qualified by the SafeFS Vitest route.

Compatibility is explicit: direct Memory `w`/`wx` streams now overwrite at their
own cursor rather than following EOF after external interference. Append still
uses current EOF. No batching delays acknowledged visibility. Resource pinning,
owned bytes, published failure prefixes and falsey cancellation remain covered.
The capability check is not a hostile-host sandbox or a lease across future
host mutation. Copied positive snapshots/custom declarations remain their
author's responsibility. No Real opt-in, remote fallback repair, global memory
quota, arbitrary-host preemption or 85x/OOM claim is made.

No Git/build/lint/shared-dist work was performed. SafeFS implementation and
focused evidence are partial #616 work, not combined qualification, delivery or
issue closure. Root owns the final built-consumer/type/lint and Bash gates.

## Coordinated Bash evidence

Jason reports the separately owned Bash patch frozen with 37 new descriptor
controls and 64 unchanged filesystem-output/#613 controls: **101/101 GREEN**,
normal isolation. His fresh Bash RED was 23 failed and five passed among 28;
the first composed GREEN was 28/28. These are the Bash worker's runs, not reruns
by this SafeFS worker. The source-Memory import intentionally tests current
SafeFS without rebuilding shared bundles; it does not qualify public packages.

The Bash worker's checked-in contract records the exact bounded observations:

| Payload | Forced legacy stat/appendFile/writeFile/writeStream calls | Descriptor calls | Instrumented copied bytes, legacy to descriptor |
| --- | --- | --- | --- |
| 32 one-byte chunks | 32 / 32 / 1 / 0 | 0 / 0 / 0 / 1 | 176 to 64 |
| Four eight-byte chunks | 4 / 4 / 1 / 0 | 0 / 0 / 0 / 1 | 180 to 64 |

Copy figures count Uint8Array constructor/set/slice traffic within those tiny
Shell executions, not heap, RSS, backing-store retention or remote costs.
Faithful bound-method proxies count public calls without replacing the stock
Memory methods that its capability guard inspects. Jason also reports external
append/truncate/rename, duplicate and nested offset, falsey failure/cancellation,
pre-read fallback, no replay, consumer closure and held-cleanup controls. The
generic `randomAccessWrite: false` stream control has zero per-chunk stat calls;
it is not a live remote-service measurement.

## Frozen file identities

The seven SafeFS implementation/test/documentation hashes below were captured
after the final full SafeFS unit run. The eighth owned file is this plan; its
final hash is reported separately to avoid self-reference. Root may update
integration/delivery records after handoff without claiming those later bytes
were the worker's frozen plan.

| Owned path | SHA-256 |
| --- | --- |
| `packages/safe-fs/src/contracts/filesystem.ts` | `c9cfd2ccd1223a897b382543eed497d8e6c4b9ee64645fa99308b3ec445204e4` |
| `packages/safe-fs/src/contracts/filesystem.md` | `28bc5a810068b2143e1cacefd5a2abc3d9d446aefc303299a9e11fbce508fa3c` |
| `packages/safe-fs/src/fs/memory/index.ts` | `a8f971c6522a32ddaa6feb46d903dba7d9e0fbed5ce6e3b3f79fb3d5e5787c23` |
| `packages/safe-fs/src/fs/capabilities.ts` | `9726b931912081e89cedb686f2144e1b145818a549823ccdbc5d91fc3c3a032a` |
| `packages/safe-fs/src/fs/mount/index.ts` | `6c4a74b72e22e7acce88adce23302126654eef66414e9f44e1f5267c0a056d57` |
| `packages/safe-fs/src/fs/overlay/index.ts` | `d62e065c6454641f246e35571274e4a489dea52ca9544a7b296f146f041ddf5f` |
| `packages/safe-fs/tests/descriptor-write-stream.test.ts` | `78ed305201cafff5ff1ff2242b6c07cac096c6789efa04013223140a230f7f98` |

Jason's separately owned, read-only verified files at handoff:

| Bash path | SHA-256 |
| --- | --- |
| `packages/safe-bash/src/contracts/filesystem-output.ts` | `d48e59f0589ef8e13a9bd90b0d28d102f3aa696e9ce9d06f6b69f01dae459c77` |
| `packages/safe-bash/src/contracts/filesystem-output.md` | `20b7de1df557c869f9479063be9d32e703f1e3fbc88d8fb2866d09585823fc56` |
| `packages/safe-bash/tests/contracts/filesystem-output-descriptor-stream.test.ts` | `e98730c52572773c0f461a976957cac63a46d66dea530c88a6f7737c503cd496` |

Unchanged Real source SHA-256:
`9792815bb2b85ec090b18abb576d416fea909d2f380396d986e5e7cb4231e6c5`.
No Real opt-in or source modification is included.

## Root integration checkpoint

Root registered the new Bash test by literal path and restored the twelve-file
candidate byte-identically after pulling with rebase to
`228ac54e6` on September 6, 2026. The normal integrated build passed.

The Bash readonly wrapper imports built SafeFS. Before that rebuild its 77 tests
passed against the previous build; that run is not RED evidence. After rebuilding,
76 passed and one exact capability-object assertion failed solely because the
new `descriptorWriteStream: false` field was absent from its expectation. Root
added that literal field, preserving the complete equality, immutability and
unknown-extension checks. Both runs remain recorded separately. Full integrated
qualification and delivery are not established by this checkpoint.

The integrated focused run passed all 307 controls. SafeFS typechecking passed;
Bash typechecking caught a new mock stat missing required mode and timestamp
fields. Root completed that fixture without changing its behavior or assertions.
The original failed typecheck remains recorded and requires a fresh passing run.

The first visual probe incorrectly used the unsupported `exec` command. The
screenshot helper returned success despite the captured child assertion failure;
that image is not passing evidence. Comparing published 0.1.164 with the current
build reproduced the unsupported command in both. Corrected grouped-descriptor
probes independently asserted child exit status and exact output before capture:
16 bytes for streamed seq output, XB for independent overwrite offsets, and AB
for continued writes to a renamed open resource. All passed and the corrected
PNG was visually inspected. These are built-package Memory checks, not remote
service, heap, RSS or OOM qualification.

The corrected Bash fixture passed all 26 maintained consumer typecheck groups.
Root lint then found the new Memory capability closure's `this` alias. Root
made the closure parameter explicit instead, preserving the dynamic getter and
frozen capability object. The worker hash above is its handoff identity, not
the identity of this later lint correction; final gates cover the correction.

The rebased candidate passed the normal build, SafeFS types, all maintained Bash
consumer type groups, root lint and package lint. Its first full unit attempt
passed 34,175 shared tests (42 skipped), then its Bash child finished with
21,350 passed, five failed and 63 skipped. The parent tool ended with signal 143
while that child continued; the cause is unestablished, and the parent's EXIT
trap file is not evidence of a completed full gate.

All five failures were independently reproduced (two passed/five failed in the
focused RED). GNU tee 8.30 confirmed overwrite duplicate targets produce A,
whereas append duplicate targets produce QAA. The tee test now asserts those
exact bytes and still checks two opens/consumers and both closures. Existing
shell-mirror growth and direct-mutation assertions remain intact in an explicit
descriptorWriteStream:false fallback profile. Three additional stock-Memory
controls assert the positional overwrite results, rather than pretending the
old fallback mutation boundary still applies. The corrected focused run passed
10/10. No production change or assertion waiver was needed for these failures;
a fresh integrated gate is still required before delivery.
