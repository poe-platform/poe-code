# Preserved first execution and explicit harness correction

The first isolated run is retained in `attempt-01.stdout.data`,
`attempt-01.stderr.data`, `EXECUTION-01.data` and the complete immutable
`attempt-01-source/` byte copies (a `.data` suffix classifies them as inert).
It had 93 checks: 92 passed and one adapter assertion failed. All 72 frozen
ranking-domain predictions matched; the six declared policy-target conflicts
remained. No model change follows this result.

The adapter counted every enter whose raw node had `group === 2`; a reference
node also carries that number. Required-child therefore counted five entries,
not four. The correction additionally requires `node.kind === 'group'`.
The frozen plans, expectations, model and eligibility are unchanged. One extra
necessary cap-control bundle explicitly exercises node64/arity16/capture16/
repeat32 refusal; these are malformed structural controls, not native inputs.

Hash-only archive inventory now charges four work/two allocation units per byte
before reading, plus existing fixed entry overhead; unlike fixture JSON loading,
it does not parse or construct a data graph. Fixture/source loading retains the
v4 32-unit reservation and both harness limits remain fifty million. Individual
model accounting and all model limits are unchanged. This explicit harness
accounting refinement prevents inert preserved attempt bytes from consuming the
JSON-parser reservation repeatedly; it is not a model quota increase.
