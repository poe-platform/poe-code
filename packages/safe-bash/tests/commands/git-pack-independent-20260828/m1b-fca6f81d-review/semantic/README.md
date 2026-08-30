# Independent M1B semantic component

Status: Concrete component authored and sealed; all actual execution UNRUN
Implemented Through: Not applicable — no target/helper/compiler execution
Date: Friday, August 28, 2026

This is the stock semantic component for candidate
`fca6f81d2d96db2bbceabf3247cd57ffe240bde6`, evidence
`897e5141b034b59501f576a259d5ea1e7e2673c6`, selected derived tree
`23074ef0c443ca618c4f26204b5f3d2274b86895`. Full910 package SHA256 is
`cc0e75c2d0d12f713f0458e608ddeae157cf3432b4e0b48277a329a98115aa1a`.
It is not product implementation, root integration, native parity, acceptance,
or a standalone GO. Runner composition and root routing precede the one actual
review. No YQ, XAN, rebind, old packet or product files are changed.

## Interface and execution closure

The exact committed ABI is `de95161c9de136852884d054612dad1b8ec716e5`,
`runner/INTERFACE.{md,json}`. `semantic.mjs` exports
`async runCase(api, caseId)` and uses only `api.load`, `capture`, `captureBytes`,
`check`, `registerCleanup`, identity fields and the supplied signal. It has no
CLI, spawn, compiler, network, timer, installation or environment-discovery path.

`CASES.json` follows the exact `m1b-cases-v1` field set. `BATCHES.json` is the
mandatory bounded scheduling input; do not turn208 case records into208 children.
Root admits every active component file, all282 selected source inputs, tools,
the complete910 package including exact README, and actual import closure before
loading this entry. An author global tree/live HEAD is never source authority.

Local imports are `./fixtures.mjs`, `node:fs/promises`, `node:crypto`, `node:zlib`.
The only host data reads are the two same-directory, freshly regular0644,
size/hash-bound JSON files. They travel with the copied component, not live CWD.
Candidate loading uses exactly these root-authorized direct compiled paths:

- `dist/commands/git/index.js`: actual `createGitCommand` and `gitCommands`.
- `dist/fs/memory/index.js`: actual `MemoryFileSystem` for explicit virtual state.
- `dist/shell/shell.js`: actual `Shell` for the original workflow argv.

Their transitive compiled dependencies and pinned Node builtins are runner-owned
closure obligations. This leaf never imports a product module directly, from TS,
ambient node_modules, workspace fallback, a private engine or a native Git tool.
The candidate still has **PUBLIC_EXPORT_GAP**: direct installed module access is
not proof of a root Git export or `virtual-bash/commands/git` admission.

## Concrete data and assertions

`FROZEN-DATA.json` copies exact raw pack/index bytes from13 authenticated neutral
packs and the original loose VFS files. It retains the six original workflow
argv/status/stdout values. Only the declared eleven loose-object paths are
removed for P01/P02 packed workflows. Other files, expected bytes and virtual
modes are preserved. Virtual fixture modes are requirements, not retrospective
host-POSIX attestations. These source fixtures are DATA, not inherited passes.

`CASE-DATA.json` freezes104 selected cases and literal expected status/stdout/
stderr bytes, actor choices and deterministic new envelope descriptors. Expected
payloads come from frozen data or explicit independent fixture literals, never
from the candidate. There is no regex diagnostic waiver or golden update.
`fixtures.mjs` contains the real bounded independent encoder: pack headers,
size/OFS encodings, idx2 fanout/OID/CRC/offset tables, SHA layers and declared
mutations. It does not call product parsing or reconstruction helpers.

The encoder has **not run**. New fixture bytes are generated only inside the one
shared actual review, under the case/batch/global deadline and authenticated
descriptor/helper/Node identities. Raw pack/index hashes and construction facts
are durably captured before candidate loading. A helper failure is a harness
integrity/setup failure, not a product failure or format success. No fixture
generation, standalone synthetic cohort or data-check retry is authorized here.

CRC header/base-prefix controls keep the pre-mutation record CRC and recompute
outer pack/index hashes. CRC-field, OID, delta, cycle, type, dictionary and zlib
record-suffix cases keep their relevant outer authentication valid. Exact
candidate diagnostics distinguish the intended failing stage from an earlier
envelope refusal. Fifty-six negative cases first execute a real pristine command
control in a different fresh MemoryFS, with its own raw/assertions. A failed
control leaves the variant UNRUN, not falsely killed or passed.

`semantic.mjs` implements the actual assertion bodies. Each leg enrolls one
idempotent cleanup callback before acquisition, creates fresh FS/context/Shell
state, captures fixture and before namespace, and invokes the real command or
Shell/plugin. Output chunks are copied before producer advance and durably
captured with acknowledgement; complete stdout/stderr and actual outcome facts
are captured before assertions. Owned cooperative cleanup finishes before the
after namespace and final assertion phase. Cleanup is included in every cap.

Assertions cover rejection presence, exact status or actual local reason identity,
exact stdout/stderr bytes, complete VFS entry path/type/mode/file-length/hash
effects, no unexpected stdin consumption, owned fixture cleanup, reached actors,
borrowed-row finalization, sidecar no-body-read, and Shell text/byte projections.
Primitive contradictions remain raw evidence and all applicable checks are
submitted; later namespace/output checks do not replace status checks.

Cross-realm result validation uses exact own-data keys/order and primitive types,
not prototype identity. Byte validation uses intrinsic typed-array brand/getters
and exact finite indexed own data, then copies. Actual thrown values, including
null/undefined, stay local until identity facts are computed. Serialized reason
descriptions do not claim cross-process identity; unknown messages/codes are not
whitelisted. The new borrowed producer uses `Uint8Array.set`, never Buffer.copy.

Namespace evidence is path/type/mode/length/hash, not timestamp preservation.
Observation reads can change atime. The declared sidecar-body actor changes its
own one-byte fixture while returning the same observed stat; expected after bytes
explicitly record that actor effect. It is not a product write or proof that lstat
authenticates body bytes. There is no atomic snapshot, ABA or lease guarantee.

All uncaught semantic-entry exceptions are setup/integrity/capture/schema/owned
cleanup failures requiring **unsafe STOP**; actual command throws are caught,
persisted and checked inside the leg. Root must preserve that distinction from
its own sticky ordinary assertion failures. A failed assertion ends the worker
batch, with later members UNRUN; safe continuation is only to a different sealed
batch after fresh guards and known retirement. No case is retried. Any actual
nonzero child remains aggregate FAIL regardless of receipts.

## Counts and fixed costs

| Item | Exact declared maximum |
| --- | ---: |
| Unique selected stock cases |104|
| Source S / physically moved M case records |208|
| In-case pristine controls per profile |56|
| Command invocations if every case/control reached |160/profile;320 total|
| Shell workflow invocations |36 total:12 loose,24 P01/P02 packed|
| Explicit selected M1A compatibility cases |13/profile, overlapping workflow/A10 roles|
| Runner-owned semantic batch children |18; no nested leaf children|
| Cases per batch |Eight batches of12 plus one of8, per profile|
| Shared batch wall incl setup/capture/cleanup |30000ms, not30s per case|
| Maximum semantic contribution to global wall |540000ms; no new allocation/forecast|
| Shared control+variant capture per case |524288 bytes;104MiB sum across208 records|
| Work ceiling per case |2097152 bytes;416MiB sum, not RSS|
| Generated fixture files |<=80 and524288 total bytes per leg|

Further finite encoder/output/event/cleanup caps are in BATCHES. There are zero
host fixture writes by the leaf: it uses MemoryFS and parent-owned raw capture.
No own timer or deadline reset exists. S is independently source-built by the
runner; M is the full offline installed package physically moved before calls.
Installed-unmoved is runner admission/movement-origin only, not a third cohort.
Root still must reconcile this allocation with all mechanical/compiler/build/
setup/guard children under168 total starts, peak4,120min single-origin wall,
256MiB capture and1GiB working. Do not silently drop cases to make it fit.

## Coverage and honest gaps

`COVERAGE.json` maps every original GFP-01–GFP-38 and B01–B12 to selected case IDs,
and separately names unselected/SOURCE_ONLY/mechanical obligations. Every actual
state remains UNRUN. Row mappings and encoder success are not runtime passes.
This is not the old116-variant proposal, all108 resource variants, full Git, all
140 M1A records, a native suite, or a new numeric policy.

Ratified24 limits, D1 eager bounded strict profile, D2 metadata-only finite
sidecars, D3 invocation pin/no eviction, F01 minimum4 and F02 exact idx extent
remain unchanged. Empty direct objects, padded four-byte zero-result deltas,
two/three-byte refusals and P11 small-indirect positive are distinct. Unreachable
public maxima/unsafe arithmetic, unselected slot/truncation neighbors, forced
global-OID/deep-location ordering and native codec lifetime require their own
source/mechanical dispositions, never lower caps or counter injection here.

H09's289/288 notifications are not a demonstrated leak. Reader fixture counters
and actual Shell/registered cleanup do not prove codec callbacks, handles, caller
origin or native quiescence. Historical v8/pilot is not this M1B proof. S02 may
surface as a genuine unexpected writer/reader error in the stock cases; its
presence, actual reason facts and exact output remain failure evidence, not
suppressed noise or an invented error allowance. Mechanical owns qualification.

The preserved source report4db76948 and original author663/12,699 and new744 data
are not rescored. Exact REVISION-v2/3db9973c context was inspected: nine old A10
category assertions failed despite128/empty stdout, and three Buffer.copy calls
were fixture defects on Uint8Array. Current tests bind current exact diagnostics;
the old captures/assertions stay unchanged. No separate attribution addendum was
found in the bounded author-path inspection; this packet does not manufacture one.

## Preparation verification

Only Git/source/data reads, JSON metadata inspection, exact hashing and static
import review occur here. No authored module import, fixture encoder run, syntax
child, compiler, product, old checker, native Git oracle or network execution is
claimed. Source lookup misses are disclosed in BINDINGS. The skill-guided report
does not introduce a second normative product specification or run a checker.
Different review and runner's complete committed assembly precede activation.
