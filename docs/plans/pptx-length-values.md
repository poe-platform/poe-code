# Length values for paragraph spacing

Paragraph model spacing must distinguish absolute lengths, numeric line
multiples, and inherited null. Implement immutable safe integer EMU values with
neutral `Length`, `Emu`, `Inches`, `Cm`, `Mm`, `Pt` and `Centipoints` constructors.
Keep conversions in the pptx package and reuse them from paragraph properties.

Use original TDD cases for every applicable constructor/accessor variant,
negative halfway rounding, fractional input, unsafe/nonfinite rejection,
coercion rejection and inherited accessors. The focused research map is
`docs/pptx/length-case-map.json`; JavaScript values are objects, never numeric
subclasses. Centipoint inspection floors negative values; input conversion
rounds nearest with halfway values away from zero.

The standalone value implementation and its original tests form one atomic
improvement. Public exports and its paragraph consumer follow in the paragraph
formatting commit. This ordering does not claim the helper is a public export
before that integration commit. No README, network, ambient I/O, push or release.

## Verification

The initial tests failed before the value module existed. Focused tests and
package lint passed. Final maintained verification: selected workspace build
closure passed; `npm run lint --workspace=pptx` passed; `npm run test
--workspace=pptx` passed all 1,649 cases, including 27 original length tests.
