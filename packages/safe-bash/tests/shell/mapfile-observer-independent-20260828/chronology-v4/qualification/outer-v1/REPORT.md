# Outer revision — HOLD, not a launch-ready packet

2026-08-28. Controls/recipe first sealed at
0977d9686b09294db96a6394370e6d899127675a. Implementation/loader preseal:
00bb4765459176dafc4b5c77fc97d2630c46a689. One targeted mock cohort:
**8 unique controls,8 executions,8 passes,host exit0**. No replay of the old
whole-driver cohort; H01–H05/D01–D03 are unchanged. Previous063bfadb evidence
remains immutable. No real qualification parent/entry/Bash, tool-body reread,
version probe, network, build, dependency installation or product execution.

Implemented component code supplies a startup/elapsed timer before authentication,
known-parent TERM/KILL/close monitoring, joint raw stdout/stderr capture, bounded
framed guard journal, status, and a persisted/read-back-authenticated **capture**
receipt plus seal. These are actual whole-module calls against mock ports, not
physical process/FS evidence. The normal capture remains qualificationAuthorized
false and descendantCleanupUnknown true. No synthetic spawn/close certifies OS work.

Reuse is actual unchanged createOwner source from063bfadb (SHA256
9df7ea2d88691caf1f2c7dc5496d7eae661cf7738511d6f4f349a1b793254396), plus the
unchanged candidate finite-own-data module. The collector and finite-FS adapter
are new adaptations, not inherited acceptance of a different supervisor. The
c630301c post-close-signalling supervisor is not reused. Exact commits/blobs and
existing Node/GNU body attestations are in INPUTS.json; metadata still matches,
with zero new binary-body reads.

Component bounds:72000ms elapsed from before authentication,10ms owner polling,
TERM then KILL250ms later,1250ms settlement;74000ms terminal uncertainty. Startup
work returning late is checked before spawn. No syscall-preemption promise.
Raw stdout+stderr jointly524288 bytes;1024 data/events; journal1024 frames,
4096 bytes/frame,131072 total; status/receipt/seal each65536 bytes; outer writes
1048576 total. Adapter reserves8192 FS calls and8388608 read bytes including EOF
probes; at most8 files and8 admitted descriptors. It uses opendirSync(bufferSize:1),
stops at the first unexpected entry, and does not allocate a whole directory list.
O07 stopped after three entries and refused another read before opening its file.
These bounds apply only through this adapter, not the existing inner processes.

Planned component paths: `/private/tmp/mapfile-observer-outer-RUNID/` (0700),
sibling `...-RUNID-guard.bin`, and `stdout.raw`, `stderr.raw`, `status.json`,
`receipt.json`, `receipt.seal.json` (0600). No such real paths were created.
The guard is acquired before root mkdir. Known mock parent handles settle;
uncertain detached descendants are never reconstructed from journal PIDs.

**Unfinished blockers:**
1. Existing parent/entry still have allocating readdirSync and unmetered
   readFileSync paths. A wrapper cannot supply their cumulative accounting.
2. No production Node-process/authentication adapter or outer-to-inner rootPid/GO
   bridge exists. The new outer PID would become the inner parent's process.ppid;
   the old launch-shell PID field is not reusable unchanged. No complete combined
   physical archive/root launch is claimed.
3. Static review found a close-error ledger defect: a throwing close currently
   clears the FD reference/decrements its counter without retaining explicit
   uncertainty. O06 tests publication failure, NOT this close-error path. That
   defect is preserved and blocks a cleanup-complete claim.

The O04 fixture's arbitrary journal PID was not consumed: only parent-crash
behavior was dynamically exercised. No dynamic journal-injection coverage is
claimed. Root crash/descendant cleanup remains STOP/uncertainty, never success.

To stay within the eight-control scope, no additional adapter framework, replay,
or post-test source repair was attempted. `launch.mjs.data` unconditionally throws
NOT_AUTHORIZED_HOLD before imports. There is intentionally **no usable real launch
command or grant**. HOLD.json enumerates the exact missing work. Native43 remains held.
