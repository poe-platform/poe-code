# Structured presentation text reading

Scope: implement F15 read-only extraction, with F20 Unicode retention and F21
cached-field distinction. This task does not execute the full presentation
pipeline or claim the proposed live object model is complete.

Ownership: SDK worker owns the extractor, its tests and public export; command
worker owns command schema/dispatch and adapter acceptance; research worker owns
the dedicated text-reading case accounting. Root reviews, verifies and commits
explicit owned files on main. Existing uncommitted work remains untouched.

Required behavior: traverse slides in presentation-list order, drawing objects
in shape-tree order, nested groups depth first and table cells row first. Preserve
paragraphs, runs, soft breaks, cached fields and empty strings. Notes, layouts
and masters require explicit scope. Hidden slides and duplicate placeholders
remain distinct structural content. Structural order is not visual reading order.

Validation procedure:

1. Reproduce missing extraction through failing original SDK and command tests.
2. Assert authored expected Unicode strings and exact structural records; use
   memory bytes and memfs for I/O. Cover scope isolation and source immutability.
3. Reconcile relevant parameter variants and BDD cases against the pinned test
   and API inventories; keep unimplemented live model behavior visibly planned.
4. Run maintained package tests, lint and selected workspace build closure.
5. Exercise the registered safe-bash command and inspect an ad hoc screenshot.
6. Authenticate a cached fixture against docs/pptx/corpus-manifest.json before
   disposable read-only QA. Keep all binaries and generated QA outputs ignored.
7. Review owned diffs and create local Conventional Commits. Do not push.

Results:

- TDD first reproduced the absent SDK/command, then empty table extraction and
  lost inherited table compatibility controls. Original regressions now cover
  these failures. Selective opaque-container expansion preserves ancestor rules
  and unrelated opaque payloads; merge retains that configuration.
- `npm run test:unit --workspace=pptx`: 1,250 tests passed in 48 files, including
  32 extraction, 15 text command and 41 compatibility tests. Total wall time
  23.16 seconds; extraction cases took 270 ms in this run.
- `npm run lint --workspace=pptx`: ESLint and both TypeScript checks passed.
- Appendix C and the proposed register now share the structured TextData
  definition. An independent authored JSON example validates; `order: "visual"`
  fails. An initial ad hoc check incorrectly inspected `.valid`; inspection of
  the validator API established `.ok`, and the corrected check passed.
- Research accounting retains 181 unit variants and 50 BDD scenarios separately.
  Seventeen unit and seven BDD rows link extraction semantics to original tests;
  live-model obligations remain explicitly unimplemented.
- Disposable corpus QA authenticated
  `.cache/pptx-corpus/IXPE-Presentation-Template.pptx` against SHA-256
  `885e923f148cdf4680372abe54496c824ab3a2a2d8a59fd9703d66e0aeb1164c`.
  Slides: 20 segments/20 paragraphs/4 fields; notes: empty; layouts:
  23 segments/35 paragraphs/5 fields; masters: 5 segments/9 paragraphs/1 field.
  Input hash remained unchanged. No corpus content was copied into tests.
- Visual QA uses the maintained generic `scripts/screenshot.ts` route because
  this command is registered inside safe-bash, not the root agent CLI targeted by
  `screenshot-poe-code`. The disposable inline invocation constructs a memory
  presentation and registers the real command. Root inspected the screenshot:
  extraction, named-shape selection and rejected unsupported options are legible.
  The capture font lacks a CJK glyph; exact Unicode byte assertions pass in SDK
  and adapter tests. The ignored screenshot is not a committed fixture.
- `npm run build:workspaces -- --workspace=pptx` passed the maintained three-build
  dependency closure after the final source changes.
- `node --import tsx --test --test-reporter=dot packages/safe-bash/tests/commands/pptx/selectors.test.ts`
  passed all 43 adapter tests, including actual stdin and SDK parity. Existing
  integration input registration already includes this test file.
- Focused ESLint passed for the command engine/schema/test and modified adapter
  test. `git diff --check` passed. Final screenshot was recaptured and inspected
  after the selected build, with expected command statuses 0/0/2.

The implemented slice is F15 extraction with Unicode and cached-field retention.
Fine-grained paragraph/run/cell/table selectors, text mutation, chart text and the
live object-model API remain unimplemented. No full-product or visual-order claim,
whole-pipeline execution, push or release is part of this task.
