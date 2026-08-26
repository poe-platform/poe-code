# Pipeline early-close cancellation evidence

August 26, 2026. This is the shell author's reproduction and validation of the
unchanged independent remote cases, not a new independent approval. Source
ownership was released by the PAUSED checkpoint at
`/tmp/safe-bash-shell-diagnostic-priority-pause.txt`. Source commit
`a3ef9d6a0590406fcb8dc2434ca81558f079836c` and documentation checkpoint
`55c1d2d0c24e0d42b8f5ad4d1cb71e6c1ac0ebf2` were clean before this work. The four
prior diagnostic/evidence files were not edited or staged.

## Root cause and policy

Previously, consumer completion aborted the incoming byte pipe, but the
upstream stage's cancellation controller was aborted only by a subsequent
failed write. A producer awaiting its next remote chunk never reached that
write, so GET and pipeline settlement remained pending after `head` completed.

Consumer completion now schedules one `setImmediate` notification to its
immediate upstream stage. A successful nonempty pipe write marks that stage
as an active producer. The notification cancels that producer only if its
command has not already settled. The event-loop turn lets already-settling
results and rejections finish before making the cancellation decision; it is
not polling or a stall-duration heuristic. Notification handles are cleared
on pipeline teardown. Existing failed-write handling remains in place.

The existing stage-local `PipelineClosed` reason has code `EPIPE` and produces
status 141. It does not abort the whole shell or replace the caller/budget
controller. Last-stage status and rightmost-nonzero `pipefail` selection remain
unchanged, including completed nonzero stages. The same stage signal reaches
middleware, nested literal `invoke`, redirected input, filesystem reads and
their transport/body cleanup. There are no public API, contract, adapter,
dependency, descriptor, stdin-origin or diagnostic-profile changes.

This is a deliberate virtual cancellation policy, not universal native Bash
SIGPIPE timing. A producer that has already supplied pipe bytes can now be
interrupted while awaiting subsequent work even without a second write. A
producer that has never supplied nonempty bytes is not eagerly cancelled just
because a consumer exits: no-write waits and independent asynchronous or
redirected filesystem effects retain their existing behavior. Such a stage
still needs caller cancellation if it never completes or writes. Arbitrary
uncooperative host work cannot be forcibly stopped by JavaScript cancellation.
No physical-stop, rollback or cleanup guarantee is inferred for such work.

## Frozen red-to-green reproduction

The frozen audit is commit `4e26ce0d386b9f3fcd25c3d540b5d43361b056d3`.
No oracle, test timeout, fixture, mock, transport or adapter was changed here.

```sh
AUDIT_CASE="S08|D08" node tests/stress/remote-cancellation/run.mjs
```

Before source edits: **0/2 pass**, exit 1. Both original 1200ms deadlines
expired after `head` settled. S3 recorded `signalAborted=false`, zero iterator
returns; native HTTP WebDAV recorded `GETclosed=false`. Caller-abort rescue
closed the S3 iterator and HTTP response/socket before fixture teardown.
After the shell change: **2/2 pass**, initially about 16ms and 28ms. S3 observed
transport abort and exactly one source return; HTTP GET aborted and the
response/socket closed, with final sockets=0, tasks=0, errors=0. No rescue was
needed. Two additional batches of three fresh strict replays also passed all
six case executions each, with unchanged source/fixture hash manifests.

The unchanged full remote audit passes **24/24** in this working tree. Its
original **20/24** result remains valid historical evidence. D02/D05 improvements
belong to Poincare's WebDAV commit
`3731587fa287333ca59c7a81569b367cec66f61d`, not this shell change. S3/WebDAV
source bytes were identical across this leaf's before/after pair; only shell
runtime bytes changed in that comparison. These seams exercise the real S3
adapter with its injected public mock transport and real WebDAV/native Fetch
against an ephemeral loopback HTTP server, not production provider credentials,
AWS wire/signing, TLS, proxy, auth or deployed-provider certification.

## Author controls and validation

`remote-close.test.ts` launches 19 strict-rejection child probes, each with a
hard 3000ms process-group deadline, a 1 MiB output ceiling, and explicit child
PID/status/residual-group accounting. Controls cover pending transport/read,
async-generator return queued behind pending next, late read rejection,
middle-stage and group propagation, consumer error/status, completed producer
success/failure/rejection, nested invoke/middleware/filesystem signal identity,
stdin origin, redirects, caller-reason identity, output quota, no-write and
zero-byte producers, write-after-close, and subsequent same-exec commands.
Cleanup/finalizer counts and unhandled-rejection monitoring remain asserted.

Three initial controls (transport, pipefail, pending iterator return) each hit
the unchanged 3000ms child kill before the runtime fix. All 19 final controls
pass. An initial typecheck found two author-test typing issues; both were fixed
without changing runtime behavior or adding dependencies.

| Gate | Actual result |
| --- | --- |
| Focused lifecycle/pipeline/descriptors/origin/invoke/errors/limits | 203/203, initial 16 controls included |
| Final full owned shell | **726/726**, previous 707 plus 19 new controls |
| Existing modern holdout | 57/57 |
| Existing input-boundary holdout | 12/12 |
| Unmodified original/current historical cohorts | 109/118, prior nine failures unchanged |
| Complete primary GNU 5.3 profile | 88/88 portable fixtures; 29/29 resources |
| Complete historical GNU 3.2 profile | 74/88 portable fixtures; 29/29 resources |
| Frozen native profile drift | 0 for both profiles |
| Whole-repo `tsc --noEmit` | exit 0, final guarded repeat |
| `tsc -p tsconfig.build.json --noEmit` | exit 0, final guarded repeat |

All final gate source/test manifests are unchanged within their runs. The
first full-owned attempt was 725/726 with one explicit source-hashguard
invalidation caused by concurrent unowned `src/commands/network/body.ts` and
`curl.ts` edits, not a shell semantic mismatch. That failed capture is retained;
the stable complete 726/726 repeat supersedes it, not a selective exclusion.
The complete profile runner correctly exits 1 because historical differences
remain. It uses the original frozen profile evidence and uniform argv0; no
stderr normalization or expectation updates were applied.

The nine original/current historical failures remain:
`move-output-really-closes-source`, `move-input-really-closes-source`,
`prevalidation-prior-output-and-file`,
`fatal-parameter-preserves-only-earlier-effects`,
`nested-substitution-syntax-error-does-not-prevent-earlier-effects`,
`fatal-parameter-expansion-prevents-following-file-effect`,
`fatal-arithmetic-expansion-prevents-following-file-effect`,
`fatal-expansion-in-substitution-stops-substitution-only`, and
`command-substitution-removes-nul-bytes`.
The expanded exact-byte historical profile additionally differs on its five
syntax diagnostics, preserving the 74/88 denominator. The existing no-write
native `sleep` pipeline wait/kill control passes unchanged. The separate
nested-blankline NUL-warning mismatch remains PAUSED and outside this fix.

## Artifact and import provenance

Raw commands, timestamps, PIDs, stdout/stderr hashes, complete before/after
source/test/config manifests, and exit results are in:

- `/tmp/safe-bash-shell-remote-close-before.log`
- `/tmp/safe-bash-shell-remote-close-before.sha256`
- `/tmp/safe-bash-shell-remote-close-author-red.log`
- `/tmp/safe-bash-shell-remote-close-validation.json`
- `/tmp/safe-bash-shell-remote-close-final-validation.json`
- `/tmp/safe-bash-shell-remote-close-profiles.json`
- `/tmp/safe-bash-shell-remote-close-import-proof.json`

Per-gate raw logs use the validation JSON's prefix followed by
`-{gate}.stdout` and `-{gate}.stderr`. Final guards cover the complete owned
cohort, frozen S08/D08 repeats and both no-emit checks. All 13 guarded outer
process groups ended without timeout or residual processes. Final author
probes also report no residual groups. Initial red children were hard-killed;
no author test children, remote requests or servers were intentionally left
running. Dynamic imports resolve to actual `.ts` root/runtime/input/contracts/
adapter modules, and the loaded runtime's pipeline contains this close logic.
No generated `.js` siblings exist in the owned scope; none were deleted here.

| Artifact | SHA-256 |
| --- | --- |
| Runtime before | `a5c71a123e3e2d1a3735e09fa2bfca9ce5c6a3def09ca300356bcd95fa273d96` |
| Runtime after | `0d4f6fd7c56702dd585d6838278d5b0184288446f95ee9cf5392acf8ee22e60d` |
| Frozen remote cases | `fc260b459fd75dae542f896396b75ec115d88e753c34cb618a7fab3b963dcbe8` |
| Frozen remote helpers | `9e76ecf9ba6604fc2c4b94a96cf5b46ffed97de5e7d0c2524e138b4410e17678` |
| Frozen remote runner | `ece894130bcd7e8a969cfde8590cc332e3dd7f8ab3c449e4d492f3ac1cf1aed5` |
| Final validation JSON | `df0311376a06c06e6d5f5eacf53e2374cd6537cdb62a52b66781811d901a85fc` |
| Complete profiles JSON | `a48f5d2d11bb19059b93a8795a9e4240c737a20270b1d04b9d8b9800c0f4976d` |

Archimedes' independent post-commit frozen replay remains a separate acceptance
step. This patch does not establish full Bash support, broader syntax, overall
product completion, superiority to just-bash or 72 hours of work.
