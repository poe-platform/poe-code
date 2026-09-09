# Species selection on wrapped arrays

At 4428354ad, eleven of thirteen native comparisons failed (95755).
ArraySpeciesCreate used native Array.isArray on the private Proxy carrier, so
wrapped arrays bypassed constructor/species selection and its errors.

Use the shared sandboxIsArray operation for this check. Keep constructor reads
on the original receiver, preserving Proxy get traps and ordinary species
validation. No broad replacement of native Array.isArray checks: view selection,
allocation, flattening and concat have different integration requirements.

Native comparisons cover map/filter/slice/splice/flat/flatMap/concat custom
species, constructor traps, invalid constructors, null species, callback error
precedence, nested wrappers and array subclasses. The concat species case sets
isConcatSpreadable explicitly; default Proxy concat spreading remains pending.
Additional cases verify generic non-array receivers and toReversed do not read
the constructor.

Verification: 113 tests across Proxy species, ordinary species and Proxy array
methods passed (72049); expanded Proxy species plus ordinary array/receiver
tests passed 234 tests across three files (57260). Package TypeScript and scoped
lint passed; both command chains completed successfully.

Proxy-valued species results still need descriptor-definition dispatch. Public
callable Proxy constructors and Proxy checkpoint graphs remain unavailable.
No full-package, push or release claim.
