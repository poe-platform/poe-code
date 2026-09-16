# Drawing part ownership

Close inherited `Shape.part` using the established package owner binding, without
changing XML editors or allocating another package view.

Original TDD procedure: create one authored slide, insert a textbox and preset,
assert shared part identity, group both and assert group/nested identity, mutate
a nested name and inspect live bytes, and reject detached ownership. Run focused
shape and slide regressions and maintained package lint. JSON `xml get` parity is
covered by the preceding slide-part contract test and uses the same `PartView`.

Progress: original test failed with undefined textbox `.part`; getter plus bound
part propagation passes. Existing inherited media/placeholder getters are
consolidated into the same base behavior. Maintained package lint passed; focused owner/drawing tests passed.
Combined unit/build results are recorded in the root integration receipt.

Validation checkpoint: seven focused suites passed all 35 tests. Package lint
passed ESLint and production types, while concurrent red layout tests blocked
test-type completion. Evidence retains that distinction.
