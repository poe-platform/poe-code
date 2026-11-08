# FC-F01 Correction: Different Static Review

Date: August 28, 2026. Verdict: **NARROW STATIC CORRECTION COHERENT**. New source-integrity/code findings: **0**. This is not a new compound recipe, behavioral acceptance, READY-TO-RUN verdict, or GO.

## Authority and chronology

Criteria and routed hashes were committed as `952d404f` before correction-body inspection. Live AGENTS was read; its SHA256 is `64fde885fd30edd6751f95603defac1d15defb6a33dedca2049a82f9aace379c`. This audit is post-candidate, post-authoring static preparation. It is not unseen precode behavior evidence. Original review `88f92894efd9c14de76ed6a2669292f10467dc4f` and original FC-F01 witness `2df1dab10c3176a35f4160fa12c460a7abc592fe` remain unchanged and unrescored.

## Authenticated mapping

Source: `3b55c4afb81e32d719c14995a6e38620b4fabe2c`, directory `tests/commands/yq-independent-20260828/executor-b8f5d60d-v1/tool-request-validation-v3/`.

| Binding | SHA256 |
| --- | --- |
| FINAL-SEAL.json | `9f8cacde18c46e9d7d7c82c3665ab0ba0e6406b9b42e6e939c2fe826164daa54` |
| OVERLAY.json | `2d31ea4c244af9c0a036822bd5150984e0a047f20777493bb41b1c05b485c1fe` |
| Exact scoped Git binary/full-index diff | `85975b619f7dda9b56b9dbf5b1abcba5d0ee9a313b0e7d1ea0a30c60d2e42394` |
| Parent core/worker-api.mjs, 13,187 bytes | `e6548d6d4d7d8c6433f11953a0f62638e8f699a91dc31617cfc2dea2740fc876` |
| Replacement core/worker-api.mjs, 13,289 bytes | `9b9ef9ab1aa83e76678d72dc6a99407623dd16822e220ea427d553dd2545e3ec` |
| Add-only core/tool-request.mjs, 2,557 bytes | `bac59cab6cbed385817dc22f616c0fdf407cc490319cd42b6fb9b4e54209a4ad` |

All ten committed/current overlay files match exact membership, bytes and hashes; Git class is `100644`, current full file modes are `0644`, root mode `0755`. File membership/hash/size/mode snapshots match before/after checks, not a change-and-restore proof. FINAL self bytes are bound by the root-routed external hash. Historical parent Git class is not reconstructed historical full-POSIX-mode authority. Fresh assembly targets still require their own admission.

The only replacement edits are the import at worker-api.mjs:8 and runTool expression at :180. Reversing them restores the exact parent bytes. The new helper is absent in parent `b1b8566686769e5e53433048f2058ab09d8c00c3`. No other parent body is replaced by this overlay.

## Source conclusions

References here use the exact source commit above; parent references use frozen b1 `composition-v2/assembly/`.

- **Pre-RPC own data:** worker-api.mjs:180 evaluates projection before entering RPC. tool-request.mjs:9 checks object/non-array; :11 includes every own key; :12 rejects extra/symbol keys; :15–17 read only own data descriptors. Original call property getters and coercion methods are not read. Extra nonenumerable/undefined fields cannot disappear into serialization. Required nonenumerable data is admissible: flags are not an extra policy restriction.
- **Exact role values:** tool-request.mjs:28–42 requires all three declared keys, primitive bounded strings, exact BUILD120000/TYPES60000 values, and AUTHENTICATION-only Git with lowercase40hex revision. Arrays/holes at the root fail :10; arrays or boxed values in fields fail primitive type checks. No prototype identity is compared. Cross-realm own-data records follow the same source branches; record insertion order is not semantic.
- **Fresh payload and sequence:** tool-request.mjs:44–46 allocates a frozen null-prototype record in declared field order with validated primitives only. Caller aliases and inherited toJSON are not forwarded. A refusal occurs before RPC sequence consumption; accepted calls synchronously enter RPC once in invocation order. No new counters, clocks, retries or routes are introduced.
- **Actual reason identity:** the async expression at worker-api.mjs:180 contains no wrapping catch. Reflection throws and RPC rejection reasons propagate unchanged within the child. Promise-instance identity and cross-process identity are not claimed; parent worker-host.mjs:21 still reconstructs remote errors. Reflection may invoke Proxy traps; no hostile Proxy, intrinsic-corruption or preemption guarantee is inferred.
- **Four existing profiles:** authenticated parent infrastructure-worker.mjs:16/:20 construct Git tree/show calls; build-worker.mjs:79/:175 constructs/invokes BUILD120000; type-worker.mjs:137 invokes TYPES60000. Parent tool-bridge.mjs:19–47 retains strict config/path/enrollment admission; :65–79 retains selected Git tuple, fixed tool and role checks. Its bytes, worker-host and primitives are unchanged. This does not reapprove the parent's unrelated capture/deadline defects.

## Counts, limits, and next integration boundary

`EVIDENCE.json` records 92 static data comparisons and two existing-host Node syntax-only parses, including raw stdout/stderr/status and known-owned reap before assessment. These are not behavioral control passes. All 24 declared controls remain **UNRUN**; candidate/product/compiler/copied-tool/helper/module/control/getter/Proxy executions and control passes are **0**. No candidate archive/tool audit was repeated.

The author's failed cross-realm-array prototype-equality data check remains recorded verbatim as historical preparation failure; it is not inherited as a pass. This review incurred no preparation failure. Output-display truncation was followed by focused reads and is not a failed target/control.

FC-F02 and FC-F03 remain open; their unsealed correction was not read. Root must select these exact two postimages into a fresh assembly and reseal the complete import/data/recipe closure alongside separately reviewed fixes. The parent remains **NO-GO**. Future authorized behavioral controls are distinct from this coherent source correction. Existing 194+8 overlap, 336/18 reservations, 24,165-second ceiling and all prior gaps/failures are unchanged; none are new proof here. No GO request, token, file or execution authorization was created.
