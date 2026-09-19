# csvstat final Decimal metrics QA

1. Reproduce the frozen CPython square and symmetric-pair variance discrepancies
   with failing in-memory regression tests before changing arithmetic.
2. Inspect CPython 3.14.2 libmpdec integer power source. Implement its
   precision-31 square followed by precision-28 half-even finalization, preserving
   special values and the finite zero preferred exponent.
3. Have an independent agent stress the registered command against the hash-locked
   csvkit 2.2.0 reference and independently sample Decimal square behavior.
   Compare exact output, status and virtual filesystem effects. Retain original
   discrepancy captures unchanged; record subsequent qualification separately.
4. Run uncached domain unit/lint/build checks and focused registered-shell and
   integration-discovery checks. Inspect a screenshot of a built csvstat report.
5. Record results and remaining blockers in docs/csvkit. Purge only evidence
   acquired during this QA. Preserve unrelated files, staging and README content;
   do not commit, push or publish.
