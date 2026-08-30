# Native-oracle acceptance addendum

This additive record follows the original preparation commit. It does not change MATRIX, programs, fixtures, raw observations, PRESEAL or DATA results.

ROOT now accepts qualified use of the 37 native observations following Poincare's DATA audit **3afa86d9d43d47a6dbc755feb86f3916d91c935a**, tests/compatibility/bash-functional-observations-review-20260829/REPORT.md. The report bytes are authenticated in this packet's receipt. Earlier pending-audit labels accurately describe the first preparation snapshot; this addendum supplies the later disposition. Source candidate bf079ada still awaits ROOT acceptance/admission-order proof; no build/product execution permission follows.

580 stdout bytes + 679 stderr bytes; 33 zero and four nonzero statuses are observations, not passes. B26/B27/B28 remain withheld. All raw comparison fields remain unchanged.

## Version-specific classification overlay (not goldens rewrite)

- **B20/B21:** Bash 3.2 lacks mapfile/readarray; allowed failed lookup plus a final zero status is not successful feature support. Matching failure in the virtual candidate proves no implementation.
- **B23:** native status zero hides read -N invalid-option diagnostics. Native stdout is E|; output file is O. Candidate source supports -N. A different virtual output here must not become a fabricated Bash 5.3 regression. Also retain actual file-mode differences independently.
- **B24/B36:** native syntax errors for |& / ;& are Bash 3.2 observations. Candidate source implements newer grammar. Exact raw inequality remains visible but is not a requirement to reject these constructs.
- **B32/B38:** nounset termination and intentional exit7/EXIT trap effects remain their exact observed tuples; status nonzero does not erase their useful semantic evidence.
- **B39:** missing-command lookup is deliberate, not external-exec permission. Diagnostic shell-name/line context remains raw.
- **B40:** NUL/UTF8 bytes must survive unchanged; strings alone are insufficient.

No row is claimed as a Bash 5.3 native golden. Source-level feature references do not establish current GNU 5.3 conformance or actual execution. There is no version substitution, normalization, native retry or virtual observation yet.

The audit distinguishes newly preserved supplementary 51-known-start closure from original immutable evidence. Repository approval artifacts do not attest unobserved tool/UI state. Native regular-file completion is not stream EOF; escaped descendants, forced retirement, custom Seatbelt containment, global census and RSS remain unqualified. Historical fence failures and containment9/40 HOLD remain unchanged.
