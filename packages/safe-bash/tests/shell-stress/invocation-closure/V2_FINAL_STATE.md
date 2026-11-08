# Final endpoint qualification

Read with `V2_POSTFIX.md`: its statement that all42 runtime dependencies matched
at the **audit endpoint** remains true. At the later commit-preparation seal,
foreign edits to **`src/commands/filesystem.ts` and `src/commands/streams.ts`**
differed from their tested versions. `v2-postfix-final-state.json` preserves the
exact tested-end/current hashes and observed HEAD; the earlier summary is not
overwritten. Frozen shell runtime/BOM hashes, all original/v2 fixture and oracle
hashes, and all raw evidence hashes still match.

Therefore acceptance remains the bounded supported invocation semantics on the
recorded stable per-phase dependency snapshots, **not the later changed tree**.
No within-runtime-phase guard failed. The separate global compiler guard did
fail on foreign jq.ts during compilation despite exit0; build and benchmark
passes likewise apply only to their recorded snapshots. No source fix, expanded
scope or retry loop was attempted. All166 captured process groups remain stopped.
