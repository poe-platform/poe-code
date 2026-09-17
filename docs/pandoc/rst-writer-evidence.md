# RST writer validation

Validated locally September 16, 2026, on main.

The first original exact-text cases failed because rst had no writer capability.
Subsequent failing original tests reproduced duplicate/unresolved targets,
extended combining marks, merging adjacent containers, inline literal boundary
backticks, empty containers, transition placement, implicit-heading collisions and
references to dropped span identifiers. Implementation followed those failures.

Final maintained scope checks:

- `npm test --workspace=@poe-code/pandoc`: 24 files, 753 tests pass; 20 original
  writer tests. Adapter mutation/publication uses memfs, with destination preserved
  on strict failure. No unit test uses Python, host scratch files, downloaded
  fixtures, native executables or LLMs.
- `npm run lint --workspace=@poe-code/pandoc`: ESLint, source typecheck and test
  typecheck pass.
- `PANDOC_DOCUTILS_PYTHON=<isolated-python> npm run test:conformance:rst
  --workspace=@poe-code/pandoc`: the maintained selected workspace build closure
  succeeds, then 12 original integration cases match independently written exact
  strings and parse with docutils 0.21.2 without diagnostics. The oracle checks
  Unicode database 13.0.0, node counts, displayed word boundaries, literal content
  and URI separation. File insertion/raw content and title promotion are disabled.
- Task whitespace review: `git diff --check` passes.

The oracle was installed only in an isolated integration environment. `/out` is
read-only here, so the temporary environment lived under docs/pandoc and was
removed after validation. The product and package dependencies contain no Python.

The maintained scripts/screenshot.ts route captured the built thin adapter's
output-format inspection and CommonMark-to-RST conversion with a heading, strong
text, displayed link, continued list item and punctuation-leading code. The
[result](rst-writer-command.png) was visually inspected. Content is readable and
rst is advertised; the screenshot font has no CJK glyph, so Unicode fidelity is
established by exact-text/oracle assertions rather than that glyph rendering.

Coverage and explicit losses/errors are documented in rst-writer.md. These are
package/integration checks, not a repository-wide gate, complete Pandoc conformance
claim, push verification or release certification. No push or release was performed.
