# Text frame command verification

## Scope and ownership

The command worker owns `packages/pptx/src/command-engine.ts`,
`command-schema.ts`, `command-text-frames.test.ts`, and the frame case in
`packages/safe-bash/tests/commands/pptx/create.test.ts`. The SDK worker owns
frame domain behavior. The existing adapter delegates admitted byte arguments,
VFS reads and package publication; no adapter production changes are needed.

## Procedure

1. Write original memfs tests before command implementation; inspect literal
   DrawingML attributes independently for EMU conversion, signed rotation,
   wrapping, anchors, columns, vertical text and autofit metadata.
2. Verify normalized read schemas, closed mutation schemas, ordinary flags,
   nullable clearing, Unicode text replacement, invalid arguments before I/O,
   empty collection reads and explicitly allowed empty mutation.
3. Run a virtual `.sh` file through the registered shell, piping binary package
   output into bounded XML inspection. Preserve original mixed font metadata
   and unknown namespaced attributes. Keep all unit assets in memory.
4. Run maintained pptx lint and unit checks; after the coordinated workspace
   build, run the existing three safe-bash pptx test files and focused lint.
5. Use the maintained `npm run screenshot -- --output /tmp/pptx-text-frame-help-20260913.png --no-header node --import tsx --input-type=module -e '<inline driver>'`
   route with a MemoryFileSystem, explicit engine limits and registered
   `pptxCommands`. Invoke scoped frame help and an invalid columns value;
   inspect the PNG for readable complete output and correct statuses. The root
   `screenshot-poe-code` command does not expose separately injected virtual
   shell plugins. Do not add a QA script or screenshot unit test.

## Evidence

- Initial TDD run: three meaningful failures for unsupported frame mutation,
  schema/help and collection read routes; remaining invalid-option cases
  initially passed through generic rejection.
- Original text replacement/nullable-clear regression added before verification.
- Sixteen frame command cases pass, alongside the neighboring paragraph and
  run cases. Frame list initially exposed a missing-shape selection error;
  the SDK worker corrected empty collection/allow-empty behavior.
- The registered-shell frame case was first red against stale built output.
- Maintained `npm run lint --workspace=pptx` passed. Focused ESLint on the
  edited safe-bash test passed; `git diff --check` passed on owned files.
- After the coordinated maintained workspace build, all 88 cases in the three
  existing safe-bash pptx test files passed using `node --import tsx --test
  --test-concurrency=1 --test-reporter=dot` with their exact paths. The new case
  verifies a real virtual script, binary pipeline, signed insets, vertical text,
  font/extension preservation and independent XML assertions.
- Visually inspected `/tmp/pptx-text-frame-help-20260913.png`: complete readable
  frame help, metadata-only autofit distinction, help status 0 and invalid
  columns status 2. The screenshot used the source engine through the actual
  registered shell and a MemoryFileSystem; no input read was needed.
- Final review added two original failing schema cases for preserved raw
  `just`/`dist` anchor values. Read-result schemas now admit both; write schemas
  and command arguments reject both. All 18 command cases pass. Domain tests
  separately verify actual XML retention. Help/capabilities explicitly limit
  the resource to shape text frames, excluding table cells. Visually inspected
  the updated `/tmp/pptx-text-frame-reviewed-help-20260913.png`; all scope and
  metadata limitations remain complete and readable with statuses 0 and 2.

This verifies terminal behavior and metadata preservation, not rendered slides,
font measurement, or supplied-metrics text fitting. No fixture download, README
edit, push, release or whole-pipeline execution belongs to this procedure.
