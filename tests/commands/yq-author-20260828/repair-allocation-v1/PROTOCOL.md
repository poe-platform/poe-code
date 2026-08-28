# YQ allocation-order repair protocol

This author-owned addendum targets only the four source counterproofs in review
commit `4b219eae`.  They are source-level violations of the sealed profile, not
runtime exploit demonstrations and not evidence that all 31 unfulfilled review
obligations are product defects.

The baseline is candidate `35da18547ca82a67be9ca22b4adc21e3b8060780`.
Before product repair, `repair.test.ts` is expected to fail its four structural
admission controls while its public-cap behavior controls retain the fixed
production limits.  After repair, the same controls must pass.  The structural
controls bind the actual changed functions and include reversed-order mutants;
they do not lower a production cap or claim a private threshold is a public
boundary.

The repair may change only `src/commands/yq/**` and
`src/commands/structured/query-core.ts`.  Existing author/independent fixtures,
the accepted interpreter, public wiring, defaults, package exports, and CMD-22
review harness remain untouched.
