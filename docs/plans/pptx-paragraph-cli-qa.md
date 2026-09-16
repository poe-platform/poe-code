# Paragraph command verification

## Ownership and scope

The command worker owns paragraph discovery, parsing and shared-engine routes in
`packages/pptx/src/command-engine.ts`, operation schemas in `command-schema.ts`,
original command regressions in `command-text-paragraphs.test.ts`, and the
paragraph case added to the existing safe-bash `commands/pptx/create.test.ts`.
The adapter already delegates byte argv, VFS input and publication to the engine;
no adapter production changes are needed. Root owns domain integration, corpus
admission, research reconciliation and commits.

## Procedure

1. Add original memfs command cases before implementing routes. Independently
   inspect literal DrawingML values for zero, negative indentation, point/EMU
   conversion, multiple line spacing, RTL numbering, tabs and null clearing.
2. Check list/get cardinality, closed discovery schemas, scoped help, invalid
   values before reads, conflicting projections and ordinary flags. SDK point
   fields remain the normalized schema; CLI explicit lengths and ordinary
   direction/numbering/bullet flags project to those fields.
3. Exercise an actual virtual `.sh` file and binary pipeline through safe-bash,
   preserving mixed runs and unknown namespaced metadata. Use original in-memory
   assets only. Declare XML validation limits for the pipeline reader.
4. Run maintained pptx lint/unit routes and focused existing safe-bash command
   tests after the selected workspace build. Root coordinates builds.
5. Capture actual registered-shell scoped help and one invalid direction using
   `npm run screenshot -- --output /tmp/pptx-paragraph-help-20260913.png
   --no-header node --import tsx --input-type=module -e '<inline driver>'`.
   The inline driver creates a MemoryFileSystem, explicitly bounded engine and
   registered `pptxCommands`, invokes `pptx text paragraphs set --help` and
   `pptx text paragraphs set deck.pptx --all --direction sideways --dry-run`,
   and prints stdout/stderr/status. Root `screenshot-poe-code` cannot invoke this
   separately injected virtual-shell command. Inspect the PNG; retain it only
   as disposable QA output, never a unit-test snapshot or shipped fixture.

## Evidence

- Initial TDD red: the paragraph mutation and schema assertions failed because
  the routes/options were unsupported. Implemented routes then passed.
- Numeric JSON tab lengths now convert before lexical formatting: a tiny positive
  number previously became exponent notation and was rejected. An original red
  regression now passes with zero-EMU rounding; colliding rounded tabs reject.
- Review found hexadecimal and whitespace line-spacing multiples accepted by
  `Number`. Two original failing cases demonstrated status 0; explicit decimal
  parsing now rejects both before reads. Empty level was already rejected by
  generic argument validation; its new case records that behavior.
- `npx vitest run packages/pptx/src/command-text-paragraphs.test.ts`: 17 passed,
  including ordinary bullet/direction/numbering flags, Length tab records and
  aligned Length positions. The neighboring run command suite also passed.
- `npm run lint --workspace=pptx` passed after command/schema integration.
- All 87 cases in the three existing safe-bash pptx files passed with
  `node --import tsx --test --test-concurrency=1 --test-reporter=dot` and their
  explicit paths. Focused ESLint on the edited safe-bash test passed.
- The new virtual-script case initially failed against old package output; after
  the maintained build it exposed missing validation limits in the QA fixture.
  Supplying explicit limits fixed the fixture; no product workaround was added.
  The case passes through `sh paragraphs.sh`, binary stdout and `xml get -`.
- Visually inspected `/tmp/pptx-paragraph-help-20260913.png`: complete legible
  help, no clipped options, correct 0 status; invalid direction is a bounded
  actionable diagnostic with status 2. This is terminal QA, not rendered slide
  appearance or line-wrapping evidence.

No README, download, release, push or whole-pipeline execution is performed here.
