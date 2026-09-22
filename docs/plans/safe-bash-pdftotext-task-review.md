# behavior-pdftotext task review

Inspected 2026-09-21. **Incomplete; unresolved findings block completion.** This is a current-source review, not implementation or compatibility qualification.

## Validated findings

1. `packages/safe-bash-command-pdftotext` does not exist, and `packages/safe-bash/package.json` contains neither its dependency nor `./commands/pdftotext`. Consequently there is no task runtime diff to review or command to exercise through CLI, SDK, cancellation, VFS publication, or installed consumers.
2. The required extraction inputs are absent. A search of package TypeScript implementation sources, excluding dependencies, generated output, tests and fixtures, for `ActualText`, `ToUnicode`, `GlyphRun`, `ParsedGlyph`, `parsePdf`, `parsePDF` and `PDFParser` found only an unrelated IDNA `ToUnicode` comment. The shared [parser plan](safe-bash-pdf-parser.md) explicitly leaves `pdf-security`, `pdf-font-text`, `pdf-extraction-layout` and `pdf-parser-api` implementation open.
3. `packages/pdf/src/index.ts` exports `renderPdf` for generation, not extraction. Its manifest declares `pdf-lib`, `@pdf-lib/fontkit` and `pako` runtime dependencies. Generated glyph placements are not source glyph/CMap/ActualText provenance and cannot establish the requested geometry or unsupported-mapping behavior.
4. The [command plan](safe-bash-pdftotext.md) marks both engine and behavior implementation done, but the [engine handoff](safe-bash-pdftotext-engine-prerequisites.md) and [behavior handoff](safe-bash-pdftotext-behavior-prerequisites.md) explicitly report no implementation. These status entries do not establish acceptance. They are existing unrelated edits and were preserved; this review records the discrepancy rather than changing them.
5. The requested package-pattern path was moved by existing edits. Its [archived copy](archive/safe-bash-command-package-pattern.md) remains available and requires real command implementation, shared parser ownership, bundled declarations and canonical contract identity. It does not support an empty command scaffold or a replacement substring extractor.

## Completion requirements

The [acceptance matrix](safe-bash-pdftotext-acceptance.md) remains open. Accepted bounded parser/font/security and logical/raw/physical layout APIs are needed before dependent integration, as required by the command plan's execution gate. Original native fixture bytes and full receipts also remain unavailable locally; supplied observations must retain their existing provenance.

Once those prerequisites exist, begin with failing memory-VFS tests for normalized/reversed page ranges, mode-specific crop/slice geometry, XML metacharacters and six-decimal boxes, encoded EOL/space/final and blank-page formfeeds, unresolved glyph diagnostics, and alias/conditional-write failures. Test CLI and SDK against the same admitted behavior. Verify input, decoded, retained and output accounting, parser/algorithm work and recursion, cancellation and cleanup on every exit before marking cells complete. Select and qualify the permission profile explicitly. Installed runtime and declaration consumers must work without the private workspace.

Only this review was added. No runtime code, tests, manifests, existing plans or unrelated edits were changed. No tests, screenshots, build, commit, push or release were run; none would qualify an absent command. No implementation or acceptance cell is claimed complete.

## Current wiring follow-up, 2026-09-21

The preceding inventory describes an earlier workspace state. The current private
`safe-bash-command-pdftotext` package exists with an actual CommandDefinition,
opt-in plugin and SDK. Safe-bash re-exports it at `./commands/pdftotext`, declares
the workspace dependency and admits its implementation through the guarded
private-package build profile. The manifest remains private with no external
runtime dependencies. Existing installed-consumer fixtures exercise admission,
not extraction. Their presence is not a current installed-artifact verification.

A failing memory-only test reproduced a CLI/SDK mismatch: SDK resolution `1e-7`
became the rejected CLI token `1e-7`, while literal `0.0000001` succeeded. SDK
serialization now expands finite exponent notation to decimal operands before
the shared parser. Controls cover both small and large exponent values and
compare status, stdout and stderr. The 30 package tests pass after this repair.

Unresolved findings continue to block task completion:

- Every extraction invocation still fails with an unavailable-engine status 99.
  There is no qualified PDF security/font/CMap/ActualText/layout implementation,
  so native document/output/permission statuses and glyph geometry cannot be
  exercised. Pure supplied-text encoding and bbox helpers do not fill that gap.
- SDK raw passwords are unavailable and no permission-enforcement compatibility
  profile is selected. CLI truncation alone does not satisfy those requirements.
- Extraction input/output ownership, resource accounting, cancellation, named
  output effects, metadata recovery and original native text controls remain
  unverified because extraction does not acquire input or create output.

The current invocation layer awaits byte writes, forwards its signal to output,
registers cleanup before output acquisition, drains owned writes and bounds
argument/output admission. No host executable, runtime download or network
fallback was found in the command sources. Those admission controls establish
neither extraction safety nor full Poppler compatibility. Unrelated workspace
edits were preserved; no publication was attempted.

Fresh follow-up verification: package ESLint and source/test typechecks passed;
both memory-VFS shell wiring tests passed; the maintained guarded
`npm run build:workspaces -- --workspace=@poe-platform/safe-bash` closure passed.
All three private-command bundle recipe tests also passed.
Installed-consumer execution, screenshots and native extraction controls were
not rerun. Local commits: none. Verified remote-main delivery: none. Successful
release: none.
