# Additive Frozen Assertion Binding Specification

Status: Proposed

Implemented Through: Not applicable

Purpose: Define this review-harness component's exact predicates without accepting target behavior or replacing missing observations with output guesses.

## Normative Language

MUST and MUST NOT identify required behavior. SHOULD identifies a recommendation that needs an explicit reason for departure. MAY identifies optional behavior. These terms describe this harness contract, not additional YQ product requirements.

## 1. Problem Statement

The committed coverage checklist identifies 40 unbound expected fragments across 28 whole projections. The prior adapter stops before primitive assertions when a natural-language obligation is unbound. This component evaluates the independent primitive obligations and the additional predicates without modifying the original fixtures, old failures, v4 assembly, or CW-F01/F02 history.

The target is `b8f5d60d75452e1dd181167fb87abd995221f6e3`; its whole870 package hash is `1d06350cdef1a5f6c7d70c7d55a19b63537037bd97b2de5a5d8b8b8f722229ca`. Neither is loaded by this component preparation.

## 2. Goals and Non-Goals

- The evaluator MUST retain the 65 primitive fragments in these 28 jobs and implement a dispatch for each of the 40 additional fragments.
- The evaluator MUST distinguish a contradictory capture from an unavailable observation. Missing obligations MUST NOT mask independent contradictions.
- The component MUST NOT implement observers, source proofs, scheduling, materialization, compiler calls, target imports, or public export admission.
- Public byte schemas MUST NOT establish private Decimal representation, query counters, allocation, ownership, or alias identity.
- A predicate implementation and a successful synthetic check MUST NOT count as target proof, full-record completion, semantic success, or fresh execution GO.

## 3. Authority and Projection

`INPUTS.json` binds exact Git source contents. `catalogue.json` is a fresh regular-file projection containing the original jobs, 105 original fragment rows, 40 dispatch entries, 23 same-record gap links, and original source/overlay references. Historical content is `ORIGINAL_MODE_UNATTESTED`; its old POSIX mode is not inferred. Future execution MUST authenticate the fresh projection's path, regular-file kind, mode, size and hash through the core assembly seal.

The authoritative checklist is commit `3bd3612ecbcd8626ec21b362c88d1ebf53e7a532`. Its 77 executor-missing items overlap this tranche; the 23 direct same-record links do not assert equivalence or add completed counts. The original194 and eight overlapping overlays remain unchanged.

Help/version resolution MUST follow final-carry `bd471ef682d768692a682d40009a874f51e3ad68` inherited `final#/exactInformation`, through its SOURCES entry to `5783b8e03912f7774d2a86ba1dae9de778121273`. The text is exactly 501/37 UTF-8 bytes. Historical draft state strings are preserved in data, not treated as new authority. No policy or normalization is introduced. CMD22 is outside these 28 jobs; its sealed cwd correction is not changed.

## 4. Integration Contract

The ABI is `yq-coverage-additive-v1` from committed core `96d48ee4d2690c8ce474460d57ce0362656ddd6f`, ABI SHA256 `4d5e2ca14a50965daaf08218ea1ecc26838f9376868d8ab5b929bfef2e7178f1`. The authoritative exact hash is also recorded in `INPUTS.json`; it is checked by the preseal recipe.

`evaluateAssertions(input)` is synchronous and pure. Its input has exactly `schema,job,receipt,fragments,observations,sourceArguments,local`. `receipt` is the existing **capture object** (`outerReceipt.capture`), not the outer receipt envelope. The caller MUST persist raw stdout, stderr, status, rejection, events, effects and cleanup before calling. This function performs no IO, imports during the call, timers, or spawning.

The caller MUST authenticate the candidate, raw capture linkage, job, original fragment projection, fresh executable/data closure and each observation actor's bindingId/evidence enrollment. A string in `evidenceRefs` is not authority. The local function cannot validate an external file or grant GO. Primitive result rows have empty `evidenceRefs` because the ABI capture object has no artifact-reference field; the caller MUST retain the outer raw-receipt reference. Observation refs are nonempty bounded strings in dense arrays and are forwarded unchanged.

The return is exactly `schema,jobId,status,results,unbound`. Rows are exactly `bindingId,recordId,role,status,evidenceRefs,detail`. Status precedence is CONTRADICTION → FAIL; otherwise UNOBSERVED → INCOMPLETE; otherwise PASS. PASS describes these assertion rows only, not structural gaps, full records or semantic role eligibility. The coordinator MUST aggregate separately owned gap/source/actor results and child status. Unexpected worker/child nonzero, signal, timeout or overflow remains FAIL regardless of this return value.

## 5. Predicate and Failure Semantics

Fifteen additional predicates use already captured bytes or the complete frozen fixture namespace. Twenty-five require observations. `OBSERVATION-NEEDS.json` declares exact fields and original references; these are required capture interfaces, not a claim that actors currently provide them. In particular:

- Counters, Decimal fields, alias identity/charging, admission ordering and composition boundaries MUST NOT be inferred from stdout.
- Missing or extra observation fact keys yield UNOBSERVED unless another known field contradicts the expectation, in which case CONTRADICTION wins.
- NUM16 remains UNOBSERVED without independently sealed inspected-baseline text; an observer's claimed baseline alone cannot authorize a new golden.
- UTF22 reuse/finalization and correct `[1,2]` bytes do not alone prove internal retained-copy ownership. The full assertion remains UNOBSERVED pending the actor/source binding. Wrong known facts still contradict it.
- FS01 checks literal read/stdin order, repeated operands and signal forwarding now, but absence of host access requires a complete authenticated observation/capability closure. An event-free assertion of host safety cannot pass it.
- Source arguments are supporting source-role input only. This component checks their role but never evaluates their claims as truth or substitutes them for runtime observations. The core owns source ingestion/classification.

Known primitive checks include status, no unexpected rejection or cleanup error, exact original before/after snapshots, no unbound FS operations, supplied read signal, exact output, success stderr, diagnostic category/code/frame/location, compact JSON documents, and pre-input effects. Every primitive runs even if another fragment is missing. Exact ENC07 output is a frozen JSON-compatible quoted YAML scalar: its document and frame checks use the exact adopted bytes, not a new YAML parser or normalization.

The evaluator MUST validate finite own-data descriptors, keys, primitive types and dense ordered arrays. It MUST NOT require prototype identity. Accessors, symbol keys, nonenumerable fields, holes, undefined extras, cycles, over-bound inputs and unknown structural schemas are rejected as harness input errors. It MUST NOT invoke getters. Actual trap-thrown reasons propagate unchanged. The `local` reference channel is neither traversed nor serialized; this tranche makes no serialized reason-identity claim.

## 6. Bounds and Preparation

The call accepts at most 250000 data nodes, depth64, 12582912 aggregate string code units and 20000 elements per array. Capture stdout plus stderr is at most2097152 bytes. Event indices are exact dense sequence positions. These bounds do not promise hard RSS, sandboxing against malicious host JavaScript, atomic snapshots, or immunity to equivocation between checks.

The synthetic recipe MUST be committed before the first predicate import/check. It permits one finite supervisor and one nested Node synthetic process, no grandchildren, no retries or cap reset, 60 seconds including cleanup, and explicit capture/storage limits. All synthetic data is labeled STUB and cannot be inherited as target proof. Source and tool regular-file hashes/modes are checked before and after; new entries are rejected except the explicit evidence allowlist. Raw per-case facts/intent are persisted before predicate assertions. Unsafe integrity or unknown reap state stops the run.

## 7. Test and Validation Matrix

| Contract | Bounded component evidence | Future dependency |
| --- | --- | --- |
| 40 exact dispatch IDs / original refs | Static data/hash checks; synthetic per-binding cases | Core composition and different review |
| 15 byte/frame/namespace predicates | Matching and contradictory synthetic captures | Real source-built and moved captures |
| 25 conditional observation predicates | Missing, exact, contradictory, extra-field cases | Authenticated actor/source capture, never private DI |
| Contradiction dominates missing | Bad primitive with absent observation | Full parent aggregation |
| Cross-realm own data | Separate vm realm, accessors, holes, symbols, nonenumerable controls | Existing truthful-host boundary |
| Thrown identity | Synthetic object/primitive trap reasons, local getter unvisited | Actual in-child reason comparisons by actors |
| No target credit | Recipe/tool/import allowlist and explicit target0 | Fresh root execution GO held |

## 8. Conformance Criteria

This packet is ready for different review when its source/data/tool recipe is sealed, all permitted synthetic outcomes and raw statuses are recorded without golden updates, and unresolved observers are explicit. It is not accepted launch coverage until the core binds it, a different reviewer accepts it, and all required runtime/source obligations have their own evidence. Target, compiler, loaded controls and public exports remain UNRUN or PUBLIC_EXPORT_GAP as applicable.
