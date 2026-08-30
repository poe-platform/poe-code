# DU29 actual checkpoint — HOLD, verifier repair needed

One frozen invocation of22a76e7854776aeb5234698bd8346bfe82ab653f, manifest
bbb98d5a46a7636e77548d1060da17c617f39c74b1f4962b146fad7af6770889.
Candidate0895de2d and package4d4d071a unchanged. Original1bd1048b fifteen files
and3e02038d zero-case hold are unchanged. No retry.

## Actual outcomes

- 19/19 source and19/19 physically moved runtime observations of the same19 IDs;
  all eight lifecycle mappings and postcandidate HTML-family R07 passed in both.
- 22/29 unique frozen IDs accepted: those19, P02 install/move, T01 and T02.
- T03 actually ran: exit2, empty stderr, exactly
  `consumer.ts(2,29): error TS2322: Type 'string' is not assignable to type 'number'.`
  Its subsequent tool-proof guard rejected; T03 is NOT rescored as accepted.
- Six genuinely unexecuted IDs: P03/P04/P05/P06/T04/T05. Original RESULT's
  `unexecuted` field also includes T03, meaning unaccepted there; REPORT.json
  explicitly preserves and qualifies that inaccurate envelope label.
- A06 genuine HTML release passed; addendum P03 public-completion remains unrun.

## Exact blocker and repair recommendation

`recipe/executor.mjs:94` unconditionally requires a root `dist/index.d.ts` read.
The original frozen T03 imports ONLY `virtual-bash/commands/du`. Its actual trace
authenticates the DU declaration and11 companion metadata/declaration reads, with
no root declaration read. This is a verifier route-classification defect, not an
established product or original strict-type-fixture failure.

Root may authorize a minimal separately frozen per-fixture declaration-route
predicate: require root+subpath for T01/T02, subpath for T03/T04, root for T05,
and root/missing-subpath for isolated P03. Preserve exact diagnostics, actual read
hashes, permissions, fixture bytes and all old outcomes. First qualify missing/
wrong-route/hash negatives. Do not rerun source/moved cohorts, automatically
retry this invocation, or relabel its footer as a pass.

## Proof and cleanup

771 pinned Git inputs authenticated/materialized;834 installed package members;
actual offline npm install and physical move; accepted5508a2a2 whole-pack build
reproduction bound, not rerun. Both runtime profiles record3781 product loads
across199 unique modules (3857 loads including fixtures); zero private-helper
loads. Tool observations:559 actual CJS compiles,1272 file reads. The full2274
regular-file/12 metadata-only-alias tool closure is bound before execution.

All42 asynchronous children exited and closed naturally; all42 PIDs and groups
are absent, zero watchdogs/active children.881 synchronous Git returns and85
successful integrity guards. Source, package, original freeze and protected/tool
inputs remain unchanged.247 raw files plus the exact tarball are losslessly
archived in captures.jsonl.gz (2409943 bytes), verified before owned scratch
removal. RESULT-original.json is byte-identical to the raw failure receipt.

No29-case public acceptance, whole76 prerequisite completion or whole-gate claim.
Privatehelper674 is present but neither approved nor loaded. Prior module/native
qualifications, directory-atime policy, O060 deferred gap and old failures stand.
The unsealed preparation inventory-order failure and incomplete terminal capture
remain separately disclosed in PREPARATION-01.json.
