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

The executable controls additionally use the real command path for a fixed
8,388,608-byte raw-document boundary, the real parser and fixed 1,048,576-byte
scalar boundary, and the actual YAML/JSON encoder fragment paths.  The small
encoder `maxBytes` argument cases are internal proof controls, not public cap
boundary claims.  The raw-document control proves C+1 rejection with CRLF; it
does not call a lowered threshold a public boundary or claim an at-C success,
because parser work reaches its independent fixed work cap on that synthetic
comment payload.

The repair may change only `src/commands/yq/**` and
`src/commands/structured/query-core.ts`.  Existing author/independent fixtures,
the accepted interpreter, public wiring, defaults, package exports, and CMD-22
review harness remain untouched.
