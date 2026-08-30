# Independent Q1 ordering correction replay

## Result and scope

One bounded full replay completed with supervisor exit0 on August27,2026.
No acceptance rerun, production/source/API change, rebuild, rootdist use, dependency
installation, native comparison rerun, current whole-TypeScript check, full suite,
delegation or promotion occurred.

| Cohort | PASS | FAIL | BLOCKED | UNRUN |
| --- | ---: | ---: | ---: | ---: |
| New replay parameters | 32 | 0 | 0 | 0 |
| New replay logical cases | 12 | 0 | 0 | 0 |
| Original20 within new replay | 20 | 0 | 0 | 0 |
| Targeted12 within new replay | 12 | 0 | 0 | 0 |
| First raw parameters, unchanged | 31 | 0 | 1 | 0 |
| First conservative parameters, unchanged | 29 | 0 | 3 | 0 |
| First conservative logical cases, unchanged | 11 | 0 | 1 | 0 |

The new32 are the same frozen parameters, not added cases or rewritten expectations.
Original historical17 PASS/3 BLOCKED, originalfive1/5 and old v2 evidence remain
untouched. New original20 passes do not turn that historical cohort green.

Pre-run binding commit:97909bec33c440e9917b13df188af1ad19700e23.
Declaration-evidence supplement:13536dd8705cdbfc68a19da1549b21b069020f41.
The three already-sealed declaration captures needed explicit force-add because
their inert evidence path contains dist; no ignore/config rule was changed.
Both commits precede actual product execution. Final evidence commit is published
in /tmp/safe-bash-owned-output-qualified-ordering-final-result.txt after committing.

## Exactly three corrected bindings

1. **S11/error-first-caller-error-cleanup-error — PASS.**
2. **S11/error-first-caller-zero-cleanup-error — PASS.**

First evidence really reports selectedExecution.reached=false in both raw PASS
rows. The original command's registered cleanup prevents progression to its later
syntax unit; an ordinary registry throw is not a selected public rejection. The
original raw rows, inputs and conservative qualification remain authenticated.

The disclosed parser sibling calls the existing public parseShell(')') only after
the local Error is observed and local operation normally closed with holder cleanup
entered. The genuine parser failure reaches the outer Shell syntax-diagnostic host
sink. That sink actually rejects with the identical locally observed Error. No new
product getter, private hook or manually asserted selector value is used.

Both frozen journals record local.failure2 < local.close3 < cleanup.enter4 <
selector.public-parser5 < host.diagnostic6 < selected.sink.enter7 <
selected.sink.rejected8 < owner.source.return9 < caller.abort.request10 <
caller.event11 < cleanup.explicit-release12 < cleanup.release13 < cleanup.reject14 <
public.settled15. The owner return is the existing top-level #execute finally path,
after rejection of the outer sink await, not a new handback or an opaque hold.
Together with source flow and the pending-public assertion, this establishes the
selected rejection before caller while registered cleanup holds settlement.

Public errors retain caller Error identity or exact0; local and selected errors
retain the same separate execution Error identity. One shared holder cleanup fails
with its own Error and is drained/observed. Local operation stays unaborted. Existing
pipeline finalization may abort a stage, but no new stage-cancellation behavior was
introduced. A selected host rejection is not claimed merely from a command throw.

3. **S11/normal-close-synthetic-caller-undefined — PASS.**

Strict NodeNext compilation checks the consumer against actual candidate declarations:
227 input files including63 candidate declaration files, skipLibCheck:false and
noEmitOnError. No cast or fabricated product hook is used. The owned native-branded
signal has per-instance public reason/throwIfAborted overrides, while native backing
provides idempotent abort events. The actual supplied signal.reason is undefined;
its public throwIfAborted throws undefined. This is explicitly synthetic, not native
AbortController.abort(undefined) support and not a new public API requirement.

Native AbortSignal.any accepts this branded signal but its combined reason remains
the backing default AbortError. That limitation is recorded, not relabeled literal
undefined propagation. Shell's final caller check uses the supplied caller signal's
actual public method/reason. Runtime evidence has kind:error AND an own error field
serialized as {serializationTag:undefined}; identity/presence assertions execute
before serialization. One caller event and one onabort invocation occur; repeated
abort is idempotent. Normal local close precedes caller and remains unaborted.
The separate native-default-undefined parameter remains unchanged and passes using
its actual non-undefined default reason.

Host-only qualification had two pre-import assertion failures about currentTarget:
one browser-style assumption and one mismatched native listener topology. Original
qualification captures and compiler records remain beside the corrected identical
once/onabort/composition host topology. No product import occurred in these checks.
The replay journal records currentTarget without falsely asserting browser semantics;
event target, count, lifecycle, reason identity and required order remain asserted.

## Authentication, resources and reproducibility

Source:6de9b96c7286cc320379d8f7f720f3d1a5ecffdc24b7268b198859550362feea.
Tests:dd1814102e91c030d9cb1723bbaf69c3bf467ecd404e89dcb07cc315e5f5e35c.
Compiled:2578b6ea39cfdeb5b942b9aff20ec9bfff1fcf907cd2af751d8e73f5c24e632f.
Driver:1a1762100d768377294e9fc3acaed3456558460298456ca2c6389dca07a3df85.
Source S2=S1. The fresh940-file archive inventory has no extra file or symlink.
The selected public/internal compiled closure remains158 modules.8680 baseline/
candidate/old-evidence paths match before/after;8745 combined sealed input/fixture/
typing paths match immediately before and after execution.464 execution identities
include all strict consumer inputs. No executable or assertion changed after freeze.

Authentication interval:2026-08-27T13:06:48.007Z–13:14:03.342Z. This measures that
recorded interval only, not full-session elapsed time,72 hours or release readiness.
The exact command, owned environment,1200ms/3000ms deadlines and1MiB output bound
are frozen in PRE-RUN.md and driver. TSX_DISABLE_CACHE=1 and owned TMPDIR/TMP/TEMP/
TSX_CACHE_DIR precede every test-child loader. Code captures are inert .data or
.patch-data; executable copies are only under the unique ordering TMP namespace.

All32 corpus children are reaped; direct PIDs and process groups are absent. All32
fixture reports have zero timers/sockets/tasks/failures; no timeout, oversized output,
residual group, kill or unhandled fixture rejection. Controlled opaque fixtures are
released through unchanged teardown. Cooperative holder failures are separately
observed, not masked by public caller precedence. No promise wait was added for an
opaque losing handler. Tool compiler/tar/diff child PIDs are recorded where available;
this is not a complete retrospective PID ledger for synchronous CLI tooling itself.

acceptance.result.json and raw/ preserve every child's output; error-order-journals
isolates the three corrected records. qualification.json retains old versus new
records and counts. pre-run-seal, input manifests and final ARTIFACTS hashes bind
source, inputs, typed fixtures, exact deltas and output. seal-check is read-only
verification, not another product round. Future reproduction must materialize a
fresh unique TMP and rebind/freeze its paths before executing; do not reuse this
sealed namespace or rerun the bounded trial in place.

Full whitespace-check output retains the original unified-diff context marker's
trailing space. Scoped checking excludes only driver.mjs.patch-data and the raw
diff-check diagnostic capture containing that same marker; it passes. No source,
test assertion, native bytes or captured candidate declaration is waived/normalized.

## Limits and proposal

Accept these three binding corrections as closure of this finite trial only.
Do not promote production or reinterpret this32-parameter pass as superiority,
universal parity, a full gate, current whole-TS acceptance or deployed-service proof.
The first8x4 original/current/candidate/native curl comparison file remains exactly
a1ea25e4e300668dd3e4d1abd2c412aca176eb91166af48b388ab0fd84644604; it was NOT rerun.
Product default0/pipefail141/genuine-write23 versus native writeout0/bodypipe23 remain
distinct. Missing baseline nested returns and product PIPESTATUS stay unavailable;
Darwin/native version/build/dyld limitations remain as originally recorded.
Captured-current source remains August27 12:13:59.628Z–12:14:00.623Z dirty e0aa2d23,
not a current release freeze. Other29 assertions, old authorized three S08/S11 profile
deltas, compiled internal facade and synchronous body collector remain unchanged.

Future SafeJS privileged ownedOutput/consumerClosed/accounted-write/cleanup-hook
facade audit is **NOT DONE and REQUIRED BEFORE PROMOTION**. No live SafeJS work.
Root alone verifies this leaf's actual process exit; this leaf returns normally.
