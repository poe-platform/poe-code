# Independent results v1

| Cohort | Result | Interpretation |
| --- | --- | --- |
| Exact candidate, 12 runtime records | 10 pass / 2 fail | H04b and H07b are source assertions. |
| Relocated INTERNAL emitted ESM, same 12 | 10 pass / 2 fail | Same failures; not extra holdouts. Original source/build removed first. |
| Strict source + positive fixture | exit 0 | Actual declarations compile with strict, exact optional, unchecked indexing. |
| Six malformed signal rows | six targeted diagnostics, expected exit 2 | null, controller, promise, string, incomplete structural object, number. |
| Relocated declaration positive | exit 0 | Internal direct-module consumer only. |
| Relocated declaration negatives | same six targeted diagnostics | TS2322/TS2739/TS2740; no missing imports. |
| Provenance counterfactual | compiled; killed by candidate-passing H01 | Original signal replaced by frame delivery signal in report. |
| Capacity counterfactual | compiled; killed by candidate-passing H08 | Capacity guard disabled. |
| Listener-cleanup counterfactual | compiled; killed by candidate-passing H10 | Close omits listener removal. |
| v2 sealed-object replay | unchanged runtime/type/mutant result | Instrumentation refinement, not a new or rescored cohort. |

All three mutant builds pass. Kills require relevant behavioral assertions that
pass on the candidate; the two existing candidate failures cannot kill mutants.
Raw mutant logs intentionally retain all failures, including preexisting ones.
No fixture/compiler/load failures are counted as kills. There were no test-runner
corrections; the one pre-execution tool authoring rejection is in REVISIONS-v1.

Emitted and moved JS SHA-256:
`a77d885824a0cfa4f454d9c574cc361aa9ea5507c7f62bd52f2ecc8a98254a28`.
Emitted and moved declaration SHA-256:
`67b90043f40ef0c5a53ae0be912351cb05f51707523ca4a3ae4e7d8b9f432e65`.
These agree with the author artifact identities but were independently compiled.

The orchestrator exits 0 when evidence collection finishes, EVEN WHEN candidate
runtime status is 1. Read summary.json and TAP, not orchestrator exit alone.
Author 22 suite not rerun; author 38/22/4 counts are not independent evidence.
No current runtime/public seam, global gate, integration, or completion claim.
