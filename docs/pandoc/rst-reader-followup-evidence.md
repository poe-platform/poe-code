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
