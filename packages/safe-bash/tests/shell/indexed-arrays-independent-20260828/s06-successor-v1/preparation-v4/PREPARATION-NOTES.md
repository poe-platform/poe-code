# Preserved preparation failure

2026-08-28: the first DATA-only invocation of `prepare-seal.mjs` exited1
before creating SEAL.json or launching any test/child. The new consistency
check incorrectly read `harnessMutants.mutants`; the existing exact binding
uses `variants`. Diagnostic:

```text
prepare-seal.mjs:23
for (const mutation of harnessMutants.mutants) {
                                      ^
TypeError: harnessMutants.mutants is not iterable
Node.js v22.22.2
```

The preseal generator now reads the actual `variants` field. No fixture,
expected predicate, mutant bytes, product input or prior seal was changed.
This was a source/data preparation failure, not an array result or a control
pass; it remains preserved here before the first sealed control execution.
