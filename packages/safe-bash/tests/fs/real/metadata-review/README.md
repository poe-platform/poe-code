# Six-case RealFS chmod classification — parent handoff

Read-only production classification captured on 2026-08-27 UTC. Only this new
tree is owned. No production, command, contract, existing stress test, original
expectation, root policy, or export is changed. No source fix is authorized here.

## Finding and exact counts

**All six original distinct cases reproduce; they share one concrete cause.**
The six prepared RealFS counterparts are observations of those same cases,
not six additional original bugs. Original acceptance stays **135/141**, and
the separate combined historical report stays **165/177**. Neither aggregate
is rerun or turned green by this classification. All 30 timestamp differences
remain fixed by `2cacd04` + `0c4709f`; no timestamp work was performed.

Every original invocation is `chmod -- u-s,g=s,o-t NAME`, umask `027`.
The actual command and instrumented GNU executable both calculate/request
`02707` (decimal 1479). The measured initial modes, not attempted setup modes,
are used unchanged:

| Original | Object | Initial | GNU9.7 status / final | Node, direct RealFS, actual command status / final |
| --- | --- | --- | --- | --- |
| C1 | file | 04777 | 1 / 04777 | 0 / 00707 |
| C2 | file | 00777 | 1 / 00777 | 0 / 00707 |
| C3 | file | 01777 | 1 / 01777 | 0 / 00707 |
| C4 | directory | 04777 | 1 / 04777 | 0 / 00707 |
| C5 | directory | 00777 | 1 / 00777 | 0 / 00707 |
| C6 | directory | 01777 | 1 / 01777 | 0 / 00707 |

MemoryFS reproduces the original status0 / 02707 in all six; its virtual
permission effects do not provide the host's credential/group authorization.
GNU stdout is empty and stderr is exactly
`chmod: changing permissions of 'NAME': Operation not permitted\n`.
Node/RealFS/actual-command stdout and stderr are empty.

## Causal proof, not a generic host-limitation guess

1. The frozen and current profiles agree: uid/euid501, gid/egid20, identical
   supplementary groups excluding0, owned fixtures uid501/gid0, and umask027.
   Every before/after capture retains numeric owner/group, mode, device, inode,
   size, link count, native timestamp fields, and raw `ls -lndeO@` ACL/flags/xattr
   output. There are no displayed ACL entries or flags; the provenance xattr is
   displayed. No ACL or xattr was added, removed, or calibrated away.
2. Plain pinned GNU9.7 execution returns1/EPERM without changing the mode.
   A separate development-only interposed execution records the real GNU call:
   `fchmodat(-2 /* AT_FDCWD */, "NAME", 02707, 0) -> -1, errno=1`.
   Plain oracle results are retained independently of that instrumentation.
3. Direct native `fchmodat` and the exported raw `__chmod` syscall stub both
   return EPERM and retain the initial mode. Direct public libc `chmod` instead
   returns0 and realizes0707. This is **not** two kernel chmod implementations
   making contradictory authorization decisions.
4. Apple's version-matched XNU UNIX03 `chmod` compatibility wrapper first calls
   `__chmod(path, 02707)`. After EPERM, it retries without SGID, effectively
   `__chmod(path, 00707)`, and returns that success. Raw-kernel controls and
   source establish the distinction; no in-kernel event trace is claimed.
   A stale errno1 after libc's successful return is not a failed operation.
5. Matching Node22.22.2/libuv1.51.0 source delegates to that public libc `chmod`.
   Temporary, restored builtin instrumentation measures the actual Node API
   calls from direct Node, direct RealFS, and the actual command: each receives
   exactly1479, with the correct owned canonical host path for RealFS.
6. Removing SGID while retaining gid0 makes all six causal-control layers
   succeed at0707. Changing only the owned fixture group to the caller's gid20
   makes the same symbolic mode succeed at02707 across all six layers. There
   are two file/directory controls of each kind: **4 scenarios / 24 layer
   observations**, not new original cases. Group changes are confined to these
   separately labeled controls after all six original quartets finish.

The current kernel is Darwin25.4.0, `xnu-12377.101.15~1`, macOS26.4.1 build25E253,
arm64. The matching XNU tag resolves to commit
`5c306bec31e314fa4d8bbdafb2f6f5a6b7e7b291`. `source-proof.json` records primary
URLs, exact file hashes, tag metadata, and source line locations:

- `libsyscall/wrappers/unix03/chmod.c`: requested call43, SGID-removal retry49.
- `bsd/vfs/vfs_syscalls.c`: shared helper8267, chmod8279, fchmodat8286.
- `bsd/vfs/vfs_subr.c`: nonmember-SGID authorization11011–11034, EPERM11033.
- libuv1.51.0 `src/unix/fs.c`: libc delegation1698.
- Node22.22.2 `src/node_file.cc`: uv delegation2716/2720.

This is source plus matched runtime proof, not a rebuilt/signed verification of
the installed kernel, shared cache, or Node binary. No universal host/ACL policy
or kernel-version portability conclusion follows.

## Production classification and owner decision

**Faraday, through parent:** no command grammar/calculation bug is demonstrated
for these six. `src/commands/metadata/chmod.ts:8` parses/calculates02707;
`src/commands/metadata/chmod.ts:84` forwards it. `src/commands/internal.ts:18`
handles the literal `--` invocation correctly. The requested command is exactly
the argv in the table, expected GNU status1/unchanged initial mode, actual
status0/0707 on RealFS (status0/2707 on MemoryFS). No command source edit is
requested. The original Curie authorship does not change Faraday's ownership.

The command does not stat after chmod, but that omission is **not the cause of
these six native statuses**. GNU's `mode_changed` check in pinned
`src/chmod.c:127` is invoked only inside the verbosity branch at330; these
original argv have neither `-v` nor `-c`. GNU fails on `fchmodat` itself.
Post-verifying and returning1 after RealFS chmod would still leave0707 instead
of the original mode and therefore would **not fix the original effects**.
No new verbose-output bug is alleged or counted by this bounded task.

**Parent/Poincare and the active RealFS comparison-wrapper source owner:**
`src/fs/real/index.ts:416` validates/resolves and forwards to Node at421. It
does not misparse, strip bits itself, swallow an error, or fabricate a status;
its direct behavior matches Node and public libc exactly. No separate RealFS
implementation defect against its Node-backed POSIX-style API is established.
However, **achieving the unchanged GNU status-and-no-effects requirement needs
a backend/authorization semantic change before effects, not a parser fix or a
post-stat patch**. That native-parity gap remains assigned to parent/backend
coordination. Whether to implement it in RealFS or another explicitly designed
backend authority interface is the owner's design decision; this leaf neither
changes source nor invents a policy waiver. No takeover of a Curie session or
direct reassignment of the active RealFS leaf was attempted.

Thus: **FS correction needed to remedy an accidental Node-forwarding bug: not
demonstrated. Backend work needed to close the six GNU parity failures: yes.**
Original six failures stay red. This is classification, not acceptance, waiver,
scope completion, or evidence of superiority. The core authority38 positive
workflows remain the higher-priority integration work; they were not duplicated.

## Frozen inputs, reproducibility, and harness limits

`final-evidence.json` is the authoritative expanded capture: **90 actual input
hashes stable before/after**, including the reachable source graph, Node binary,
installed tsx/esbuild files, package/lock/config, original/frozen evidence, GNU
binary/source inputs, and the reproduction/C helper sources. Both snapshots
observe HEAD `3aa3a4110c09fbab48d9aa8a8d762f48c8ce56cc`;
digest `543e8d41fd726cf68f79ea648b983ee9e57b726782db646555b53047fdf93fa6`.
This is a scoped moving-worktree snapshot, not clean committed-HEAD validation.
The earlier successful `classified-evidence.json` separately preserves the
29-input checkpoint before adding explicit Node-boundary/tooling hashes.
`repeat-evidence.json` independently reruns the expanded capture at
2026-08-27T01:14:55.099Z: all six original/native/MemoryFS/RealFS observations
and all24 positive layer controls reproduce again. Its identical90-input
digest survives unrelated HEAD movement to
`a3f26e6e2008677fc467dcc876c771fea5ab6284`. These are repeated observations,
never additional distinct failures. The frozen evidence tests pass **9/9**,
zero failures/skips/cancellations/todos; that is evidence integrity and
classification validation, not nine successful guest/native semantics.

- Current RealFS SHA256: `d3e79b80a5a48984e1f7f7dd9a79254c2db1faf8142e287a43792180874f77da`.
- Current chmod SHA256: `9286ebc9bea074bf9dad58cb6197aa5e10d325c549187eefbc9203ac76b09cfd`.
- Final evidence SHA256: `fbb39aedeb0155e249f16413e294575dc570629394c22e562bb5f5706a712ae4`.
- Source proof SHA256: `010a22e7ddffc00436f258274d500b9432fb13841aeb40207e7cf77afbe3a67f`.

Replay from this repository with existing tooling and pinned oracle, choosing
a new output name under this owned directory:

```sh
node --import tsx tests/fs/real/metadata-review/reproduce.mjs tests/fs/real/metadata-review/replay-new.json
node --import tsx --test tests/fs/real/metadata-review/classification.test.ts
```

The first command exits0 only when the known **unresolved classification** and
causal controls reproduce; it is not a GNU acceptance gate. It requires the
exact recorded Darwin uid/group profile and fails rather than skips a mismatch.
The second validates frozen evidence, not live production parity. Actual mode
updates are limited to private owned temporary fixtures. Native subprocesses,
C compilation, and DYLD interposition are development oracles only. No product
subprocess or native fallback is introduced. No broad metadata suite, global
typecheck, build, timestamp probe, or core-authority matrix is run here.

`evidence.json` and `current-evidence.json` preserve two failed instrumentation
attempts: using `dlsym(RTLD_NEXT, "fchmodat")` inside the interposer recursed and
the instrumented GNU child ended with SIGSEGV before row completion. Changing
the interposer to call its original imported symbol fixed the harness. The
first attempt had less detailed failure logging. Neither attempt is counted
as a product failure or acceptance result. An intervening startup hash-list
attempt requested nonexistent `get-tsconfig`; it stopped before fixture
creation and was corrected to the actually installed tsx dependency list.
All completed attempts record owned fixture cleanup; no unowned native
directory was removed. No child process is intentionally left running.
