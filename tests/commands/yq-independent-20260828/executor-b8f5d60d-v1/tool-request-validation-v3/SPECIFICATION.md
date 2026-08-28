# Tool Request Validation v3 Specification

Status: Proposed corrective overlay; static preparation only

Implemented Through: `b1b8566686769e5e53433048f2058ab09d8c00c3`

Purpose: Repair FC-F01 at the real worker tool-call boundary without changing tool roles, parent admission, product policy or the frozen composition under review.

The implemented-through reference identifies the defective frozen parent. This additive overlay is not dynamically verified or integrated into a new recipe.

## Normative Language

MUST and MUST NOT identify required behavior for this narrow overlay.

## Problem Statement

FC-F01 records that api.runTool passes the original call to rpc. Worker-host JSON serialization can invoke accessors and omit extra undefined, nonenumerable or symbol properties before parent validation. The parent cannot recover the original own-property shape after that loss.

## Goals and Non-Goals

The overlay MUST validate the original call before entering TOOL rpc or serializing it. It MUST accept valid cross-realm own data without comparing prototype identity. It MUST NOT add tools, YAML cases, execution authority, retries, deadlines, private hooks or global hardening. It does not claim a hostile Proxy/host-JavaScript sandbox or hard preemption.

## Domain Model and Configuration

The only request kinds remain compiler, git-tree and git-show. Compiler has exactly kind/configPath/timeoutMs: BUILD requires120000; TYPES requires60000. Git has exactly kind/revision/path and is limited to AUTHENTICATION. Revision is a primitive lowercase40hex string. Paths are primitive nonempty NUL-free strings; compiler paths must be lexically absolute and normalized. The parent still proves canonical regular paths, actual config/tool membership, exact selected Git tuples, generated enrollment and deadlines.

Strings are bounded by262144 UTF-16 code units, a coarse necessary condition for the existing262144-byte message limit, not a new runtime budget. The existing final serialized-byte limit remains authoritative.

## State Machine and Boundary Contract

The async runTool body MUST synchronously inspect and project the call before its first TOOL rpc invocation. Validation failure MUST reject without entering rpc, consuming an IPC sequence, or admitting any child. Valid calls MUST invoke the existing rpc once, in caller invocation order, without resetting counters or clocks.

The projector MUST require a nonnull non-array object with exactly three own string keys. It MUST use own-key/descriptor inspection, including nonenumerable and symbol keys, before reading descriptor values. Every accepted property must be an own data property. Accessors, missing own fields, extra keys and nonprimitive role values MUST be rejected without invoking getters or coercion methods. All caller arrays, including sparse arrays and arrays used as field values, are invalid for these existing record-only shapes; no holes are normalized away.

Input property insertion order is not role meaning: the existing parent compares sorted key sets. Required data properties may be nonenumerable, nonwritable or nonconfigurable because the declared role does not constrain those flags. Extra nonenumerable, symbol or undefined-valued properties remain errors. The projector MUST construct output keys in declared role order.

The accepted output MUST be a fresh frozen null-prototype record containing only validated primitive values. It MUST NOT retain the caller object, inherit its toJSON, copy getters, or permit later caller mutation to alter the transmitted request. No caller prototype identity or inherited member is consulted.

## Error and Identity Semantics

Ordinary malformed input rejects with a fixed unsafe TypeError code. Reflection or rpc failures MUST propagate their actual thrown/rejected reason unchanged within the child; no catch/stringify/clone/wrapper is introduced. The async API still returns a Promise. This is not a new promise-instance identity contract or a cross-process identity guarantee. Existing cancellation, scoped command-reason capture, negative compiler classification, worker exit and phase behavior remain unchanged.

Descriptor inspection can invoke Proxy internal traps and can itself throw. This overlay does not promise to preempt malicious traps, defend altered language intrinsics or suppress caller-side argument construction effects. No Proxy or getter is constructed or invoked during this preparation.

## Integration and Safety

Only a fresh core/worker-api.mjs postimage and new core/tool-request.mjs may be projected by a later root composition. The worker API postimage differs from b1 by one import and one runTool expression. Parent worker-host, tool-bridge, primitives, source/tool/config guards and all process/result/cancellation machinery MUST remain unchanged by this overlay.

The old recipe and seals MUST NOT be reused for these changed bytes. Root must finish the active independent review, combine any approved overlays into a new complete membership/recipe seal, and separately decide execution GO. This task creates neither that composition nor GO.

## Test and Validation Matrix

Static checks cover the exact finding and source preimages, inverse verification of the two worker-api edits, new helper syntax, actual BUILD/TYPES/Git construction sites, source/target byte-mode maps and unchanged parent components. No target module is imported or evaluated.

DEFERRED-CONTROLS.json records24 UNRUN controls: original accessor/extra-undefined witnesses; nonenumerable/symbol/missing/accessor fields; sparse arrays; nonprimitive coercible fields; exact role/value rejection; cross-realm/null/custom-prototype positives; key order; inherited/own toJSON; fresh-copy mutation; raw rejection identity and call sequence. These are future authorized synthetic obligations, not test results or new semantic cohort jobs.

## Conformance Criteria

The source overlay is prepared when its exact new bodies and projection preconditions are sealed and static checks complete. Correct runtime behavior remains unverified until a different reviewer is authorized to exercise the real boundary and its deferred controls. Static checks MUST NOT be described as control passes, product acceptance or full-gate success.

## Open Questions

No broader prerequisite change is identified for FC-F01. Any other finding from the active b1 review remains outside this overlay. Future root composition, independent verification and execution authorization are still required.
