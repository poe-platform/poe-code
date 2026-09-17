# LaTeX writer verification

Original tests were authored before implementation. The initial SDK run had ten
missing-writer failures and an adapter fixture missing its required signal. After
correcting that test fixture and implementing the writer, all eleven initial
cases passed. Additional failing original tests reproduced superscript
preprocessing in math, ignored table row attributes, explicit raw rejection
being bypassed by lossy mode, nested/note figures, references to dropped row IDs,
duplicated labels in repeated table headers, and ignored fragment language. Those
failures are fixed.
Invalid column widths were already rejected by AST admission with E_AST; no
writer repair was needed or retained for that boundary.

Final maintained local checks:

- `npm test --workspace=@poe-code/pandoc`: 22 files, 699 tests pass, including
  23 original writer cases with Writers.LaTeX obligation categories.
- `npm run lint --workspace=@poe-code/pandoc`: ESLint and both source/test
  TypeScript checks pass.
- `npm run build:workspaces -- --workspace=@poe-code/pandoc`: selected maintained
  uncached build passes.
- `git diff --check`: passes. Both owned sample sources also match serialization
  from the final built writer exactly, with no diagnostics.

Units use only in-memory serialization, injected callbacks and memfs for file
publication. No host scratch files, external executables, downloaded fixtures or
LLMs occur in these tests. Owned structure assertions cover group/environment
balance, span row slots, deterministic serialization and publication refusal on
unsafe input, cancellation and output limits. They do not substitute for a TeX
compiler or assert full upstream conformance.

The built byte adapter was exercised with fragment output, standalone German
metadata and strict raw refusal through the maintained repository screenshot
renderer. [The inspected screenshot](latex-writer-command.png) has readable source,
separate error/status text, successful output exits and refusal with exit 2.
This task changes format availability/output bytes, not the CLI visual design.

Owned external-QA inputs are [the representative AST](latex-writer-owned.json),
[its standalone source](latex-writer-owned.tex), [the owned image](latex-writer-owned.png),
and [a 120-row AST](latex-writer-longtable.json) with
[longtable source](latex-writer-longtable.tex). These are generated evidence,
outside unit discovery; no third-party fixtures or implementation bodies were
copied. Both SDK sample serializations produced no diagnostics.

External compilation: **unperformed**. pdflatex, lualatex and tectonic are absent
from PATH on this host. No oracle was installed/downloaded and no compilation or
font/package conformance is claimed. The controlled, pinned, shell-escape-disabled
procedure is under docs/plans/pandoc-latex-writer.md. It is separate from the
TypeScript PDF product backend.

Delivery: local main only. Push and release are not authorized. The unrelated
docs/plans/pandoc-typescript-safe-bash.md change is preserved and excluded.
