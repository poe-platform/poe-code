# RST reader validation

Validated September 16, 2026, in the original TypeScript workspace.

## Original tests first

The initial 19 original cases failed with `E_CAPABILITY: No read capability for
rst` before implementation. Further cases were added and observed failing before
their fixes: short headings, content-column list indentation, inline field blank
lines, structural replacement preservation, inline targets/embedded URIs,
qualified multiline diagnostics, included image origins, substitution expansion
ceilings and multiple paragraphs inside simple-table cells.

Final focused reader file: **34 tests pass**. Cases cover conflicting adornments,
indentation/tabs, blank-line significance, interpreted roles, forward/recursive
substitutions, anonymous hyperlinks, duplicate/indirect/cyclic targets,
numbered/auto-number/symbol notes, literal transitions, multiline tables,
directives/options/raw policy, figures and explicit includes. Resource mutations
and extraction use memfs. Unit tests invoke no native tools, LLMs, host scratch
files or downloaded fixtures.

## Maintained checks

- `npm run test --workspace=@poe-code/pandoc`: **23 files, 733 tests pass**;
  includes all existing package tests and format-registry integration expectations.
- `npm run lint --workspace=@poe-code/pandoc`: ESLint and source/test TypeScript
  checks pass.
- `npm run build:workspaces -- --workspace=@poe-code/pandoc`: selected maintained
  workspace build closure succeeds (one declared build).
- `git diff --check`: passes for task changes.

These are package checks, not a repository-wide gate or release certification.

## Command-output inspection

The built package's thin command adapter was exercised with explicit byte stdin
from the original rst-example.rst document. Screenshots were captured using the
maintained scripts/screenshot.ts command route and visually inspected:

- [HTML conversion and input-format inspection](rst-command-html.png): command
  exit 0; `rst` is listed, typed heading/strong/link/list/code/table content converts
  to HTML, including multiline cells, without diagnostics.
- [Strict GFM attempt](rst-command.png): child exit 2; the existing Markdown writer
  explicitly rejects heading attributes rather than silently losing them.
- [Explicit lossy GFM attempt](rst-command-lossy.png): child exit 0 with
  `W_RAW_CONTENT` for projected heading attributes. The screenshot exposes an
  existing destination-writer limit: SoftBreak inside table cells is emitted as a
  physical newline, yielding an invalid GFM pipe row. This does not certify GFM
  table fidelity. No writer change is included in this RST-input task.

The byte adapter unit case separately verifies successful HTML conversion through
memfs includes and no publication when an included file is missing. No claim of
rendered-browser QA or complete Readers.RST/Docutils conformance is made.

## Reference and limits

Docutils 0.21.2 release archive and syntax-document SHA-256 values were verified
in memory; the pin and directive/role allowlist are in rst-reader.md. Docutils is
never invoked by the converter. Rectangular simple/grid tables are supported;
spans/partial separators and directives/roles outside the allowlist are explicit
failures or diagnosed preserved source under the documented loss policy.

Delivery: validation is local. No push or release is authorized or performed.
