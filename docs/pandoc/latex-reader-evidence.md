# LaTeX reader verification

Original tests were authored before implementation. Initial execution had 22
failing LaTeX tests due to the absent capability (the primitive-refusal tests also
matched that unavailable-capability error until the reader was implemented).
Subsequent failing original cases validated include directory propagation and
aggregate byte charging, nested-group whitespace, starred raw command arguments,
repeated captions, escaped link targets, reference-title cycles, empty tables and
float column/rule attribute retention before their fixes.

Final maintained checks on main:

- `npm run test --workspace=@poe-code/pandoc`: 21 files, 676 tests pass; 47 original
  LaTeX cases and one new memfs command case. Forbidden primitives are exercised
  under strict, retained-raw and lossy conversion, after the reader is bound.
- `npm run lint --workspace=@poe-code/pandoc`: ESLint, source TypeScript and test
  TypeScript checks pass.
- `npm run build:workspaces -- --workspace=@poe-code/pandoc`: selected maintained
  workspace build passes uncached.
- `git diff --check`: passes for task changes and the current working tree.

Unit mutations use memfs. Resources, cancellation and publication are injected;
unit cases invoke no host scratch files, external executables, LLMs or downloaded
fixtures. No native fallback or third-party implementation/test bodies were added.

The repository screenshot renderer executed the built thin command with memfs.
[The inspected screenshot](latex-command.png) shows included source, strict refusal,
complete retained raw command/arguments with diagnostics, and missing include with
no emitted content. The QA procedure lives in docs/plans/pandoc-latex-reader.md.

[The profile](latex-reader.md) and [coverage ledger](latex-coverage.json) distinguish
strict failures, diagnosed raw preservation, lossy outcomes and unsupported
prototypes. They record bounded original behavior, without promoting the upstream
research inventory to full conformance. A destination writer can still refuse raw
or math content under its own policy.

Delivery: one verified local feature commit on main. Remote push and release are
not authorized. Unrelated working-tree changes are preserved and excluded.
