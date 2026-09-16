# Supplied-metric text fitting

Root AGENTS.md applies; no scoped AGENTS.md exists in packages/pptx or docs.
The coordinator owns this change; no delegation is required. Owned files are
font-metrics.ts and its test, text-fitting.ts and its test, text-frames.ts,
index.ts, command-engine.ts, command-schema.ts, command-text-fit.test.ts,
this plan, and docs/pptx/text-fitting-evidence.md, text-fitting-case-map.json,
font-metrics-evidence.md and upstream-api-audit.md.
No README edits, push, release, or unrelated-file staging.

1. Extend the existing monotone integer search using failing original tests for
   minimum size, explicit wrap, line-spacing multiplier and retained hard breaks.
2. Add synchronous model fitting and async package fitting using supplied metrics;
   resolve shape extents and margins, preserve text and unrelated formatting,
   set all run/end-paragraph fonts and disable metadata autofit.
3. Wire text.fit CLI to the SDK, closed discovery schemas, common selection and
   publication, and fast memfs acceptance tests.
4. Reconcile all source fitting rows in the metric ledger and public fit_text
   contract with the exact JS/security mapping in research evidence.
5. Run maintained package test/lint/build and inspect help/error screenshots.
   Commit each atomic verified improvement locally on main.

## Application QA procedure

Create an original deck containing short text, multiple paragraphs, empty text
and an overlong token. Supply explicitly authored metrics for the chosen font,
fit within the shape bounds, and inspect the saved deck in an available desktop
presentation application. Capture the application view; verify no clipped text,
font size and paragraph spacing, and that an unrelated shape is unchanged.
Record the application/version/font availability and any substitution in
research evidence. Metrics model scalar advances, not platform font shaping;
there is no pixel-identical font promise. If no renderer is available, record
that limitation rather than calling XML inspection visual validation.
All temporary decks/screenshots are QA inputs, not canonical unit dependencies.

## CLI screenshot procedure and execution

Use the maintained `npm run screenshot -- --output /tmp/pptx-text-fit-help.png
--no-header node --import tsx --input-type=module -e '<inline driver>'` route.
The inline driver constructs the source command engine with the explicit test
limits, registers pptxCommands with Shell and MemoryFileSystem, then calls
`Shell.exec` for `pptx text fit --help` and a missing-metrics dry run. Inspect
the PNG for complete help, readable wrapping, explicit metric error and statuses
0/2. The root screenshot-poe-code route does not expose separately injected
virtual-shell plugins. No QA script or screenshot unit test is introduced.

Application QA was attempted through Computer Use and blocked because Keynote
access was not approved. This is recorded in research evidence, not marked passed.
No alternate UI automation or permission bypass was attempted.

## Verified result

- `npm run test --workspace=pptx`: 68 files, 1,812 cases passed on final code.
- Focused original fitting/metric/command suites: 47 cases passed; package unit
  cases use memory, with memfs for metric/package I/O and no binary fixtures.
- `npm run lint --workspace=pptx`: ESLint and both maintained typechecks passed.
- `npm run build:workspaces -- --workspace=pptx`: maintained dependency closure
  built office-package, toolcraft-schema and pptx successfully.
- Existing adapter regression route: all 88 cases across create.test.ts,
  inventory.test.ts and selectors.test.ts passed through Node's test runner.
- Owned source Prettier check and `git diff --check` passed. The supplemental
  research ledger retains all 73 identities, and every named test resolves.
- Final terminal screenshot was inspected: complete readable help, missing-metric
  error and statuses 0/2. Its SHA-256 is recorded in docs/pptx evidence.
- One atomic implementation commit includes metrics extensions, model/package
  fitting, paired CLI/schema/capability wiring, original tests and evidence.
  No README, ignored QA fixture or unrelated work is included. No push/release.

The model retains its positional defaults and void return; the detached model's
explicit extents and optional sixth layout-options argument are documented as JS
extensions. All earlier deferred fit-text rows now have original behavior or
explicit security mappings. Whole API parity and application appearance remain
unclaimed; the latter requires approved access to a presentation application.
