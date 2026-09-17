# Pandoc package-boundary milestone

Task: `resolve-package-boundaries` in pandoc-typescript-safe-bash.md.
Status: completed architecture decision; dependent implementation gates remain open.
The existing pipeline file had unrelated edits on entry and is preserved without
staging them. This owned record supplies the task completion and relevant plan update.

Delivered evidence: docs/pandoc/architecture.md and html-parser-probes.md.
No package, command, README or runtime dependency added. Follow-on workspace,
reader/writer, adapter and publication tasks are not started by this milestone.

## Executed review

- Read root and safe-bash AGENTS.md; inspected current conversion-adjacent commands,
  byte/command/FS contracts, sibling SDK exports and shared codec owners.
- Read DOCX plan and DOCX/PPTX specification boundaries. The requested PPTX plan is
  absent; recorded that gate rather than inventing a replacement.
- Inspected package declarations and root bundle graph/runtime/declaration wiring.
- Ran five original HTML tree probes in memory, compared whole and character feeds,
  and recorded harness limitations and HTML5 gaps without changing existing behavior.
- Checked documentation links, exact source symbols, dependency direction, absent
  workspace paths and whitespace before the local documentation commit.

## Remaining implementation acceptance procedures

Later owners must start with failing original tests before code changes. Unit VFS
mutations use memfs; no host scratch files, LLM, downloaded fixtures or external
executables. Verify narrow maintained workspace test/lint/build closures after
implementation and built public consumers after export/bundle changes. Test any
visual CLI impact with ad hoc screenshots; keep evidence under docs/pandoc.

Do not activate Office formats from source exports alone. Verify sibling SDK AST
mappings and bounds. Require delivered XLSX read and PDF layout contracts; keep
EPUB packaging separate from OPC. Preserve html-to-markdown and archive observables.
No push/release is authorized by this milestone.
