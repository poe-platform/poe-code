# V9 native strict-rejection predicate overlay

This bundle repairs only the immutable V9 `native-env.mjs` strict-rejection
classifier. It does not edit the V9 fixture, Raman's lineage overlay, its raw
captures, product code, case inputs, environment bindings, expected stdout,
status rules, order, budgets, or any success-row matcher.

The source is Raman commit
`d53b003b9e7a20a3a593378a9b7a9ed8e896c493`, specifically the authenticated
`native-environment-table.json` bound in `manifest.json`. Its three intended
failure rows have status 1, empty stdout, and the same exact 40 stderr bytes:

```json
"du: invalid -B argument 'invalid-value'\n"
```

Hex is
`64753a20696e76616c6964202d4220617267756d656e742027696e76616c69642d76616c7565270a`;
SHA-256 is
`927dbaaabbcd6f07c69e90d54e68af1d9f353275c4455837191ea77460d77009`.
There is no leading space. Program name, punctuation, quotes, value, and final LF
are all required; extra output is rejected.

## Raman handoff

Use the existing authenticated V9-plus-lineage materialization. Preserve the
lineage overlay's sole `harness/verify-v5.mjs` change. In that owned materialized
copy, require `native-env.mjs` SHA-256
`e537055e0b7516e2a2ddcd520f5197625334d2493b1b238d82b99edc94fd7def`
before applying `native-env.mjs.patch.data`; refuse any other base. Apply with
`git apply --check` followed by `git apply` from the materialized fixture root,
then require SHA-256
`e7c62a3c7976163c684f68f63efd2a95f0b7ea43481a887a5bcd32832b35b9eb`.
The patch path is relative to that fixture root and changes one expression on
line 71. The immutable base and old captures remain untouched.

Raman's remaining authorized work is one execution of only the original 16
native rows plus focused negatives. The original 13/16 remains historical. The
success-only tail and complete recipe were not run, and this bundle makes no
16/16, aggregate-success, or all-green claim.
