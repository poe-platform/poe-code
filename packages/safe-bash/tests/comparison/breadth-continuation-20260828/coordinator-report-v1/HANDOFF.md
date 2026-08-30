# Two distinct scopes: diagnosis and report repair

## 1. Source/artifact-only diagnosis

Commit `096c204c38fd7f1b6c096b9cb09e0ea877737fec`:
`../builtin-bootstrap-diagnosis-v1/README.md` and OBSERVATIONS.json.

Pinned just-bash 3.4.2 bundle index hash
`70dd1320d921b736e965b1545e50ab57af2b2807a26de7fa624d4f519a953b7c`,
line808 / zero-based UTF-8 offset503554, conditionally calls the captured
getBuiltinModule function with `module`. The Module/default result only feeds
the unused local Mf (three occurrences: declaration, assignment, catch reset).
The following worker_threads query only reaches crypto.randomUUID if
isMainThread is strictly false. The first thrown denial is caught; this explains
why V6 still observed export/factory completion while correctly rejecting the
recorded violation. This is source inference plus retained receipt, no rerun.

Proposal for root adjudication, NOT implemented: a temporary, ordered,
authenticated-import-only **unavailable-feature** profile returning undefined
for literal module then worker_threads, with no native API delegation and no
returned Node capability. Close before factory/setup/workflow; deny aliases,
repeats, crypto, unexpected order/names and later access. It avoids the fallback
branch and returns no raw Module/_load/_compile/createRequire/cache/native/
network/process objects. Alternative: retain current admission HOLD.
Existing raw node:module import/CJS private surfaces are not newly certified as
sandbox-safe. Detailed static guard limits and primary documentation qualifiers
are retained in the diagnosis; future deferred command chunks are uninspected.

## 2. Presealed report candidate and actual controls

Candidate `4d5d28b62c3253a613fd19cde11d7f2df0f98b1d`.
SEAL SHA256 `2b1dfbf24d2251a1b2edf4617a97d737c21bfd99cfcb9115c1b2423eaacee3b4`.
OVERLAY.json binds exact changes to three frozen V6 source files without applying
them. Executable publisher/record-store functions and matching reader adapters
replace large terminal dumps with small summaries and authenticated multipart
documents. Per-record262144 and store-cumulative268435456 remain; a declared
conservative32MiB logical-document refusal cap is new, not a limit increase.

One synthetic-only invocation: **16/16 families, zero failures/unruns**; three
exact overlay applications checked as data. Four actual stub children plus the
controls driver closed and had absent PID/groups. Dispositions: positive exit0;
all-PASS summary with exit7 correctly rejected; injected stdout failure produced
bounded stderr and exit1; final stub exited0 before intentionally failed receipt
persistence, with PID/group/closure and emergency receipt retained. No real
engine import, denied builtin invocation, module initialization, old captured-tail
replay, semantic workflow, native command or builtin-policy implementation.

Controls cover large primary/cleanup retention, null/undefined primary plus later
faults, serialization/oversize, partial persistence, cumulative-quota refusal,
reference/hash/path/mode/missing guards, finite output failure and closure.
No nonzero process is a positive admission pass. All 22 sealed inputs and Node
tool binding remained unchanged before/after. Node heap is not RSS.

EVIDENCE.json SHA256
`3940176c2494cb305e4a9d46084695a5eca49ac93b648459de4380f384a6a07e`.
Raw archive SHA256
`c19a60edf107ea6444636724591a6607bbd1aeb791d1a24b065f7616e84dfe4d`:
25740 compressed bytes, 39 exact raw members / 2433183 raw bytes, round-trip
verified. Every generated artifact is <=262144 except the explicitly rejected
262145-byte R10 INPUT fixture; it is not a qualified output record. The original
local files remain present and unmodified; compact archive retains their bytes.

## Original failures and remaining blockers

V6 RESULT is **531954 bytes**, above262144. STAGED979544, comparator config685153
and receipts318162/317978 also exceed that per-artifact size. Worker FD3 channels
were within their cumulative262144 limit; this does not qualify oversized JSON
files. V6 coordinator stdout remains359581 observed /65536 prefix retained /
**294045 IRRECOVERABLE**. No reconstruction from RESULT and no old rescore.

This packet is not a full successor admission recipe or production authority
proof. Root must adjudicate the separate builtin proposal. Different review must
assess the report delta; future integration must reseal readers/worker/auth
interfaces, account out-of-store evidence (including operation claims), and
qualify exceptions outside the existing coordinator report-tail boundary.
Actual new engine composition remains unexecuted. No fresh runtime grant exists.
V4/V5/V6 history, W07 UNQUALIFIED/UNCREDITED and unauthorized99-semantic scope
remain unchanged. No private/product/config/instruction writes or native chmod.
