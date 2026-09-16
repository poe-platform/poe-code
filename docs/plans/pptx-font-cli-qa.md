# PPTX font CLI verification

The adapter worker owns this procedure and additions to
`packages/safe-bash/tests/commands/pptx/create.test.ts`. The command engine and
font SDK remain with their assigned owners. No adapter production changes are
needed: the existing adapter injects VFS reads and atomic publication into the
shared engine.

## Procedure

1. Add original memfs shell cases before the operation is implemented. Assert
   literal DrawingML attributes using an independent SAX reader, including
   explicit false, removal for inheritance, retained paragraph defaults and
   unknown namespaced attributes. Preserve the unselected run and input archive.
2. Exercise scoped quoted arguments, dry-run, invalid values and binary pipelines
   through the registered safe-bash command. Run focused maintained checks once
   the package build exposes the new engine.
3. Capture help and a bounded validation error through `npm run screenshot`,
   supplying an inline driver for the actual Shell and injected command engine.
   Root `poe-code` does not expose this capability-injected runtime, so
   `screenshot-poe-code` would capture a different CLI. Inspect the resulting PNG.
4. Admit one existing `docs/pptx/corpus-manifest.json` fixture after verifying its
   exact length and SHA-256. Explicit host reads are QA setup only; run the
   product with admitted bytes and a memory filesystem, without product host or
   network access. Select a real text run, edit formatting, inspect resulting
   XML, and compare every untouched package member. Leave the cached input
   unchanged. Do not download or commit binary inputs/outputs.
5. Reduce meaningful failures to small original regressions. Record results
   separately from broader feature/API completion or slide-rendering claims.

## Evidence

- TDD red: both new shell tests failed against the previous built engine with
  status 2, unsupported operation/options. Command:
  `node --import tsx --test --test-name-pattern='pptx run ' packages/safe-bash/tests/commands/pptx/create.test.ts`.
- After the build, fixture admission exposed two setup defects: the handcrafted
  skeleton omitted required graph structure and its vendor attribute lacked
  `mc:Ignorable`. The fixture now uses an original SDK-created base graph,
  replaces only its slide bytes in memory, and declares the extension ignorable.
  Assertions remain independently authored XML values; generated prefixes are
  resolved by namespace. The binary XML pipeline supplies explicit validation
  limits and slide scope. No production workaround was introduced for these
  setup errors.
- All 85 cases in the three existing safe-bash pptx files passed with
  `node --import tsx --test --test-concurrency=1 --test-reporter=dot packages/safe-bash/tests/commands/pptx/create.test.ts packages/safe-bash/tests/commands/pptx/selectors.test.ts packages/safe-bash/tests/commands/pptx/inventory.test.ts`.
- The screenshot `/tmp/pptx-font-help-20260913.png` exposed a real defect:
  `pptx text runs set --help` returned unsupported-option/status 2. An original
  shell regression now requires help before input admission and visible bold/
  highlight flags. Root owns the command fix. The invalid `--bold yes` error was
  legible, bounded and actionable, correctly reporting status 2.
- Cached corpus fixture `.cache/pptx-corpus/IXPE-Presentation-Template.pptx`
  admitted at exactly 1,202,514 bytes and SHA-256
  `885e923f148cdf4680372abe54496c824ab3a2a2d8a59fd9703d66e0aeb1164c`.
  Public built SDK and actual registered Shell edited object 4 on slide 2,
  paragraph 0/run 0 (SDK coordinates), with Aptos Display, 19pt, explicit false
  bold, inherited italic, RGB 315B8A and highlight FFE8A3. Output was 1,202,618
  bytes with SHA-256
  `3574f9b20aaa90fcd081d295711687c294a46d0c54c6e37d033afeba9773c773`.
  SDK and CLI bytes matched. All 38 package members were decoded and compared;
  only `/ppt/slides/slide2.xml` changed. Independent literal XML expectations
  passed, all document text was retained, and both memory input and cached host
  input remained unchanged. Output remained in memory and was not committed.
- An initial corpus recipe combined an object token with paragraph/run positions
  and received the declared opaque/simple-selector conflict. The accepted recipe
  used slide/shape plus paragraph/run positions. This was not counted as a
  successful token-selection workflow.
- Final rebuilt engine: all 86 cases in the same three safe-bash files passed
  with the command above, including the new help regression. Inspected
  `/tmp/pptx-font-help-fixed-20260913.png`: scoped help now returns 0, all requested
  font options and inheritance semantics are legible without clipping, and the
  invalid emphasis example still returns 2. These are terminal screenshots,
  not rendered-slide appearance evidence. The first screenshot is retained as
  disposable failure evidence; neither image is staged.

No README edits, commits, pushes, release, whole-pipeline execution or native
document renderer are part of this worker assignment.
