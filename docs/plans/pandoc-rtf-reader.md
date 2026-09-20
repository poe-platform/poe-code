# RTF input

Implement only the original TypeScript RTF reader in packages/pandoc. Preserve
the existing thin SDK command adapter and unrelated edits. No native fallback.

1. Write original failing byte-input tests for scoped formatting, Unicode,
   destinations, malformed syntax, lists, fields, tables and bounded pictures.
2. Implement a bounded byte group/control parser and a scoped document reader.
   Pin code pages and fail strictly for unsupported content.
3. Run package unit, lint/typecheck and selected workspace build checks; record
   results and supported limits under docs/pandoc. Commit owned paths on main.
   Do not push.

QA procedure: exercise the exported SDK and thin command with original in-memory
RTF bytes; inspect AST structure, output text, diagnostics and retained media.
Use memfs for file-input/output mutation checks. No external executables or
downloaded corpus in unit tests. There is no change to the visual CLI design.

Status: implemented and verified. The declared contract pins 1252/65001; other
encodings fail rather than extending the profile. Paragraph attributes, outline
headings and footnotes are included. Original regression tests first reproduced
each implemented gap. The final maintained package suite passed 821 tests (68
RTF cases), package lint/source/test typechecks passed, and the maintained
selected workspace build passed. Evidence and profile: docs/pandoc/rtf-reader.md.

Executed visual QA: use the maintained `npm run screenshot` route on a Node
invocation of the built `createPandocCommand`, providing original byte stdin.
Inspect GFM heading and nested formatting output plus a strict starred-destination
diagnostic. Capture: docs/pandoc/rtf-command.png. The screenshot renderer lacks the
emoji glyph; byte/AST tests independently assert the correct surrogate scalar.

Delivery: verified reader, tests, plan and evidence form one local atomic
improvement on main. No push or release authorized.
