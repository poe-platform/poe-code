# Minimal fixture correction v2, frozen before continuation

Pre-execution v2.1 clarification: beb75cdf was never executed. Its reviewer-only
rename operations are ordered before inserting carried filenames so original
CAPTURE-01/RECEIPT-01 integrity bindings cannot be renamed. No case/source change.

Original recipe/cases/harness remain at1c6d0983760d81c6dad2303b8cba96ccd74ac709.
The first host completed31 cases (30 predicates pass, one framework miss) before
its own lazy stdout initialization hit the network constructor denial. It wrote
CAPTURE-01 and RECEIPT-01, then summary logging hit the same problem: observed
exit1, intended stop90. EXECUTION-01 preserves the discrepancy and diagnostic.
This is a review-host fixture defect, not an actual child/network attempt.

Genuine minimal correction: initialize the trusted host's already-open stdout and
stderr descriptors **before** installing the same capability denials. No candidate
capability is enabled. Preserve all original source, modes, expectations, fault
placements and raw failures. Do not repeat the31 completed cases. Continue only
the18 originally frozen, never-executed controls: observer suffix index31 plus
the eight direct controls. No new control or altered acceptance predicate.

The classified wrapper authenticates its correction commit's complete owned tree,
including the first capture, then deterministically adapts only the *reviewer*
harness's census/carry-forward bindings, remaining-case selection, and exclusive
CAPTURE-02/RECEIPT-02 output names. Whole candidate module bytes are never changed.
The original6 controls retain first-capture outcomes, not rerun/new passes.
Runtime captured effective-harness hash witnesses the wrapper's exact transform.

Limits and effect denials remain those of RECIPE. Two extra output files only;
one bounded interpreter continuation, no subprocess except readonly pre-load Git
tree authentication, no real observer children. Init stdio is an existing-FD
wrapper, not a network connection. Require before/after hashes and exact census
of original and correction files including detection of appended entries.

Invoke after the explicit correction commit, with REVIEW_FREEZE=1c6d098... and
CORRECTION_FREEZE=<full correction commit>, the same Node/options and data-URL
loading of continue-v2.mjs.data. Both host runs remain nonzero if any predicate
fails. No further automatic rerun, broadening, or product/source patch.
