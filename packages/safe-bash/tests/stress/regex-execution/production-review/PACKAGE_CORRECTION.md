# Package harness readback correction

The first independent package consumer exited zero and the archive worker hash
matched, but `evidence/production-final/package.json` prints
`file:///Users/kjopek/Workspace/safe-bash/dist/index.js`. The consumer fixture
had no own package boundary, so Node's package self-reference resolved the
surrounding repository rather than the extracted product. Its passing harness
label, including `evidence/audit.json.packagePass`, is a retained false positive
and is NOT accepted as a moved-product smoke. Source replay results are separate
and imported explicit frozen snapshot paths, so this does not rebaseline them.

Fix only this owned fixture: create a distinct consumer package.json, assert
that import.meta.resolve points inside the moved node_modules/virtual-bash,
and rerun the same public command/declaration smoke once under unique evidence
label `package-corrected`. No product source, expectation bytes, original
evidence, risky reservation, or broad suite changes. The original raw result
and erroneous aggregate label remain immutable for audit.
