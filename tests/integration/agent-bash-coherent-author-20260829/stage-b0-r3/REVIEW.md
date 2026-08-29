# B0-r2 independent preexecution review — HOLD

2026-08-29. Source/DATA only. **No actual39, install, product import, build,
compiler, RegexWorker, guest engine, native, network or private execution.**
The hold concerns the proposed owner/capture lifecycle, not a demonstrated product
or workflow failure. Old STOP7dc15196 is unchanged.

## Immutable input and successful admission checks

- Candidate `db6306798211811ffba11e8abaf6d977fcf89768`; B0 preseal11052B,
  SHA256 `9455bdd54775df368c1464ac6c922f753b69bbe4b464bd9bdcfb9a143699b30d`.
- Producer preseal `ab976f5ee31d0a793d6016f13cc46e6960ace2aa`,
  stage-a-r2/PRESEAL.json47291B,
  SHA256 `8acc5e35686a4fa20bf1f8a871b2c23edff4cb29b09a9b9f1848ffc1332006db`.
- Fixture preseal `955e7eb7d7f49feb4cf288fcb58a6ba6125073f0`,
  v4/PRESEAL.json8922B,
  SHA256 `4911f32f621e33adf8cacd0eabbc13b0644586fc3efd36ca42abf3c85765734c`.
  These are distinct objects, not interchangeable locators.
- Accepted Stage-A producer d8524695 package:930368 compressed bytes,
  SHA256 `2fe071e2bfac5ef5c81dc7e475e059091f6add65cd7411dfcfbf0ce7f51f2eca`.
  Independently checked size/hash **before** bounded same-buffer inflation;
  all1014 regular tar members, checksums, modes, lengths and content hashes match.
  Inflated tar5900800B. No archive execution/extraction as source evidence.
- Fresh DATA checks of the retained producer/source package prove1012 actual dist
  files plus2 package metadata files,5130403B. The proposed source-built layout
  copies these actual Stage-A files, not a tar relabel.309 selected source files
  also match size/SHA256/Git blob hashes.16 Node source files remain inherited.
- Whole composition `3adc676a0ab638c9788ef007e465931d65d2c6fe` is a derived
  accepted identity. Published reconstructed-tree bytes authenticate its root and
  changed subtrees; unchanged prior subtrees inherit accepted provenance, not a
  fresh whole-history reconstruction. The309-file projection has a DIFFERENT hash.
  See the preserved helper mistake and correction below.

## Executed controls, not semantic workflows

Control seal `c177ebfb`; CONTROL-PRESEAL SHA256
`f78817321a1f16d12f0a5c95aedce68d2289063c298008fb5bed0b650b732dd5`.
Two sequential permission-restricted Node controllers, both exit0/close observed;
no real child fixtures. Six unchanged author DATA controls pass6/6. Independent
six synthetic families contain9 predicates:3 meet their requirements,6 do not
(four falsy subprobes plus short-write and capture-open). These are not nine
product cases. Actual controller capture was complete and both controllers retired.

| Finding | Exact source / evidence | Minimum repair or decision |
| --- | --- | --- |
| H1 capture acquisition is outside cleanup | stage-a-r2/common.mjs:32 opens stdout then stderr before try at35. I04 injects stderr-open failure: exact error escapes, zero spawn calls, stdout descriptor remains open. Verifier explicitly closes that one injected descriptor. | Own each successful acquisition immediately; close stdout if stderr admission fails. B0 run.mjs:21 must also retire its manager/event descriptor on failure rather than rely on eventual process exit. |
| H2 short capture writes silently succeed | common.mjs:40 ignores fs.writeSync's returned count. I03 injects a1-byte write for input AB: owner returns success, reports captured2, stored bytes are only41(hex). | Complete bounded writes or fail closed on partial progress; count attempted versus actually stored bytes honestly. No claim that this short write occurred in the author actual environment. |
| H3 primary presence uses truthiness | common.mjs:34 and50 use !primary/if(primary); close also uses nullish replacement. I01's0,false,null,undefined error events followed by clean fake exit/close all return success. Nonfalsy Error identity control passes. | Separate presence from value in the owner, or obtain an explicit narrower error-domain decision. This is synthetic event injection, NOT evidence native Node emits non-Error error events. Workflow C17's own presence logic is correct and is not this defect. |
| H4 inclusive outer deadline/publication remains a source gap | bootstrap's60s check covers only its own initial work; run.mjs:8 hashes Node and creates work before supervisor starts at9. The1620s manager ends before RESULT publication at20. No shared absolute1800s deadline covers startup plus publication. json writes and capture closes do not fsync. | Bind a fresh inclusive start/deadline and finite publication/cleanup reserve across the actual owner; make required flush/close policy explicit. No observed overrun or lost durable bytes is claimed, because actual B0 is UNRUN. |

I02 Error identity, I05 synchronous spawn failure and I06 numeric child failure
controls pass, with capture descriptors closed. Synthetic process.kill/spawn never
call OS operations; fake group absence is not OS retirement evidence. The fake
short-write and descriptor observations are isolated from the review's own capture.
No author files were repaired. H1/H2 suffice to withhold activation; H3/H4 also
need explicit resolution against the requested owner/error/clock profile rather
than a universal arbitrary-observer-fault or kernel-quota claim.

## Exact workflow/API mapping — all UNRUN here

The13 IDs are C01–C09,C12,C13,C14,C17, once in each layout =39 prospective calls.
Unchanged v4/workflows.mjs15763B SHA256
`6d8a19854a6e96986013ed3d94ee15dd774e225259dea922bf4749799c60d89b`.

| ID | Frozen assertion purpose |
| --- | --- |
| C01 |80 default names;9 Node root/subpath values equal; Node/curl opt-in82; inert provider and missing-provider rejection. |
| C02 | Strict flags, quoted argument and conditional short circuit; a b newline. |
| C03 | Quoted versus unquoted glob conditions;0 then1. |
| C04 | Indexed array/function nounset path; one newline. |
| C05 | pipefail false-pipeline status1. |
| C06 | pipe-stderr ordering; outerr and empty redirected audit. |
| C07 | Combined redirection followed by stdout override; distinct err/out effects. |
| C08 | source and LET;5 newline. |
| C09 | nounset failure before Node preparation; status1/empty stdout/missing diagnostic/prepare0. |
| C12 | Mock curl cross-origin redirect, second authorization stripped, exact JSON file, two response disposals. |
| C13 | Readonly virtual Git status/rev-parse/ls-files; exact fixture outputs and unchanged Git metadata. |
| C14 | apply_patch pipeline then Git diff; changed README content, unchanged Git metadata; patch diagnostic intentionally not an exact oracle. |
| C17 | Nonasync guard.execute returns EXACT command.invoke Promise; pending cleanup barrier, sink reason0 over cleanup false, prepare0, cleanup before settlement. |

Runner checks public Shell.prototype.exec/dispose function descriptors. It imports
the authenticated package root and exact Node subpath without preparing the real
engine. Workflow finally releases gates and awaits all shell.dispose results;
explicit failed boolean preserves falsy errors. Cleanup failure stops dependents;
ordinary assertion rows aggregate only after cleanup. These are SOURCE conclusions,
not execution results or proof of arbitrary opaque provider cleanup.

## Layout, loader and resource authority

Source-built copies actual retained dist/metadata. One offline scripts-disabled
npm install is proposed with task-owned HOME/config/cache; installed package is
physically renamed for the moved consumer. Full member closure is checked before
and after each layout, including unexpected entries. Dependencies are empty.

Inherited resource/loader bytes match the retained accepted public80 mechanism:
resources SHA256 `ee5d6c8ec02a2784232a04a9ca01e07a232bb8bc36a1d39b8e9f463c0ad49e92`,
loader SHA256 `a16e8d37942478cf9dc876e360cf7e7085c590515bdca82bf90be421df7cf6b3`;
immutable retained-source locator is recorded in LOADER-AUTHORITY.json. Only the
authenticated Regex worker entry with execArgv[] is admitted; max2/layout,6total,
live2. Three --loader admissions are separate fixed internal threads. No PUBLIC95
or Node guest Worker authority. The inherited main-thread loader plus complete
static closure does NOT trace nested worker imports; next() rereads and trusted
owned-file immutability assumptions remain. No new comparator mechanism is needed
or claimed. No unsupported expansion of loader authority was found.

Proposal role limits: one install plus three consumer children; install120s,
layout420s, case30s, cleanup5s;32 known starts/peak3;64MiB capture/768MiB work.
Source manager's generic child ceiling16 is looser than the fixed four-call graph;
the finite graph, not a kernel-wide quota, is the four-child argument. Expected
application Regex count may be zero but is NOT measured. Actual create/exit IDs,
beforeExit live0, three loader admissions, all captures and actual role census
must be reported if a repaired successor receives GO. No internal thread-exit or
unobserved transitive process proof follows from parent closure.

## Preserved history and next authority slots

DERIVED-TREE-HELPER-HOLD.json preserves a reviewer DATA assertion: the309-file
projection c5e49e70 was wrongly compared to the accepted full3adc tree. No target
ran and no child existed. Versioned SOURCE-PROVENANCE-v2.json keeps both hash
domains separate and authenticates the published whole-tree witnesses. It does
not silently replace a missing Git object with HEAD. This ordinary helper error
is not a product integrity failure and is not retroactively a passing assertion.

Before activation: repair/reseal the owner findings, obtain different bounded
review and fresh ROOT actual39 authority, bind exact successor source/preseal/
tools/package and inclusive clock, verify exclusive launch capture and absent
work root, then use only the approved role graph. Current rootRuntimeAuthorization
is false; no actual launch/approval slot was exercised by this review. An environment
GO string is an admission convention, not independent authentication of ROOT intent.

Larger726/retained/type/mutant obligations, ALL50 Unit2 identities/layout and the
five PUBLIC95 workflows C10/C11/C15/C16/C18 remain later and UNRUN. Neither these
DATA controls nor future39 success establishes coherent acceptance or native parity.
