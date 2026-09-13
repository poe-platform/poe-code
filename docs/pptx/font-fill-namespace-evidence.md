# Font fill namespace regression

The original four cases in `packages/pptx/src/font-fill-namespace.test.ts`
reproduce `invalid-value` when a textbox run receives bold/size formatting before
solid, background, gradient or patterned fill. Structured property edits leave
an inherited default XML namespace. The fill fragments declared only their
explicit prefix, so bounded XML insertion correctly rejected an incomplete
standalone namespace context.

The four fill constructors now retain the destination's escaped default namespace.
XML admission is unchanged. All four original cases pass and preserve the expected
fill type after save/reopen; the broader original guide workflow also exercises
font RGB assignment. No runtime host I/O, native process, network, publisher deck
or copied reference fixture is involved.

The root reran these four cases alongside the shape owner and public drawing
suites: 20 tests passed in 1.36 seconds total. Combined maintained checks are
recorded in [the integration receipt](public-closure-verification.md).
The [agent procedure](../plans/pptx-font-fill-namespace.md) records the red/green
sequence. This is a bounded regression fix, not whole drawing API or rendering
coverage. It changes no CLI output formatting.
