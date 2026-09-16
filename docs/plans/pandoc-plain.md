# Plain writer implementation and QA

Implement a dedicated explicitly lossy text writer in packages/pandoc. Preserve
unrelated edits. Write original failing expectations before implementation.

Policy: paragraphs and ordinary blocks use blank lines; Plain blocks use one
newline before their successor. Lists use visible markers and hanging indentation.
Tables use tabs between physical cells and newlines between physical rows, with
cell paragraphs preserved. Code retains its whitespace with four-space block
indentation. Headings retain text without level markers. Notes render inline with
an explicit label. Links retain differing destinations and titles; images retain
alt text and titles. Captions retain both alternatives. Raw nodes require explicit
source retention with a diagnostic; math and unresolved citations fail.

Only wrap=none is supported. No terminal width or styling dependencies.

QA: run original expected-output tests, package tests, lint/typecheck, and selected
workspace build. Verify CLI byte output and SDK output and limit failures agree.
Inspect output visually through a generated screenshot if the maintained CLI
screenshot route can exercise the converter. Store evidence in docs/pandoc.

Status: complete. Five original expectations failed against the old writer before
implementation. Dedicated writer, format registration and note expectations are
updated; package tests (577), lint/typechecking and selected workspace build pass.
CLI/SDK output and shared limit failures agree. Inspected the actual byte adapter's
terminal PNG capture; the renderer font lacks some Unicode glyphs, while byte
expectations preserve the full strings. Policy and evidence: docs/pandoc/plain-output.md.
One atomic local commit contains this task; no push or release is authorized.
