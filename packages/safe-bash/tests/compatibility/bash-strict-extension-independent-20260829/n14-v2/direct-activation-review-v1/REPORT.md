# Final activation wiring: source/DATA HOLD

2026-08-29. Mechanism acceptance is separately sealed in
f690495782aef9b7d354e2612c6768cc2251403a (new6+4+8 cohort, authorized peak4).
This final-wiring phase performs **no helper/product/compiler/build/native
execution**. Its conclusion is **HOLD for the source-supported F01 below**;
do not populate the independent acceptance template or launch111 calls yet.

## Immutable packet and successful binding checks

- Source: faebb8dc019a6920f56c47b7d48c2c8036b8f5f6.
- Evidence: b38463b727373e11261f05a43b580f6012112baf.
- Executable seal:254e4d2bf3f12583c625b627b9230829f839745fb490abb8421b47d0fdc73781.
- All30 sealed files matched regular-file type, exact length and raw SHA256.
  All17 `profile/` copies match the qualified46466683 files byte-for-byte.
- The293 selected rows match the accepted SOURCE.json path/mode/size/hash
  inventory.954 shipping rows and247 compiler/type tool descriptors are bound.
  No derived `bf:path` lookup, archive inflation or capsule decoding occurred.
- Independently reconstructed all111 serialized role objects from the source
  recipe and matrix: exact byte counts/SHA256, program hashes, argv, env, cwd and
  executable match COMMAND-PLAN. These are DATA checks, not111 runtime passes.
- Current packet/work/capture/home/tmp/empty-path directories are physical,
  nonsymlink directories. Work has only PREPROVISIONED.json and the four expected
  directories; capture/home/tmp/empty-path are empty. Future generated apps and
  installed/moved files do not exist yet and gain no acceptance from these checks.
- Both templates match their committed source and remain PENDING. All raw input
  and reconstructed binding evidence is retained in this review directory.

## F01: secondary final census can replace the primary failure

Exact source: `virtual-comparison-direct-activation-v1/supervisor.mjs`,
SHA256 aee84c8dc73dce7182ef6483dc5c757ccb5610b71e5d8cc9e96cf82f94623099.

Line88 catches the operational failure and stores `primaryPresent=true; primary=reason`.
Line89 then constructs `result` with `sampledWork:census(work,536870912)` **outside
that try/catch**, before the guarded terminal publication on line90.
`packet-io.mjs:4` makes census explicitly fallible: entry/byte/symlink/type limits
and filesystem enumeration/stat failures can throw.

Consequently, an earlier operational failure followed by a census failure causes
`run()` to reject the latter before returning or publishing the stored primary.
`outer.mjs:34–37` receives only that latter rejection. The earlier captured reason
is not carried as primary or secondary in the terminal receipt. For example,
a typecheck/launch failure followed by a final census filesystem error takes
this exact source path. This is a language/source-supported conditional path,
**not a newly executed disk/permission/product failure** or a claim that it has
already occurred. It does not affect the qualified464 mechanism controls.

Smallest author correction: guard final census independently; retain its failure
as secondary when `primaryPresent` is already true, otherwise establish it as
primary; represent an unavailable sample explicitly and still attempt terminal
publication independently. Preserve raw reason presence, including falsy
values, rather than inferring it from truthiness. No permission widening,
comparison rewriting or product change is needed. Source/synthetic controls
for first-failure plus census-failure and census-only failure should bind the
corrected packet before acceptance. No such control was executed in this phase.

## Reviewed execution topology and clocks

The proposed actual graph is not this review's four-process graph:
`outer.mjs:33–34` imports/calls supervisor **in the same process**; supervisor
awaits one `runDirect` child at a time. Direct-child admission rejects an already
active child. Thus the steady known runtime graph is owner + one build/type/case
Node (two roles), within proposed peak3 if the supplied `exec env ... node`
launch topology is preserved. Any additional enclosing capture owner counts
toward three; no wrapper chain or extra uncounted owner is implicitly allowed.

The116 known execution roles are one owner, one build, three typechecks and111
case Nodes;28 separate administrative roles give144 planned known roles. This
is a finite direct-role plan, not proof of all transitive OS work. No case
subprocess/Worker/asynchronous-loader permission is granted. Build/type/admin
authority is separate, trusted and not described as case containment.

Source clock checks retain30min total,180s aggregate setup,180s aggregate typing,
120s finalization,3s cooperative case abort and8s direct-child deadline. Types
subtract elapsed time rather than silently resetting the aggregate allowance.
Working-tree census is sampled logical disk usage, not continuous quota/RSS or
universal preemption. Forced or unknown direct retirement remains a failure.

## Producer, loader and comparison boundaries

Source setup authenticates encoded capsule bytes, then exact compressed bytes
and hash before bounded gzip decode; decoded identity/member hashes precede
source publication. Actual build requires `dist` absent before the producer and
checks shipping identities afterward. Retained package admission uses the
unchanged corrected helper: regular/exact-size/bounded read/hash before inflate,
same authenticated Buffer, decoded bound and concurrent-buffer accounting.
Validated954-member extraction precedes installed imports; physical rename
occurs only after installed cases finish, with installed parent absence checked.
None of those future producer/import actions occurred in this review.

Per-case role files bind exact paths, script, environment, synchronous hooks,
bootstrap helpers, module bytes and declared edges. The actual public `exec`/
`dispose` bindings remain the qualified mechanism's bindings. Three generated
consumers are only planned typechecks; `void shell.dispose` proves member
presence, not a runtime disposal test. Fresh tool payload, binary, archive,
generated-file and load-trace checks remain mandatory during authorized setup.

Raw native37 comparison results are observations: supervisor does not branch on
`rawComparison` equality. Different stdout/stderr/status/effects therefore do
not automatically stop an otherwise qualified run. Harness, capture, cleanup,
receipt or identity failures do stop it. No normalization, native5.3/full-Bash
claim or semantic mismatch deduction is introduced.

## Required fresh authority after F01 disposition

Do not create GO.json or INDEPENDENT-ACCEPTANCE.json from this HOLD. After a
corrected immutable packet is reviewed, root must bind the exact successor seal,
closure hash, accepted review's raw hash, candidate/profile/work, exact limits,
fresh notBefore/notAfter times and GO.json mode0600. Current command topology is
sole explicit `exec /usr/bin/env -i ... pinned-node outer.mjs --seal-sha256 ...
--grant-sha256 ...`; no inherited grant or automatic retry is authorized.

Root must preserve the disclosed startup boundary: outer opens its files before
metadata admission, but its top-level imports/first capture open can still fail
before its own logger. Trusted tool-shell startup is explicitly outside this
packet's child-capture qualification. If complete pre-entry raw capture is
required, bind it prospectively without adding uncounted roles or files that
violate the fresh-work inventory. Do not represent this DATA review as observing
that startup or any runtime producer.

Current mechanism success does not rescore18598a86 or6483fb24. M08 EPERM cause and
group absence remain UNKNOWN. No old root was mutated or cleaned, and all111
comparisons remain UNRUN. Only owned review evidence is published.
