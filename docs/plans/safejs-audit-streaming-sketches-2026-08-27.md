# Streaming sketches: agent-executed QA plan

This is the finite source-family QA plan under the existing [24-hour Markdown procedure](safejs-24h-audit-2026-08-27.md), not a runnable runner script. Parent window: 2026-08-27T02:17:08Z through 2026-08-28T02:17:08Z; parent audit remains ongoing.

Artifact filenames below are relative to the [streaming-sketches evidence directory](../../out/safejs-audit-2026-08-27/streaming-sketches/), not this docs/plans directory; explicit repository paths remain repository-relative. Original execution writes were confined to that family directory. The August 27, 2026 documentation-only correction additionally authorizes this plan file and does not rerun the procedure. Historical path/hash and move provenance are retained in [plan-move-provenance.json](../../out/safejs-audit-2026-08-27/streaming-sketches/plan-move-provenance.json).

The root freeze applied during the original executions. It was released after v3, and the root writer is now active; root/master/ACTIVITY and other shared paths remain outside this family's correction scope.

## Execution procedure

1. Inspect pinned original source as text, record exact revisions/files/licenses and adaptations. Never install or execute original upstream packages. Discovery/retrieval is host-side only.
2. Freeze published MurmurHash3 x86_32 words, UTF-8 byte arrays, manual HLL register anchors, accepted event IDs and exact frequency totals in anchors.json. Preserve the corrected, unexecuted anchor draft separately. Run the independent host-only BigInt oracle recorded in anchor-command.json under a five-second watchdog. It does not use Math.imul/clz32 or execute downloaded code.
3. Require all eleven published words, four byte encodings, manual registers and totals to match, then persist the full expected.json BEFORE snippet runs. Each matrix cell is independently derived by summing accepted matching events; each HLL rank uses binary-string inspection of published words. HLL raw/estimate tolerance is 1e-12 absolute + 1e-12 relative; all other leaves are exact.
4. Review the three self-contained .ajs files; no imports or real I/O capabilities. Each has its own UTF-8 encoder and incremental hash closure to satisfy the one-module source contract. No extra agents or production edits.
5. Use the exact inline child program and cases in execution.json. First invoke each fixture natively once in an isolated VM/process. Compare the ENTIRE returned structure to pre-existing independent expected output; a native mismatch stops SafeJS for that fixture until explained.
6. If native controls pass, invoke each case three times using a separate Node process with --import tsx and current packages/safejs/src/run.ts, explicit entryPointArgs, Budget and watchdogs. Retain stdout/stderr, errors, signal/exit status, complete expected/actual output and call arguments after EVERY attempt via apply_patch. Do not rewrite failures.
7. Validate report counts, evidence links and runtime/source fingerprints. Explain unsampled branches and adaptations; do not infer global conformance or statistical accuracy from these tiny inputs. Do not edit root reports, activity or inventory from this family; the original frozen-root instruction is historical, not a current global freeze.

## Ordinary inputs and representation

All keys are short normal labels or published ordinary-string vectors, including a pangram, Greek pi, accented café, a combining accent and a teapot emoji. Empty input and empty chunks are ordinary streaming initialization/flush cases. Seeds are fixed. No generated workload targets collisions, attacks or resource limits. Budgets are operational stop conditions, not audited features.

UTF-8 encoding occurs before byte partitioning. A partition may divide an encoded scalar; incremental hashing consumes bytes, not incremental Unicode decoding. Raw imurmurhash UTF-16 code-unit packing is NOT represented as canonical UTF-8: the adapter passes only binary strings with code units 0..255. No normalization, malformed UTF-16, Buffer or typed-array semantics are claimed inside SafeJS.

HLL is a 32-bit Go-to-JS algorithm port of DataDog Add/count/Merge, with Math.clz32 replacing bits.LeadingZeros32 and dense arrays replacing []uint8. It emits diagnostic raw/estimate values plus Math.floor for the original unsigned-integer count result. Count-min is the JavaScript/TypeScript Callidon update/count/merge algorithm with three fixed independently seeded MurmurHash rows replacing its xxhash-based index provider. Its entire original hash-provider/serialization/class API is NOT claimed compatible. Dedup/index is audit-owned composition using exact IDs and original keys, not approximate hash equality.

Original constructor/prototype methods become record-owned closures; upstream multiplication expansions become Math.imul. Incremental switch fallthrough, partial-word state, full-block loop, tail finalization and nonmutating result are preserved. The original source and licenses are available under originals/.
