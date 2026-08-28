# GNU 5.3 native preseal v1 — NOT_AUTHORIZED

Design data only. **nativeCalls=0, productCalls=0, tests=0, imports=0.**
No executable runner, autotest, fixture tree, build, install or download exists
in this packet. A separate root GO naming this committed manifest is required
before any recipe or Bash invocation, including version/help/syntax checks.
Existing module holds remain unchanged. Native observations cannot authorize
product work or establish whole-Bash parity.

## Identity and prospective invocation

Absolute binary:
`/private/tmp/safe-bash-gnu-bash-5.3.Ua5t02/install/bin/bash`

SHA256 `8cecb482de24198c23a736b931cb7e8cee1f94eb0b51abd54bd99f1d73d9673c`.
Read/hash verified against `tests/shell/let-design-20260828/BINDINGS.json` and
the independent LET binding, not inferred from the filename. The published
manual SHA256 also matches (SOURCE-BINDING). No fresh version output exists.

After separate permission only: supervisor launches each row once, sequentially,
using that binary and literal argv `--noprofile`, `--norc`, `-c`, row.script,
`indexed-preseal-v1`. No shell wrapper, `eval`, `source`, external utility,
additional interpreter command, background job or untrusted script. `declare -p`
and `export -p` are native builtin visibility observations, not promises that the
product has declare/export-p. EXIT traps in N11/N12/N15 are fixed literal builtin
inspection recipes, never generated from output. No set-e confounder.

Replace environment entirely with exactly PATH="", ENV="", BASH_ENV="",
HOME=<owned-root>/home, TMPDIR=<owned-root>/tmp, LANG="C", LC_ALL="C", TZ="UTC".
No inherited functions/options/credentials/locale or startup paths. Empty stdin;
cwd=<owned-root>. Future supervisor exclusively creates
`/private/tmp/indexed-arrays-preseal-v1-<unique>` mode 0700 and records its exact
resolved identity before children; creates only home/tmp subdirectories.
N15 alone may write `<owned-root>/tmp/rhs.txt` via builtin printf. Do not create
these fixtures during preseal. No deleting or reusing preexisting temp paths.

## Hard limits and settlement

| Limit | Sealed prospective ceiling |
| --- | --- |
| Native calls | 16 top-level launches, no retries; two command substitutions may add two Bash-managed child contexts. Conservative total 18, absolute maximum 20. No version call or nested Bash command. |
| Time | Each top-level row including descendants ≤3 seconds; deadline initiates termination at 2.5s, TERM→KILL at 2.75s; require observed closure by 3s or stop as cleanup failure. Do not claim an OS reaping guarantee. |
| Captured output | stdout+stderr ≤65536 bytes per row, ≤1048576 total; count bytes before retention. Overflow terminates group and stops, preserving bounded partial bytes. |
| Sources | Each script and aggregate script UTF-8 bytes ≤16384. |
| Owned fixtures | ≤16 entries including root/directories, ≤65536 regular-file bytes. No links/unowned paths. N15 fixed payload is five bytes. Receipt files are separately bounded by output caps and recorded outside the fixture tree. |

One detached, known supervisor-owned process group at a time. Register cleanup
before launch; retain PID/PGID and distinguish successful spawn from launch error.
Terminate only that group; wait/reap, observe all late failures and verify no group
survivors before proceeding. No process-name killing, unowned PID adoption or
continuation after integrity/deadline/output/cleanup failure. Nonzero native
status is an observation, not a retry trigger. Bound total wall admission to
48 seconds plus supervisor metadata work; no unconditional success if cleanup
cannot meet the deadline. Timeout cannot undo completed filesystem writes.

Pre/post verify binary/manual, committed manifest, every sealed document/row
hash and fixture inventory, including **new entries**. Recheck binary before each
launch. Authenticate root GO and exclusive result-directory identity; mismatches
stop, never fall back to PATH/live sources. Record row script hash, exact bounded
stdout/stderr bytes, exit/signal, timing, closure and fixture effects; remaining
rows stay unexecuted on stop. No nativeexpected values are supplied or scored.

Async parent mutation/readonly while awaiting host work and caller cancellation
remain unqualified design cases. N14's function runs in command substitution:
its readonly attribute is isolated, not a parent reentrancy test. N15 observes
external file effects, not parent variable mutation. Any later altered recipe,
retry or broader resource experiment needs new root permission and versioning.
