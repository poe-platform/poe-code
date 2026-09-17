# RST input follow-up validation

The requested reader was already present in the current main checkout. This
follow-up validates its existing original cases and fixes reproduced gaps only.

Directive option/body boundary: an original test first failed with E_CAPABILITY
when a code body began with field-shaped text after the separating blank line.
The reader now retains that separator until options have been parsed. The test
covers literal code fields with/without header options, literal raw `:file:` body
text and field lists inside admonitions. Existing raw resource header denials
still pass.

Maintained checks after this improvement:

- `npm run test --workspace=@poe-code/pandoc`: 47 files, 1,051 tests pass.
- `npm run lint --workspace=@poe-code/pandoc`: ESLint and both typechecks pass.
- `npm run build:workspaces -- --workspace=@poe-code/pandoc`: five declared
  builds in the selected dependency closure pass.
- `git diff --check`: passes.

Command screenshots use the built original TypeScript byte adapter, explicit
stdin and no native converter. `rst-directive-boundary.png` shows an explicit
HTML destination rejection of number-lines attributes (exit 3); it does not
indicate a reader failure. `rst-directive-body-html.png` checks the same body
without number-lines against HTML. Unit resource mutations remain memfs-only.

No push or release is authorized.

Substitution hyperlinks: the next original case first failed with E_PARSE for
anonymous link/target count mismatch. Named/anonymous suffixes now link the
expanded label through existing target resolution, preserving Image/Strong nodes.
Missing named targets still fail. The maintained package suite passes 47 files
and 1,052 tests; the selected five-build closure passes. An initial lint/typecheck
found an insufficiently narrowed Inline union in the new assertion; the assertion
was rewritten to narrow explicitly and lint/typechecks rerun.

`rst-substitution-links-html.png` was captured and inspected: the built byte
adapter emits the image and strong text inside their respective HTML anchors,
without diagnostics, exit 0. `rst-directive-body-html.png` was also inspected and
shows intact literal fields plus the admonition definition list, exit 0. These
are terminal output checks, not browser layout or complete Docutils conformance.
