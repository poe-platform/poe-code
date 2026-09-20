# CommonMark block phase

Implement only the original TypeScript CommonMark 0.31.2 block phase in
`packages/pandoc`, following `docs/pandoc/contract.md`. Keep pending inline
source distinct from final AST text and do not activate a reader capability.

1. Write original failing structural cases, including container continuation,
   ambiguity, literal preservation, references, source ranges and bounds.
2. Implement a bounded line scanner and container parser with no native fallback.
3. Run the maintained Pandoc unit, lint/typecheck and selected workspace build.
4. Record evidence in `docs/pandoc` and commit explicit owned paths on main.

QA: inspect independent expected block trees; check tabs/indentation, lazy
continuations, list tightness/interruption, fences, all HTML block categories,
definitions, CRLF/EOF, source coordinates, cancellation and lowered ceilings.
No UI changes or new conversion capability are part of this task.

Status: block-phase implementation and original tests complete. Maintained
Pandoc tests (319, including 113 block cases), lint/source and test typechecks,
and selected workspace build passed. Evidence is in
`docs/pandoc/commonmark-blocks-evidence.md`. One atomic local commit includes
the parser, Unicode folding data, tests, this plan and evidence. No push or
release authorized. Inline parsing/final AST integration remains outside this
task; CommonMark conversion remains unavailable.
