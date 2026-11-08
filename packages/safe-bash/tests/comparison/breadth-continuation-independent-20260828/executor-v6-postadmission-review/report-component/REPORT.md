# Independent BODY/DATA/SYNTHETIC report-component review

August 28, 2026. **Component findings only; not admission-ready and no overall
GO.** Candidate `4d5d28b62c3253a613fd19cde11d7f2df0f98b1d`, immutable handoff
`4c11bfa9431508e050613287e035b756e7ec4f1d`. No author/product/history edits.

## Exact results and preserved correction

**20 distinct predeclared cases: 18 qualified passes, 2 reproduced component
assessor defects, 0 unrun.** These are independent results, not the author's
16/16 synthetic families and not semantic/admission credit.

- Original harness/preseal: `2d44ae1a`. One invocation reported raw19PASS/1FAIL,
  preserved in `e7e8b5f4`, ORIGINAL-EVIDENCE.json and original-raw.json.gz.
- D13 failed. Original S20 got the intended65537/65536 overflow but the child
  died by SIGTERM, not exit0; the harness missed that precondition assertion.
  Its raw PASS is **not** credited: original qualified audit18PASS/1FAIL/
  1unqualified fixture, with original bytes/counts retained unchanged.
- Correction preseal `5195d90f` changed only the independent S20 fixture's
  keepalive lifecycle, added explicit precondition observations, and retained
  the same expectation. One additional child achieved all12 prerequisites,
  including actual exit0/close0, and failed assessor correctness. No rebaseline,
  weaker replacement model, repeated successful cohort, or seventh child.
- All-PASS/exit7 was actually supervised and rejected. Fatal0/null/undefined,
  write-plus-close reasons, serialization bounds, cumulative quotas, partial
  publication, reader guards and known-child persistence failure are exercised.

## Defect 1: capture-limit receipt incorrectly accepted (corrected S20)

`coordinator-report-v1/publisher.mjs:56` through the return expression at62:
SHA256 `84a4c2c18ed566e1bfcc90374561550ea9473e4c873c23326018cef7befb4ab2`.

The actual candidate publisher emits an authenticated accepted result and
bounded terminal. The independent stub appends spaces to make65537 stdout
bytes. Actual inherited supervisor records CAPTURE_LIMIT, retains65536 bytes,
sends SIGTERM, and records the corrected stub's graceful exit0/close0. Its
actual receipt has `failures:[{code:'CAPTURE_LIMIT'}]`, `signals:['SIGTERM']`,
`natural:false`, `captureBytes.stdout:65537`, empty stderr and reaped:true.
Decoded stdout is the original valid terminal plus padding. No exit, signal,
failure or byte-count field is synthesized or replaced.

**Expected `assessTerminal(...) === false`; actual `true`.** It checks retained
stdout length but not observed bytes, supervisor failures, sent signals or
natural disposition. This is a reproduced false acceptance at the component's
assessor boundary, not proof that old V6 admitted anything. Exact receipt and
all preconditions are in corrected-raw.json.gz, `EVIDENCE.json` and RECEIPT.json.
The one omitted byte remains unavailable in capture evidence even though this
fixture's generator is known; logical generator knowledge is not retained data.

Relevant inherited source: `executor-v4/supervisor.mjs:36` through40 observes
and caps separate quantities;63 computes natural via actual settled predicate.
SHA256 `42d220fd43f165c0d100a61ef55d29bddd87577f7cafe929c832f33cd80dc069`.
`executor-v4/safety.mjs:37` through38 rejects failures/signals/nonzero exits;
SHA256 `74849abb4e28b012ec8cddb729d1bae02cbde253291b3e2f2bb070457b7e66a2`.

## Defect 2: malformed terminal escapes boolean assessment (D13)

Same publisher hash; `publisher.mjs:62` dereferences `row.failures.length`
outside the parse/reference catch blocks. Starting from an actual successful
publish and unchanged authenticated RESULT, the bounded DATA case removes
only the terminal failures member. **Expected false; actual TypeError:
"Cannot read properties of undefined (reading 'length')".** Original raw
archive retains D13/MALFORMED-TERMINAL.json, D13/OBSERVATION.json, RESULT and
the assertion stack. No candidate fix is made. This is assessor malformed-input
robustness, not a successfully accepted malformed report or engine execution.

## Allocation, publication and accounting qualifications

`coordinator-report-v1/records.mjs` SHA256
`3bb80efc9a5d150b0bff6b298f33c6dd11aed24faf7f10e23bb4329a939675dc`:

-11-65 bounds logical serialized UTF-8 including newline, not input object
  allocation, peak heap or RSS.44-45 and54 enumerate descriptors/values/entries
  before all recursive visit checks.65 retains fragments, joins a string and
  creates a Buffer. Arbitrarily wide host objects are not preallocation-bounded
  by the byte/node refusal limits; only a safe1000-key/small-cap probe ran.
-115-152 bounds/authenticates physical input records and logical size but
  retains chunks plus concatenation plus JSON parse materialization. A32MiB
  logical cap does not imply32MiB memory. No pressure test or32MiB successful
  serialization was attempted; the one33554433-character ASCII input was
  refused by the length check before serialization/record acquisition.
-74-110 charges attempted writes including failed opens and descriptor bytes.
  Multipart descriptor-last publication is not transactional or crash-durable.
  D09 intentionally leaves complete parts and a one-byte malformed descriptor;
  no successful reference is returned. This is expected failure retention,
  not a newly invented atomic rollback guarantee.
-68-73 accounts per store instance, excluding existing/out-of-store files and
  other stores. D14 shows128 external bytes plus two5-byte records: physical138,
  each store accounted5. This demonstrates the explicitly unfinished whole-run
  accounting duty, not a defect against the advertised one-store contract.
- The conservative independent generated-input upper bound is36,650,454 bytes
  across original and correction, below64MiB and40MiB. It includes a1MiB reserve
  for small inputs; serialization copies and captured output are not newly
  generated input. Both launchers and all six children use128MiB old-space,
  which is not an RSS limit. Independent artifact records are all<=262144.

## Pre-report, tail and enrollment review

`executor-v6/coordinator.mjs` SHA256
`87a590e7233d742aa992471fe22ea70061640b9dbe05b876d68ad81895fc37a4`:

-15-26 top-level reads/authentication,31-43 authorization/lock/run creation,
  and54 initial authorization publication precede the94-141 workflow catch.
  The unapplied overlay only substitutes the final publisher/store/readers;
  it does not contain exceptions from this earlier boundary.
-142-149 tail/accounting/status construction is also outside that catch.
  The schedule.rows use at143 is narrower than rows??executions at122; the
  fallback representation is a latent source-qualified throw path, not an
  observed fault in the frozen schedule. No actual coordinator was executed.
-68-75 pre-launch checks precede enrollment but perform no child acquisition.
  Actual launchTracked enrolls before prepare, marks starting, and passes an
  attachment callback into supervise. Supervisor spawns then attaches before
  installing listeners. The known-child failed-persist path is exercised and
  retains closure; arbitrary spawn/callback/event races are not certified.
-42 writes the authority lock directly. Worker36 and synthetic-worker31 write
  operation claims directly. Projection delegates to executor-v5 view writes
  outside the record store. Whole-run evidence versus staged-package byte
  classification and budgets must be explicit; neither silently excluding
  these files nor charging every stage byte as evidence is justified here.

Publisher25-34 itself performs summary/row/child preparation outside its local
publication catches. Inherited FD3 transport serializes before its cumulative
byte check. These unchanged/source-qualified boundaries require successor
integration qualification; they are not silently omitted from this component
review or presented as newly reproduced component failures. Details are in
PREEXECUTION-BODY.md; its clock-cleanup source pointer58 is corrected here to
`executor-v4/supervisor.mjs:57` (58 starts base64 result construction).

## Authentication and closure

Before/after checks cover71 exact inputs, seven original harness files,55-member
author component membership (including detection of new entries), pinned Node
bytes/mode/hash, and seven correction bindings. Original author39-member raw
archive was inspected in memory and matched local bytes without extraction.
Some historical raw V6 files are authenticated by their hashes in committed
SEAL metadata, not falsely described as directly tracked candidate blobs.
Selected inherited-file checks do not establish an append-proof repository.

Exact child PIDs: original driver37844(exit1 for D13), positive37858(exit0),
all-PASS37862(exit7), stdout-failure37866(exit1), original overflow37871(SIGTERM),
corrected overflow40142(exit0). All have exit+close, absent PID/process-group
and reaped evidence. Parent/driver resource observations are empty after
settlement; corrected stub reports its exact interval retired and no active
resources. No subprocess/driver remains active. The standard CLI launchers
also completed; six denotes supervised children, not a claim that only six
Node OS processes were used including both launcher hosts.

## Remaining requirements

1. Repair and independently requalify both assessor defects; do not bypass
   supervisor disposition/observed-byte checks or let malformed assessment
   throw outside the full-recipe reporting boundary.
2. Integrate and reseal actual coordinator, multipart readers, workers,
   authorization and recipe interfaces; qualify the actual resulting source,
   not merely the unapplied overlay or these stubs.
3. Provide aggregate evidence accounting, explicit classification of locks,
   claims, all receipts and staged/resource bytes, including partial failures.
4. Qualify pre-report/tail exceptions and acquired-child enrollment/cleanup in
   the full successor, not just publisher entry or known closed stubs.
5. Obtain separate source-policy/builtin adjudication and a fresh explicit
   root grant before any actual engine composition/admission. None is issued.

Original V6 remains UNSAFE_STOP3/14, zero C11/semantic, denied comparator builtin
and consumed5ac29 grant;359581 observed/65536 retained/294045 irrecoverable
stdout,531954-byte RESULT and four oversized artifacts are unchanged. W07 and
all original scores remain unchanged. No engines/comparator, staging, native
oracle, network/install, private/XAN action, historical replay or policy change.
