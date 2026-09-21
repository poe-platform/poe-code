# Configurable text exporter independent current stress QA

Independent worker ownership: field quoting and intermediate output-budget
admission only; root retains exporter selection, engine integration and Git.
No README, integration, encoding implementation, or Git edits were made here.

## Manual procedure

1. Authenticate `out/ssconvert-lifecycle-oracle/gnumeric-1.12.61.tar.xz` using
   SHA-256; require `2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12`.
2. Inspect released `gsf-output-csv.c` quote-trigger, Unicode-space, and
   per-scalar quote doubling paths. Use the independent native oracle container
   `ssconvert-statistics-qa`, never product native invocation.
3. Build an original eight-row Gnumeric XML fixture under `/out` with U+0085,
   U+180E, U+FEFF, U+00A0, U+2028, U+2029, U+3000, and two distinct emoji.
   Export defaults under the captured C profile, then Unicode multichar quotes
   under both C and C.UTF-8. Inspect statuses, stderr and exact output bytes.
4. Run the independent in-memory unit cases, including byte-budget boundary and
   its smaller-budget/expanding-encoding negative controls. Unit tests must not
   spawn the oracle, write files, or query LLMs.
5. Run maintained package tests/lint/build through root's gate coordinator.
   A focused direct test invocation is local semantic evidence, not a completed
   maintained workspace gate.

Results are recorded separately in
`docs/ssconvert/configurable-current-verification.md`.

## Supplemental installed-locale converter ordering check

Manual procedure: create one original XML string cell `é € 漢 😀` under `/out`;
invoke the pinned native executable with LC_ALL=C and `charset=ASCII
transliterate-mode=transliterate`, independently varying the export `locale`
property over C, C.UTF-8 and bogus. Inspect raw bytes, status and stderr for each.

Compare each result with the SDK engine and record findings separately in the
verification document. Do not infer parity for unavailable locales or other
transliteration profiles. Purge temporary fixtures after summarization.
## Installed-locale converter ordering procedure

Create one original XML string cell `é € 漢 😀` under `/out`; invoke the pinned
native executable with LC_ALL=C and `charset=ASCII transliterate-mode=transliterate`,
independently varying the export locale property over C, C.UTF-8 and bogus. Inspect
raw bytes, status and stderr for each. Purge fixture and captures after inspection.
Record outcomes in `docs/ssconvert/configurable-current-verification.md`.

## Final candidate budget and callback procedure

For ASCII `漢漢`, UTF-16LE `漢漢`, and ISO-8859-1 `éé`, execute each of automatic,
raw and preserve modes using the exact expected final byte budget and one byte
less. Compare exact bytes for successful cells and inspect rejection diagnostics
for negative cells. Exercise an injected numeric formatter that attempts both
mutation of the frozen rendering limits and replacement of the rendering-context
limits property, then returns over-budget text. Require original final byte
admission and unchanged caller limits. Abort inside an awaited formatter and
require the precise caller cancellation reason identity. Record candidate hashes
and outcomes in `docs/ssconvert/configurable-current-verification.md`.
