# M1B selected executor v2 integration contract

Status: Implemented source; actual execution UNRUN; different final-source qualification pending
Implemented Through: Exact source commit in the versioned source/final seal
Purpose: Integrate only root-selected corrections without changing candidate or policy.
Date: August 28, 2026

## Authority and projection

The immutable31de2aad/a3021720 HOLD and old protocols remain history. The active
assembly MUST select exact stored source commit/blob/path and current regular
mode/size/SHA256 for every executable and data input. The mode-only postimage
maps semantic-mode-v3/semantic.mjs to semantic/semantic.mjs. No sibling-directory
scan supplies authority. Only the fresh execution projection and worker projection
are complete guarded trees; every added file/directory, mode or hash change there
MUST fail. Unselected source/review/history siblings neither enter nor veto them.

Tree inventories use relative POSIX UTF8 path bytes and component-byte-sorted
preorder, shared by inventory and guard. File-only package maps use full-path
UTF8 byte order, shared by selectedFileMap and the frozen package map. Git tree
preimages retain Git's own canonical tree ordering; these are distinct declared
formats, never compared through locale or C-quoted names.

## Worker and tool ABI

runCase(api,caseId) and api.compile(fixtureId) retain their call shapes. The latter
now returns the exact m1b-type-api-result-v2 object, not a fake CLI exit record.
Five unchanged templates use absolute filesystem .js import specifiers. Parent
owns ten separate normal unmodified TypeScript compiler-API children, exact
request roots/options/tools, stdout/stderr and real process status. Compiler
negative diagnostics are data; any worker nonzero remains aggregate FAIL.
Raw/result files are pre-reserved, published by the worker before its predicate,
then authenticated and adopted into parent evidence before parent/adapter checks.
Their original publication paths and final evidence references are both retained.
One separate exact248-file type-tool copy is charged139136382 bytes, not per case.

api.check is sticky and nonthrowing for a valid false assertion. All raw capture,
registered cooperative cleanup, candidate/harness/control/case namespace guards
and the same shared30s deadline MUST complete before the parent ACK permits the
next independent case. Case cleanup is not process reap. Batch nonzero remains
FAIL, with known final reap before another worker or any mutation/restoration.
Escaping actor/fixture/schema/capture/integrity/abort/unknown cleanup is unsafeSTOP.

JSON capture serializes fresh finite own-data, then sends49152-byte UTF8 fragments
with encoding json-utf8-fragment. The ordered raw frames concatenate into exact
JSON bytes for that label. Each IPC request is at most131072 bytes; a compiler-API
reply is at most589824 bytes and its result at most524288. No inherited toJSON or
accessor is evaluated by own-data projection. Thrown reason identity stays local
to each worker; cross-process facts are not object-identity proof.

## Loaded controls and layouts

S is independently compiled then projected to full910 package bytes from that
build plus authenticated package.json/README. M is full910 offline-installed,
then physically moved. Installed-unmoved is admission origin only, not a third
semantic cohort or public Git integration. All root and directory modes are
explicit, including type subject0755 and per-case0700 inputs.

The nine added IDs produce18 S/M calls in14 shared30s batches. Each mutant requires
its own same-layout stock PASS, exact enrolled body and actual pack.js loader
trace. Restoration writes original bytes into the SAME isolated mutated root
only after known prior worker reap, then uses a fresh worker/loader. Safe mutant
contradiction still permits restoration; no hash/import/deadline denial earns
kill credit. The six prior loaded calls retain their original actors; their
restoration paths likewise use the corresponding same isolated root.

## Startup, time, capture and failure

outer.mjs establishes exclusive owned raw startup files before route/source
admission or coordinator launch. Root supplies the unique capture root and one
same-host monotonic origin before starting it. Root's invocation channel MUST
also preserve bootstrap acquisition errors, bounded64KiB per outer stdout/stderr;
that allowance is inside the4MiB outer reserve, not added to it. Storage failure
cannot promise durable bytes on an unavailable device. The outer alone owns its
coordinator child and records every nested start/close; no foreign process kill.
Unknown retirement remains FAIL/STOP, not a claim of escaped-descendant detection.

The parent MUST check outgoing phase time before entering the next phase. A
batch deadline starts before preparation and bounds setup, cases, guards,
publication and cleanup. Observed close and post-close capture/receipt lateness
are explicit failures even when timer delivery was delayed. One7200000ms origin,
168all-nesting children, peak4,256MiB capture and1GiB live logical working caps are
unchanged. COSTS.json derives65processes including outer and244MiB capture.
No hard RSS, opaque-host preemption, extra allowance, reset or retry is promised.

## Qualification

RS-F01/02/03 and the mode/transport/ordinary-continuation changes are source fixes,
not executed counterexamples or independent acceptance. Type source review is
bound separately. All candidate/build/npm/type/control/loader/mutant execution
remains UNRUN. H09 observer remains UNQUALIFIED; S02 SOURCE_CONCERN remains honest
and does not block otherwise admitted stock cases.108resource mappings are not
108runtime passes. Root routes the one review only after the complete preseal
and different-source findings are resolved; this author does not launch it.
