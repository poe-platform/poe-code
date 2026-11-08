# Tool Request Correction Static Review Specification

Status: Proposed

Implemented Through: Not applicable

Purpose: Freeze the different reviewer's narrow FC-F01 inspection criteria before reading the sealed correction bodies on August 28, 2026.

## Normative Language

The key words MUST, MUST NOT, REQUIRED, SHOULD, SHOULD NOT, RECOMMENDED, MAY, and OPTIONAL are to be interpreted as described in RFC 2119.

## 1. Problem Statement

The original FC-F01 finding is immutable: serialization could read accessors or erase extra undefined fields before parent admission. This audit MUST assess the exact sealed additive correction, not rescore the original parent or define new Yq semantics. The correction already exists; this is post-candidate, post-authoring static preparation, not unseen precode behavior evidence.

## 2. Goals and Non-Goals

### 2.1 Goals

The reviewer MUST authenticate the routed commit, complete overlay membership, seals, pre/postimage bytes, modes, sizes, and future target paths. The reviewer MUST inspect descriptor-first validation, exact four existing callsite profiles, and unchanged strict parent admission.

### 2.2 Non-Goals

The reviewer MUST NOT import or invoke authored modules, projectors, getters, proxies, controls, compilers, copied tools, loaders, candidate products, or harnesses. Trusted host data/hash/syntax operations are allowed. Candidate archives and physical tools are already separately audited and MUST NOT be redundantly replayed. FC-F02/03, other unsealed work, whole-recipe approval, hostile host-JavaScript sandboxing, and new policy are out of scope.

## 3. Boundary and Failure Semantics

Before TOOL RPC or serialization, validation MUST examine finite own keys and own data descriptors, types, values, and phase without accessor reads, coercion, or prototype-identity requirements. Extra undefined, symbol, and nonenumerable fields, missing fields, arrays, holes, and array-valued primitive fields MUST NOT enter a valid tool payload. Valid cross-realm own-data records MUST remain admissible under the same role rules.

The payload MUST be fresh, contain only validated primitives, and not retain the caller's alias or inherited toJSON. Reflection or RPC rejection MUST preserve the actual thrown reason through the asynchronous API. Parent route, origin, config enrollment, path, tool, budget, and phase admission MUST remain strict. Input record insertion order is not a newly imposed semantic requirement; declared output field/sequence order MUST remain exact. No hostile proxy or corrupted-intrinsic guarantee is required.

## 4. Test and Validation Matrix

| Criterion | Permitted evidence | Deferred evidence |
| --- | --- | --- |
| TR-01 Authentication | Exact committed seal/overlay/hash/mode/size/membership checks and pre/post mapping | Future full assembly reseal |
| TR-02 Pre-RPC own data | Source control flow for malformed and valid cross-realm shapes | Getter/proxy/shape controls UNRUN |
| TR-03 Fresh payload and reasons | Source allocation, primitive projection, async propagation | Identity and serialization controls UNRUN |
| TR-04 Four roles | Exact Git tree/show AUTHENTICATION and BUILD/TYPES compiler callsites, unchanged parent | Actual role/control calls UNRUN |
| TR-05 Scope and evidence | Two-target delta, syntax-only parsing, 24 deferred definitions, original failures retained | Recomposition and dynamic proof UNRUN |

## 5. Conformance Criteria

The reviewer MAY conclude the narrow source correction is statically coherent when these source/data criteria have no demonstrated contradiction. Such a conclusion MUST NOT claim behavior passes, complete framework readiness, or execution GO. All 24 author-declared controls remain UNRUN, all candidate/control executions remain zero, and parent FC-F02/03 remain open. Any genuine contradiction MUST be recorded with exact source lines and immutable evidence; the reviewer MUST NOT fix foreign source. Incidental review preparation failures MUST remain recorded rather than silently becoming passes.
