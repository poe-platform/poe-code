# Strict fixture type corrections

The maintained safe-bash typecheck during ZIP qualification reproduces errors in
two existing fixture files on base `c1999b441`. The original diagnostics remain
in `/tmp/issue687-typecheck-v2.log`; new ZIP-owned test errors are separate.

- Archive permission profiles assign explicit `undefined` to optional boolean
  capabilities despite `exactOptionalPropertyTypes`. Construct unknown capability
  profiles by omission, retaining the path-specific override and every expected
  write option, byte and status assertion.
- Byte-value decoder mocks use the global `TextDecoder` value as a type where
  that global exposes no corresponding type alias. Correct only the annotation
  and verify unchanged emitted JavaScript.

Validate the current errors first, apply minimal fixture-only corrections, run
the focused runtime cohorts and strict type checks, and keep this improvement in
its own commit. Do not weaken the filesystem contract, compiler settings, test
discovery, historical evidence, or assertions. Root owns Git and delivery.

The focused corrections pass 100 runtime tests. All 138 source assertions remain
unchanged, and the decoder fixture emits byte-identical JavaScript. Five original
compiler errors are preserved in
`/tmp/issue687-typefixtures-red-v2-20260910.log`; the corrected strict compiler and
emission proof is `/tmp/issue687-typefixtures-green-v3-20260910.json`. Runtime
evidence is `/tmp/issue687-typefixtures-tests-20260910.log`. This is scoped
qualification, not a claim that the unrelated pending ZIP work already passes.
