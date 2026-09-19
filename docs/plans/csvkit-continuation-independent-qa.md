# Independent csvkit composition QA

Scope: independently stress the implemented `csvcut`, `csvgrep`, `csvsort`, and
`csvstack` engines through actual safe-bash Shell execution. Preserve other
workers' edits, staging and Git ownership. No commit, push, publication or README
changes are authorized by this QA assignment.

1. Read root/scoped instructions and the four current source contracts. Validate
   a suspected issue against the current source before proposing a product fix.
2. Author original short canonical in-memory cases in
   `packages/safe-bash/tests/commands/csvkit-continuation-independent.test.ts`.
   Exercise real algorithms and pipelines, exact stdout/stderr/status, generated
   and repeated selectors, aggregate inversion, multiline cells and physical
   numbering, stable Unicode sorting, Decimal precision, null ordering, grouping
   collisions, blank records and partial failure output.
3. Keep named content/effect assertions in memfs and VFS; do not create fixture
   files, invoke native commands, use network/LLMs or launch databases in tests.
   Assert named inputs retain their exact contents after a surplus-field failure.
4. Test accepted but unsupported reader quoting modes explicitly as blockers.
   A successful status-78 assertion is refusal-contract evidence, never a csvkit
   compatibility pass. Preserve unmeasured cases as unmeasured.
5. Run the focused uncached Node/tsx test route and the maintained safe-bash
   `test:runner` route. Root owns guarded registration, lint/typecheck/build and
   workspace integration. If a product defect is validated, first retain a
   failing original test and notify root before touching shared source.
6. Render representative built Shell pipeline output using the maintained
   screenshot route into a unique file in `out`, inspect the image, and purge
   only owned temporary renderer/image files after reducing findings.
7. Record the measured denominator, test-harness corrections, verification and
   remaining limitations in `docs/csvkit/continuation-independent-validation.md`.

This focused QA does not qualify all fourteen commands, every explicit/common
option, every csvkit format, interpreter behavior, database/network effects,
service campaigns, exhaustive Unicode/regex cases, or complete release parity.
