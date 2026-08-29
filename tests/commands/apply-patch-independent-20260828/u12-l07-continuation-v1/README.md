# U12/L07 continuation: 7 PASS, 2 retained fixture failures

Date: 2026-08-28. Source/preseal commit: `4eb3bf73`.
Preseal SHA256: `b23396701e4e06318eb200b8b04866bb81d87c3b1cd511bd528604f86d0ed4a4`.
Candidate: `753f33d2fa1a2ccd86089c563d4ad66b9a1ae26d`.
Derived tree: `6a59ca403c5411344dea2ee057909ba179bf7043`.
Full882 package SHA256: `f04afbf9230fd9e3275f83c7dab26837aeb618bd6178f4ac0b794b93302d6d95`.

One authorized execution completed. No retry, product change, compiler, installer,
native oracle, external network, private source, or root/default integration.
This is nine NEW versioned cases, not a rescore of83c2711f or its historical inputs.
All case observations were captured before assertions. Actual raw channels,
receipts, immutable pre-load graph and postguards are in `attempt-01/`.

## Actual results

| New cases | Scope | Classifier |
| --- | --- | --- |
| U12-v2-ordinary | source/installed/moved, fresh Shell per case | 3/3 PASS |
| U12-v2-caller | source/installed/moved, fresh Shell per case | 3/3 PASS |
| L07-16383, L07-16384 | compiled-source direct MemoryFS | 0/2 PASS; cleanup-count fixture failure |
| L07-16385 | compiled-source direct MemoryFS | 1/1 PASS |

### U12: actual public outcome, not an inferred effect

Every ordinary case fulfilled with status1, result stdout exactly
`Success. Updated the following files:\nM a\n` (42 bytes), and result/external
stderr exactly `shell: line 1: [object Object]\n` (31 bytes). One external stdout
write was attempted with those exact42 bytes and threw the original primary
object. Those are Shell-captured attempted stdout bytes, NOT a successful external
sink write. There was no caller abort and no public execution rejection.

Every caller case attempted the same one stdout write, aborted with the caller
object, then threw the primary object from the sink. Public execution rejected
with the exact caller identity, not the sink identity. Caller signal.reason was
that same object. No ShellResult existed; external stderr was empty. The missing
result is explicit, not represented as status0 or empty returned stdout.

In all six cases, both middleware-owned cleanups (run_patch and apply_patch)
started/ended once before public settlement, observed settled=false, and were
already complete in the synchronous settlement snapshot. Separate later disposal
fulfilled and did not run either again. `/work/a` was actually read as `new\n`
before disposal; binary sentinel remained `00ff8053656e74696e656c0d0a`.
Publication was not rolled back after failed summary delivery.

### L07: boundary behavior matches; two new count errors retained

The65-component paths use64 components of252 ASCII x bytes and one component of
190/191/192 y bytes. All are within MemoryFS's255-byte component limit and command
256-component limit; absolute lengths are exactly16383/16384/16385. No lower
command limits, custom provider, or unsupported full-path acceptance was used.

Minus/at both fulfilled status0, produced exact16424/16425-byte stdout summaries
in chunks[16384,40]/[16384,41], and empty stderr. Each created64 directories and
one LF-only target, preserved the binary sentinel and matched the complete
68-entry namespace. Captured262 calls:196 lstat,1 access,64 mkdir,1 writeFile.
The exact input/path hashes match PRESEAL. These are actual successful public-cap
outcomes, unlike the original single-component ENAMETOOLONG cases.

Both still classify FAIL: frozen `cases.mjs` expected cleanups.length===1, actual2.
Source explains two closures on success: apply.ts196 registers work.close;
apply.ts221 constructs OutputOperation, whose contracts/output.ts68 registers its
close. A preflight refusal never constructs that output operation. Both captured
cleanup promises fulfilled. This is an incorrect new fixture count, not a proved
product cleanup leak. The count assertion and its two failures remain unchanged.
Assertions later in that grouped check were not executed after the count failure;
their recorded fields are observations, not additional dynamic assertion passes.

Over fulfilled status1, stdout empty, exact39-byte stderr
`apply_patch: UTF-8 byte limit exceeded\n`, zero FS calls and unchanged three-entry
namespace. One registered cleanup fulfilled. All three cases acquired stdin once,
pulled the chunk and EOF (2 pulls), and made0 return calls after natural EOF.
No caller abort occurred. This scope proves neither Real/remote full-path support
nor general provider limits beyond the declared Memory profile.

## Binding, captures and retirement

The exact Node22.22.2 executable and original runtime/build/source/catalog/archive
bindings were verified before admission. Streaming rehydration authenticated all
29,495 positive-size archive file records and209,745,917 decoded bytes, not merely
the selected subset. Selected packages each matched all882 files and modes;
274 source inputs were authenticated from the captured Git object batch.
No new build occurred: source layout is the archived compiled-source projection.

Installed and moved use distinct consumer package boundaries and bare virtual-bash
resolution. Moved was physically renamed and the origin checked absent. Each
worker authenticated216 unique actual product modules plus1 new harness module.
Full owned-work inventories before/after every worker reject changed and new
entries. The old inputs and four new sealed source files also passed postguards.
This reuses the original qualified strict loader, not a stub collector.

Runtime owner plus3 sequential workers =4 OS processes, peak2 including owner.
All3 child receipts record exit0, signal=null, observed close and absent PID; owner
tool exit0 was observed. All workers report zero unhandled rejections. Runtime
elapsed7,760.184875ms, scratch13,571,180 bytes/2,664 files, removed by identity-bound
owner. No test processes or servers remain. Developer editing/Git archival is
separate from these four runtime processes and is not presented as worker evidence.

Child raw stdout/stderr observed/retained402,026 bytes, zero loss. Outer raw stdout
655 bytes/stderr0, created before launch. The15 initial capture files total
1,604,938 bytes; POSTGUARD adds3,515 bytes, for1,608,453 bytes, below32MiB combined.
POSTGUARD authenticates exact raw channel hashes and equality with RESULT records.
Preexisting archive47,298,696 bytes was read-only input, not copied into new capture.
No final process census substitutes for the recorded exact-child retirement.

## Qualified assessment and unmeasured scope

No new product defect is established. Six public U12 cases supply the previously
missing Promise/identity/cleanup/effect evidence. Legal-path minus/at/over outcomes
are now observed, but the continuation remains7/9, NOT9/9, because of the two new
cleanup-count fixture errors. No source fix or automatic expectation migration.

Historical15 type outcomes,189 author outcomes,12 versioned-tail,8 adapters,
33/36 unmodified S54,16/18 limits and10 targeted mutant kills are unchanged, not
rerun. Original legacy11 failures remain: source/moved S62,S64,S71,S74 and
installed S62,S64,S71. In EVERY old layout, S32; S54's inherited static label;
S57/cleanup-only, S57/execution-first, S57/caller-first, S57/mapped-nonzero; and S61
remain21 uncredited records total. This continuation does not qualify those
provider-authority/lifecycle/zero-budget probes. WebDAV was not run. Existing
source-only/cooperative-work/resource observations are not hard RSS/preemption
guarantees. Original U12 missing observations, L07 ENAMETOOLONG/truncation, all
HOLDs and capture-loss history remain immutable. Module assessment only; root
integration and broader/default acceptance remain separate decisions.
