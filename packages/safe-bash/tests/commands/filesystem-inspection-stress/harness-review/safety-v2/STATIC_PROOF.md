# Candidate two-row correction proof — independent review pending

This is additive preparation after the authorized original run, not a new
independent input claim. Original inputs, six-row seal, invalidated proofs and
four actual results remain unchanged. No derived product invocation has run.
Candidate source is `436bda3e21b2b6041409fac7408cf072b5d3fe5e`; files were read
from the hash-verified isolated snapshot, not live source. The separate proof
leaf must review this correction before root authorizes either child.

## DP: same pattern and64 names; budget4096 becomes16384

Frozen `src/commands/tree/pattern.ts:6` charges compile scan/encoding/parser work
18+18+17=53. Root lstat/readdir add2, giving55 startup. The17-token pattern
contains eight `*a` pairs then `z`; every sealed128-byte name ends `q`. There is
no suffix elimination or token short-circuit. Each filter reserves one alternative,
129 initial cells, and17 times258 (row initialization plus transitions) before
the corresponding allocations:1+129+4386=4516. Listing costs another1.

- Complete singleton including its eventual child stat:55+4517+1=4573.
- Three complete filters:55+3*4517=13606; below16384.
- Four complete filters would demand55+4*4517=18123; above16384.
- Fourth listing/alternative/initial row:13606+1+1+129=13737.
- Fourth filter token10 leaves16317; token11 requests258, giving16575 and
  failing before that row allocation. These are budget reservation units,
  not measured CPU instructions, executed work beyond the cap, or RSS.

`src/commands/tree/tree.ts:101` iterates the listing and performs exclusion
matching at111; candidate sorting starts only at114 after iterator exhaustion.
`io.ts:47` keeps one WalkBudget counter and throws before over-cap admitted work.
The derived VFS keeps the same Array, entries, order, types and options, but
wraps its iterator to record returned names, next/done/return observations.
The DP oracle requires exactly the first4 names, next4, yielded4, done=false,
return1, and only root lstat/readdir. Together with the frozen control flow,
this identifies fourth-filter failure before sorting, not a later-sort false
positive. A per-entry-reset implementation that reaches sorting yields all64
names and is rejected even if it emits the same work-limit diagnostic there.
The trace does not measure DP tokens or budget counters; the static proof
provides those numbers. No product internals are monkeypatched or instrumented.

Array iterator return is normally absent; the wrapper adds a bounded no-resource
return observation for early-loop closure and returns done=true. It neither
injects nor swallows a product failure. This telemetry-only contract difference
is disclosed, testable with pure mocks, and must be independently reviewed.

## Sort: original input and4096 budget unchanged

Root calls2 plus64 listing steps leave66. Names are512 bytes and share at least
510 initial bytes. `tree.ts:114-117` reserves1+512+512=1025 before Buffer.compare.
Three comparisons leave3141; the fourth demands4166 and fails before comparison,
child stat or stdout. At least63 comparisons are necessary to fully order64
distinct unknown keys; this is not an assertion about an exact engine count.
The byte-span reservation covers input span lengths, not claimed exact bytes
touched by Buffer.compare. `tree.ts:128-131` independently meters dirsfirst
comparisons by1 over already-observed directory classifications on the same
budget. The low-cap row does not reach that second pass; its coverage is static.

The sort oracle requires all64 original names in order, next65, yielded64,
done=true, return0, and only root lstat/readdir. Combined with the source proof
and work-specific diagnostic, this places failure after filtering and before
child inspection. The trace alone is not a comparator counter or full safety
proof. No changed fixture, timing assertion, synthetic comparator charge or
broader sort corpus is introduced.

## Actual Shell oracle correction

`tree/io.ts:7-10` constructs EFBIG with a tree work-limit message.
`shell/runtime.ts:494-512` handles the command failure, emits a human diagnostic
and returns status1. `shell/shell.ts:179-188` resolves the ShellResult. This is
not an outer rejected promise with empty stderr. The derived predicate requires
resolved status1, empty stdout, bounded single-line relevant tree work diagnostic
with the correct cap, actual Shell dispatch, disposed shell, exactly one command,
no mutation/unhandled rejection, valid byte accounting and the phase trace.
It accepts the documented Shell/errno prefixes without treating status-only,
arbitrary nonempty text, another quota, wrong cap or unrelated text as success.
The internal EFBIG is statically traced; it is not manufactured on the report.

## Execution and evidence gates

Only two IDs exist in the derived seal. The runner cannot loop over the four
prior valid rows. A fixed exclusive execution claim is acquired before the
first fork; rerunning with another output path cannot silently repeat children.
Each child still allows one command, the parent at most2 children, and verified
prior evidence records4 starts. Total maximum is6, no retries. The five-second
child watchdog,30-second batch cap,128MiB heap,256MiB observed-RSS stop and64KiB
capture cap are unchanged; cooperative RSS sampling is not a hard memory limit.
No new product worker/session/lifecycle API is used. Existing parent stop/finally
and child Shell dispose paths are retained, with original child bytes identical.

Root must provide a separate two-row authorization binding this seal/runtime,
the original approved hash/snapshot, exact previous-run summary, reviewed proof
report hash, and approved proof fields. The proposal remains PENDING_ROOT and
its proof statuses PENDING_INDEPENDENT_REVIEW. Four prior results are reused by
hash, not rerun. A failed/partial future child remains failed/unknown, never an
implicit pass. This document and mock checks are not execution permission.
