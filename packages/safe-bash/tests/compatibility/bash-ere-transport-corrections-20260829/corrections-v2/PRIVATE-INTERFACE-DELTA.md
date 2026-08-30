# Private interface delta and integration checkpoint

Source 46611a5b67ad7af276154421ac7f50dd536ec570 is not declaration-byte-identical to02782056.

- Existing wire request/reply/result unions, root constructor, session execute/close and cleanup-registration types are unchanged. Public RegexExecutionOptions/Expr/shared/runtime files are not edited.
- validation.validateRequest(value) gains optional prepaidWork:number and optional observed:(units:number)=>void. Existing single-argument callers remain callable; no unqualified whole-core typecheck claim.
- wire-engine.executeWireRequest(value) gains optional entryWork:number. Worker entry supplies its measured startup/header charge. Existing single-argument direct helper calls remain callable but are not Worker startup proofs.
- accounting exports workerReplyValidationWork=210 and workerValidationPrepayment(requestUnits:number,fragments:number):number. These are private accounting helpers, not new public limits/options/wire fields.
- Accepted engine72187e5 five source inputs replace historicalb5 in the fresh combined12-module type fixture only; engine source is untouched.

ROOT coordination reports core integration e013f817f still bound to02782056. It is NOT inspected, changed, compiled or accepted here. Integration needs an explicit new source/module-closure rebind to this candidate and its fresh12-module manifest before future runtime. Existing60 runtime variants allUNRUN.

The source implements conservative prepayment; 210 is charged logical validator entitlement, not a measurement of210 visits. Native enumeration/clone exception remains separate and does not excuse explicit loops. No acceptance is implied by the20 pure groups.
