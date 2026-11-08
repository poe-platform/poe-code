# First-read lifecycle — RED checkpoint, no approved API

August 26, 2026. **This is a required custom resource-lifecycle objective, not
a claim that every stronger cancellation requirement is a Bash parity bug.**
No production code changes or lifecycle API approval accompany this checkpoint.
The historical capture used shell source `90ddc748f21e2164ea3f20e47f32bbdad6a5b20c`; the reporting
correction `adba1ea8c95dbaf8e4f4330d306d1d411d085b44` remains intact. Diagnostics,
including the paused nested NUL-warning line 6-versus-8 difference, stay paused.

The six added default tests deliberately retain **1 pass / 5 failures**. They
are not skipped, xfailed, relocated or relaxed. A prior 726/726 shell result
does not cover these additions. No blocked virtual test or full suite was
rerun during this documentation turn.

## Objective, native behavior, current behavior

- **Required custom objective:** when cooperative work is genuinely bound to
  an output pipe that no longer has a reader, settle the pipeline and release
  its owned pending source/transport even before the first output byte, without
  caller rescue. Retain successful downstream status and real error semantics.
  Do not cancel independent work merely because its command happens to have a
  pipe as stdout. The ownership/intent mechanism is still unresolved.
- **Native measurements:** Bash can continue waiting after a no-read consumer
  exits. A subsequent write, rather than consumer exit itself, can produce
  SIGPIPE. Delayed errors and independent/file-directed effects remain useful
  outcomes. The fixed-profile measurements below establish these distinctions;
  they are not a universal utility or Bash compatibility claim.
- **Existing `90ddc74`:** after successful nonempty pipe output, downstream
  completion schedules a stage-local cancellation check on the next event-loop
  turn. Unfinished active producers receive `PipelineClosed`/`EPIPE`, status
  141; completed statuses remain intact. Before any successful nonempty write,
  the gate does not fire. The new pending-first-read cases remain **failures
  against the custom objective**, not newly accepted policy exceptions.

The existing after-first-write behavior is itself stronger than native waiting
in some cases. Its frozen S08/D08 assertions passed under `AUDIT_VERBOSE=1`;
see `REMOTE_CLOSE_EVIDENCE.md`. Do not infer a nonverbose runner exit 0 from
those captures. The separate formatter work belongs to its owner.

## Durable reproductions and observations

`first-read-evidence.json` contains the preserved source hashes, exact commands,
source scripts, raw child event snapshots, independent reviewer observations,
native binary identities, sanitized environments, statuses, files and PIDs.
It is evidence, not an expectation override. Original `/tmp` artifact hashes
remain recorded, but the relevant observations are retained in this repository.

### Exact independent archive (archival correction after `13f8c3a`)

The independent script and its required external deadline guard are now exact-byte
evidence attachments, not new tests or an implementation:

| Repository archive | Original source | SHA-256 |
| --- | --- | --- |
| `tests/shell/first-read-independent.snapshot.mjs` | `/tmp/safe-bash-first-read-independent.mjs` | `b480b7417f7d669bf413f634a0a30b7ff296667736d52ef0a597ebd72f6ea0fa` |
| `tests/shell/first-read-guard.snapshot.mjs` | `/tmp/safe-bash-remote-close-additional-verifier.mjs` | `8a9858bc16824951b9ade3f158cdb161b0a6d3870a72588220341f11e6a19031` |

Neither filename matches the regular suite's `tests/**/*.test.ts` discovery.
Historical commands, timestamps and raw results in `first-read-evidence.json`
are unchanged; the archive metadata adds a runnable path, not a fresh result.
To reproduce one historical scenario safely, use the existing guard, not the
scratch script alone:

```sh
cd /Users/kjopek/Workspace/safe-bash
node tests/shell/first-read-guard.snapshot.mjs first-read-archive-local-001 6000 \
  node --unhandled-rejections=strict --import tsx \
  tests/shell/first-read-independent.snapshot.mjs local-generator
```

Choose a fresh lowercase/alphanumeric/hyphen label for each run: the guard refuses
to overwrite `/tmp/safe-bash-remote-close-additional-LABEL*` artifacts. The other
preserved scenario arguments are `head-direct`, `local-pipefail`, `s3-first`,
`s3-middle`, `dav-first` and `curl-first`. The guard retains the historical 6000ms
outer process-group deadline, descendant cleanup, strict rejection mode and
before/after source manifests. Its deadline is necessary because the script's
1200ms acceptance races do not bound every teardown await; a forced stop is not
a passing cleanup assertion. The unchanged guard has no output-size cap.

This snapshot is intentionally **not portable**: its imports and the guard's cwd
check name this absolute checkout. It requires the existing Node/`tsx` tooling,
`apply_patch`, `git`, `ps` and POSIX process-group support; no installation is
performed by this command. Remote scenarios use injected S3 or loopback HTTP,
not provider credentials. Execution imports the checkout's actual TypeScript,
not a pinned copy of `90ddc74`: compare the recorded source hashes before making
a historical equivalence claim. The captured runtime SHA-256 is
`0d4f6fd7c56702dd585d6838278d5b0184288446f95ee9cf5392acf8ee22e60d`.
Concurrent source work may differ. This archival correction runs neither script,
tests, native controls nor typechecking and makes no live-runtime pass claim.

### Existing author reproductions

Run the six existing author probes through their unchanged hard deadline:

```sh
node --unhandled-rejections=strict --import tsx --test \
  --test-name-pattern='pipeline close: first-read-' tests/shell/remote-close.test.ts
```

`remote-close.test.ts` launches `first-read-probe.ts` in separate strict-rejection
process groups: 3000ms outer deadline, 1 MiB output ceiling, residual-group
check. Each execution/cleanup acceptance await uses the existing 1200ms helper.
The following are literal shell sources; `URL` means the recorded fixture's
fresh `http://127.0.0.1:<ephemeral-port>/dav/input`, not an external endpoint.

| Author case / work type | Exact shell source | Observed baseline |
| --- | --- | --- |
| Standalone zero-input consumer | `head -n 0` | Pass: status 0; no read |
| Local signal-cooperative async generator through `pipeBytes` | `pending-stream \| head -n 0; true` | 1200ms deadline failure |
| Actual S3 adapter, injected GET body | `cat /input \| head -n 0; true` | 1200ms deadline failure |
| Actual WebDAV/native Fetch, headers without body | `cat /input \| head -n 0; true` | 1200ms deadline failure |
| Explicit optional curl, native HTTP body wait | `curl URL \| head -n 0; true` | 1200ms deadline failure |
| Explicit optional curl, native HTTP header wait | `curl URL \| head -n 0; true` | 1200ms deadline failure |

Middleware waits for the first pending source/GET before allowing the actual
`head` handler to run. It does not replace `head` or fake backend cleanup. Curl
uses an exact-URL/GET authorizer; no ambient network plugin, credentials or
production endpoint is used. S3 uses its real adapter/public injected seam;
WebDAV and curl use actual loopback HTTP sockets. No full remote object is
buffered to evade the stalled read.

The guarded author capture was 22:54:06–22:54:13 UTC: exit 1, **1/6 pass**, five
deadline failures, zero skips/cancellations, unchanged source/test hashes.
Representative raw observed events, preserved without shell-error rewriting:

```text
source.next:pending-before-first-byte
command.settled:head:0
Error: DEADLINE: first-read-local (1200ms)
```

Before teardown, each failed author case records `active=1`, `reads=1`,
`returned=0`, `abortedBeforeTeardown=false`. HTTP cases record
`http.GET:pending-before-first-byte` followed by `command.settled:head:0`.
Failure remains failure before the author's teardown abort releases resources;
that abort is **not** rescue to PASS. The trailing `true` checks continuation
and means these author cases do **not** independently prove pipeline status or
pipefail precedence. Those acceptance cells remain requirements below.

The separate read-only reviewer reports **0/6 required pipelines**, plus
head-direct 1/1: `cat | head -n 0`, its `set -o pipefail` variant,
`cat /input | head -n 0`, `cat /input | cat | head -n 0`, WebDAV and curl.
This author did not rerun or independently certify that cohort. Its retained
raw events include:

```text
pipeline:cat /input | head -n 0
source.next.pending-before-first-byte
command.settled:head
FAILURE.before-teardown:FAIL: no-caller-rescue pipeline settlement exceeds unchanged 1200ms gate:activeGETs=1:return=0:stageAborted=false
fixture.teardown.begin:failed=true
```

The reviewer uses no caller abort: gate release/socket destruction happens only
after failure is recorded. Its external local generator has no abort-aware
pending promise: requesting `return()` is not proof that its body/finalizer has
finished. This is a distinct ownership problem from the author's cooperative
local source; neither result is silently waived.

Both controls prove virtual `head -n0` does not read. Direct command execution
acquires/reads/returns **0/0/0**; Shell-level execution records **1/0/1** because
`ShellInput` owns initial iterator acquisition and final cleanup. These are
different boundaries, not contradictory observations or stdin-origin probes.

## Native contrast, fixed profiles

Both complete cohorts use the same scripts, fixed argv0 `shell`, sanitized
`PATH=/usr/bin:/bin`, `LANG=LC_ALL=C`, `TZ=UTC`, isolated fresh HOME/TMPDIR, and
the existing process-group harness. No profile is selected per case.

- Primary: GNU Bash 5.3.0 at
  `/tmp/safe-bash-gnu-bash-5.3.Ua5t02/install/bin/bash`, SHA-256
  `8cecb482de24198c23a736b931cb7e8cee1f94eb0b51abd54bd99f1d73d9673c`.
- Historical: GNU Bash 3.2.57 at `/bin/bash`, SHA-256
  `35536aea9733aa345b61134a98d00232380898e55b2ea2a07c497011f7dfc7a3`.

**Native utility limitation:** this host's `/usr/bin/head -n 0` rejects zero
with `head: illegal line count -- 0`. The initial 12 native observations retain
that error; the following marker `printf` gives their consumer group status 0.
They are **not successful native head-zero evidence**. No GNU head was installed
or downloaded. A separate complete cohort uses the explicit successful no-read
consumer `{ :; printf "consumer.done\n" >&2; }`, not a relabeled head oracle.

For both profiles that successful no-read cohort measured:

| Producer behavior | Observed native outcome |
| --- | --- |
| No write, `/bin/sleep 2` | `consumer.done` observed; pipeline still waiting at 200ms; group killed |
| Delayed first `printf x`, default status | `pipeline=0 stages=141 0`; later `after` file absent |
| Same delayed write with pipefail | `pipeline=141 stages=141 0`; later `after` file absent |
| Delayed stderr error and `exit 7` | `pipeline=7 stages=7 0`; `late failure` preserved |
| Delayed independent write to `effect`, exit 7 | `pipeline=7 stages=7 0`; file contains `kept` |
| Producer stdout redirected to `out`, exit 7 | `pipeline=7 stages=7 0`; file contains `kept` |

Completed scripts use a 1000ms hard bound. Their final reporting `printf` exits
0; the strings above are the captured pipeline/`PIPESTATUS` values, not the
outer process status. All literal scripts/arguments/files are in the JSON.
A further identical two-profile control uses valid host `head -n 1` after
`printf "first\n"`: stdout is `first\n`, `consumer.done` appears, and Bash still
waits for `/bin/sleep 2` until the 200ms group kill. Thus earlier successful
output does not make the existing eager virtual policy universal Bash parity.

These are local measured observations, not documentation-derived assertions.
To reproduce a stored native row, pass its profile executable and
`argvTemplate` with the corresponding `case.source` to `isolatedSpawn` from
`tests/shell-stress/process.ts`, using the recorded sanitized environment and
deadline in a new empty temporary directory; remove it after snapshot/cleanup.

## Acceptance by work type and ownership

**M** = measured existing behavior; **R** = required preservation/objective;
**U** = unresolved integration/design, not an implemented pass. Command names
below identify repros, never runtime cancellation heuristics.

| Work/resource type | Evidence and required semantics | State |
| --- | --- | --- |
| Owned, signal-cooperative source-to-sink transfer | Local `pipeBytes` first read fails; cancel owned wait/return before acceptance, retain downstream success | M fail; R; U binding |
| Lazy filesystem-to-sink transfer | S3/WebDAV first GET fails; cancellation must reach actual transport/body, not merely the outer await | M fail; R; U binding |
| Explicitly authorized HTTP-to-stdout transfer | Curl header/body waits fail; include pending authorization/transport/body scope, observe late rejects and dispose responses | M fail; R; U scope |
| Transfer after nonempty pipe output | `90ddc74` S08/D08 verbose assertions pass; preserve stage-local 141, no whole-shell abort | M prior pass; R |
| Borrowed/shared input cursor | Existing `pass \| true; pass` delayed generator outputs `B`, not a replayed `A`; serialize reads, preserve reserved bytes and delayed rejection diagnostics | M prior controls; R; U early-close ownership |
| Pending async-generator next without cooperative abort | `return()` can queue behind pending next; observe late next/return rejection; do not claim forced finalization or fake zero activity | M reviewer fail; R honest accounting; U ownership |
| Opaque no-write asynchronous work | Preserve delayed real errors/status and independent filesystem effects; no blanket stage abort | M prior/native controls; R |
| File-directed output | Redirection/curl VFS output must not bind the body transfer to unrelated pipe stdout; keep file effects and real errors | M prior/native redirection; R; U curl integration |
| Already-completed producer / genuine error | Retain completed 0/7/error results; do not replace an observed failure with synthetic cancellation | M prior controls; R |
| Middle stage / pipeline status | Propagate close along actual dependencies; ordinary result is last-stage status, pipefail rightmost nonzero; interrupted stage retains existing 141 policy | M first-read reviewer failures / prior after-write controls; R |
| Descriptor aliases, moves, closed slots | Follow actual sink identity through wrappers; retain shared offsets; EBADF remains a descriptor error, not invented pipe cancellation | M prior controls; R; U forwarding |
| Nested invoke / middleware / stdin origin | Preserve literal invocation, cancellation ownership, middleware errors and provenance metadata; no signal override or byte-origin probe | M prior controls; R; U forwarding |
| Caller abort / execution quota | Preserve exact caller reason or `ShellLimitError`; never turn either into normal early-close success | M prior controls; R |

The new first-read checkpoint does not measure green implementations of these
requirements. Future status/error checks must not rely on the trailing `true`.
For a genuinely cancelled operation, observe late settlements without unhandled
rejections; do not confuse those with independent delayed command errors that
must still be reported. Mixed file-body/stdout-header/write-out operations need
phase-specific ownership, not blanket cancellation of the file transfer.

## Proposal only: minimize before choosing an API

The shell cannot infer output intent from arbitrary pending plugin work. Keeping
the current gate alone leaves the custom goal unmet. Unconditional abort hides
errors/effects. Command-name detection, source probing, intercepting every FS
read, or elapsed-time heuristics do not establish resource ownership.

An explicit output-operation lifetime is a **proposal**, not an approved field,
signature or requirement to expand the public API. Curie/root must first decide
whether existing/internal stream composition suffices, and introduce a shared
contract only if the real cross-owner lifecycle requires it. If chosen, it must
bind before pending work, release on every settlement path, forward through sink
wrappers and distinguish source cancellation ownership from a borrowed cursor.
Automatically applying it to every `pipeBytes` call can break the shared-input
and delayed-error controls; a new sink hook alone cannot terminate an opaque
generator's uncooperative promise. Do not add an API just to make tests green.

Curie's `906d66b` review in `docs/OUTPUT_LIFECYCLE_REVIEW.md` recommends explicit
**owned-lease opt-in**, not automatic `pipeBytes` activation. The candidate
signatures in `/tmp/safe-bash-shell-lease-contract-proposal.txt` remain unapproved;
root has routed the questions, not reported mutual agreement. Consent to abandon
an enclosing stage's independent effects during nested invocation, and a rejected
read hidden behind pending iterator cleanup, remain unresolved. The five custom
first-read failures remain required unresolved cases, **not a universal curl
acceptance blocker**.

Curie owns contracts/core `pipeBytes` and cat's separate streaming loop;
Archimedes owns curl's stdout-bound transfer integration. Shell owns stage-local
tracking only after agreement. Hook/release names, activation scope, cursor
reservation, pending-error precedence and mixed-output phases remain owner
decisions. Arbitrary uncooperative JavaScript cannot be forcibly stopped; that
limit is not permission to relabel required failing cases as accepted.

## Checkpoint validation and limits

The original `13f8c3a` checkpoint captured 26 bounded native children: 12 rejected-head-zero
observations, 12 successful no-read contrasts, two valid head-one wait controls.
All groups stopped with no residuals; temporary fixture directories were
removed. No virtual blocked rerun, watcher, source implementation, contract
change, full suite, emitting compiler, download or production network occurred.
That checkpoint's `node node_modules/typescript/bin/tsc --noEmit` exited **0**. The earlier
exit 2 with two unowned readonly-FS typing errors remains preserved in the JSON.

These tests exercise injected S3 and local HTTP resource seams, not AWS wire
signing, deployed WebDAV, TLS/auth/proxies, provider rollback or universal
cleanup. The first-read READY marker remains absent. This is an explicitly RED
checkpoint awaiting owner design, not a fixed shell, Bash parity defect count,
full-shell completion, superiority claim or evidence of 72 hours worked.
