# Semantic blocker analysis — SOURCE/DATA only

August 29, 2026. Prior semantic attempt91d75f2b/publication2084983a is consumed. No retry, engine import, Worker, case, C11, native oracle, guard change, or product edit occurred here.

## Decision requested
**A is the smallest supported public-config alternative, if root explicitly accepts a reduced comparator security profile; otherwise C. B is not a small permission exception.** No option is implemented or activated.

### A — public configuration, new functional-only profile
Pinned3.4.2 exports BashOptions.defenseInDepth?: DefenseInDepthConfig | boolean. Propose only a versioned comparator constructor option defenseInDepth:false (object enabled:false also avoids activation patches). Keep all external offline/loader/source/hash/mode/CJS/assets/capture/resource guards, exact scripts/stdin/expected bytes/status/effects, target67eab/full6608 and unavailable bootstrap unchanged. New profile proposed: JUST_BASH_3_4_2_EXTERNAL_GUARDED_DID_DISABLED_V1.

This disables the comparator's secondary host-realm defense, NOT the harness guards. It is not default/stock security configuration, security equivalence, stronger isolation, full Node capability, or demonstrated33-case readiness. Source says the identified defense-hook branch and its blocked-global getter enumeration are skipped; later unrelated refusals remain possible. Frozen adapter/options and old result stay immutable; new successor/recipe/review/grant required.

### B — owned trusted hooks/stdio, not ready
Node22.22.2 provides synchronous same-realm module.registerHooks and a returned ModuleHooks.deregister method [N02,N03]. Pinned just-bash has no public registration-injection/handle-ownership option and discards that handle. Its static registration flag outlives deactivate/resetInstance. Raw hook permission would let a callback short-circuit the existing loader chain; it is not approved.

A separate design would need one exact resolve-only trusted activation, externally enforced continuation through existing hash/mode/parent/CJS/asset guards, no callback rewrite/shortCircuit, owner-held registration handle, explicit prior-hook ordering and retirement, and repeated/late/wrong-source denial. Phase ownership must not be represented as caller authentication. No raw Module API permission.

For stdio only, a possible separately reviewed host-preparation step could initialize already-owned fd1/fd2 before guard installation AND before any consumer evaluation, with preopened bounded captures. That is not permission to create arbitrary Socket objects after the guard. It needs full FD provenance/drain/closure controls and cannot by itself resolve the hook requirement. No such step ran here.

### C — unchanged profile remains unqualified
Keep the stopped comparator row and97unlaunched workers unqualified. The refusal is not a column-semantics defect or a target win.

## Exact cause and phase
The authentic trace orders bootstrap module/worker_threads unavailable replies54/55, consumer evaluation56, constructor57, fixture setup58, exec-start59, Socket(object) denial60, module.registerHooks denial61, exec-settled62 and cleanup64/65. The final captured hook-error stack is retained verbatim in TRACE-EXCERPT.json.

Source chain: adapter.mjs:102 -> Bash.exec -> execInScope -> DefenseInDepthBox.activate -> applyPatches -> protectDynamicImport -> denying offline registerHooks wrapper. Activation precedes parser/interpreter execution. Empty source returns before activation, so import/empty-setup admission did not exercise this branch. The defense chunk has a separate static node:module import; the successful getBuiltinModule unavailable bootstrap does not remove that imported namespace.

Default options omit defenseInDepth; constructor defaults true. enabled:auto tests whether registerHooks is callable; the denying wrapper is callable. Audit mode and exclusions do not skip hook installation. Excluding stdout/stderr does not avoid the earlier enumeration: w() reads target[prop] in a catching filter before applyPatches excludes those properties.

**Socket origin is still unknown.** The retained guard records only operation and typeof argument, not its fields, fd, target or stack. Node's versioned source shows lazy stdout/stderr accessors building net.Socket around pipe/TCP stdio descriptors [N01]. Together with the getter enumeration, this is a source-supported possible route—not proof of the old caller, which stream, object contents, or a real network request. Do not repurpose the later hook stack as a Socket stack.

## Invocation accounting proposal
Existing completed-worker increment is after safe launch (body.mjs:118-121); report.mjs:62 exposes it as execCounts. Preserve old semantic1/setup1/total2. Actual retained evidence independently shows2semantic attempts (one result, one rejected)+1empty setup=3. exec-start alone is insufficient because it precedes byteInput/method evaluation; the captured Bash stack establishes this rejected invocation.

Propose a NEW schema with per-role attempted/fulfilled/rejected/unresolved and separate legacyCompletedCounts. Prepare arguments and callable/receiver once; then emit bounded attempt, invoke, and emit outcome immediately on settlement before conversion/snapshot/cleanup. Attempt records mean dispatch-boundary attempts, not guaranteed callee entry across an abrupt exit. Missing durable outcome stays unresolved. Record sync throws and promise rejection with explicit reason presence, including undefined/null/false/0/empty string. Reconcile retained worker events even after nonzero disposal; never infer fulfillment or semantic credit from exit.

Setup, semantic outcomes, physical reaping, capture faults, guard violations and semantic predicate credit remain separate. Full planned165calls permits330event records; proposed2048bytes/event and4events/target-worker must be charged to existing FD3/record/document/global caps, never increase them. See TELEMETRY-PROPOSAL.json.

## Verification boundary and next controls
15 source anchors and18 inspected file hashes/modes authenticated before/after, with primary Node versioned source references. No dynamic experiment or synthetic control ran. PROPOSED-CONTROLS.json defines14 finite DATA/harmless-stub families for an A successor plus telemetry, and separate unresolved B obligations. Exact implementation/tool/fixture preseal and different review remain future requirements.

All prior scores, losses, natural:false/captureQualified:false, holds and source composition remain unchanged. This is an older78candidate comparison, not current Bash-surface acceptance.

## Primary sources
[N01] https://raw.githubusercontent.com/nodejs/node/v22.22.2/lib/internal/bootstrap/switches/is_main_thread.js (22-32,46-84,142-180).
[N02] https://raw.githubusercontent.com/nodejs/node/v22.22.2/doc/api/module.md (synchronous hooks and chaining).
[N03] https://raw.githubusercontent.com/nodejs/node/v22.22.2/lib/internal/modules/customization_hooks.js (63-114,160-191).
[N04] https://raw.githubusercontent.com/nodejs/node/v22.22.2/doc/api/process.md (process I/O).
Accessed August29,2026. These are source references, not execution evidence. Local packaged sources/types/README are authenticated in SOURCES.json, with exact needle/line/byte offsets in SOURCE-ANCHORS.json. No comparator download/install or engine evaluation.
