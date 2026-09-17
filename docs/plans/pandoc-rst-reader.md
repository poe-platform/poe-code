# RST reader

Implement an original TypeScript reader in packages/pandoc. Preserve the existing
thin safe-bash adapter and never invoke a native converter or docutils.

1. Write failing original reader and adapter cases, using memfs for resources.
2. Implement indentation-aware blocks, inline markup, deferred references,
   bounded substitutions/notes/includes, tables and a documented allowlist.
3. Run package unit, lint, typecheck and selected workspace build checks. Review
   malformed-source positions and capability rejection before committing.
4. Commit only task-owned files on main; no push or release is authorized.

QA: convert an original RST document through SDK and the byte-oriented command
adapter; inspect typed AST and generated HTML. Exercise strict and raw-preserving
policies, resource denial, memfs includes and cycles, and failed-output prevention.
Evidence and the pinned syntax reference belong under docs/pandoc.

Status: reader implemented with original tests first. Blocks, inline markup,
deferred links/notes/substitutions, explicit includes, images/figures and rectangular
tables are covered. Directive/role options and strict/raw policy are documented in
docs/pandoc/rst-reader.md. Unsupported table spans remain explicit failures.

QA execution: use the built package's createPandocCommand with an explicit byte
stdin for docs/pandoc/rst-example.rst. Capture format inspection and HTML conversion
using scripts/screenshot.ts, then inspect the PNG. Also capture strict GFM rejection
and explicit lossy GFM conversion; record any destination-writer limits without
expanding this RST-input task into a writer change. Unit resource mutations use
memfs only. Final maintained package tests (733), lint/typechecks and selected
workspace build pass. Screenshots were inspected; evidence records the existing
GFM destination-writer limitation. The verified atomic reader improvement is ready
for a local Conventional Commit on main. No push/release is authorized.

Follow-up audit: reproduce directive body fields being interpreted as header
options, then preserve the separating blank line during option parsing. Verify
code/raw literal fields and admonition field lists with original tests; rerun
maintained package tests, lint/typechecks and the selected workspace build closure.
Keep the safe-bash adapter thin and retain the existing resource denial tests.

Follow-up QA: run the built createPandocCommand with explicit byte stdin for a
code directive containing field-shaped literal text and an admonition containing
a field list; capture and inspect terminal HTML output. Separately inspect the
number-lines destination rejection. Store screenshots/evidence under docs/pandoc.
