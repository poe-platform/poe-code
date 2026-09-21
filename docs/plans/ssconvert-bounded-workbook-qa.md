# Bounded workbook model QA

This procedure covers the sparse domain model and its existing shared SDK/virtual
command engine. It does not qualify real spreadsheet codecs or calculation.

1. Inspect root and scoped instructions and preserve existing edits. Authenticate
   the Gnumeric 1.12.61 archive against
   `2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12`.
   Acquire/extract source only under an owned `out` directory. Bind source review
   to the captured dependency/plugin/locale profile in
   `docs/ssconvert/reference-profile.json`. Never introduce native product I/O.
2. Before implementation, run an original in-memory regression showing workbook
   metadata loss and borrowed nested rich-text mutation. Confirm failure. Add
   failing-first sheet case-folding and stored-cell extent cases before adding
   those behaviors. Use memfs for unit filesystem effects.
3. Run `npm run test --workspace=@poe-code/ssconvert -- --no-cache` and
   `npm run lint --workspace=@poe-code/ssconvert`. Exercise sparse maximal sheets,
   blanks versus missing/empty strings, serial dates, cache presence, formulas,
   groups, merges, scoped exact-spelling names, Unicode sheet conflicts,
   detached scopes, axis/view metadata, ownership and malformed records.
4. Assign a different agent to stress/fix the implementation after it exists.
   Require concrete failing cases before repairs. Root retains exports,
   integration, documentation and Git ownership. Do not invent native import
   behavior when overlapping array formulas or opaque records are unmeasured.
5. Build the selected integration closure with
   `npm run build:workspaces -- --workspace=@poe-platform/safe-bash --no-cache`.
   Rebuild `@poe-code/ssconvert` uncached after final domain edits. Run
   `node --import tsx --test packages/safe-bash/tests/commands/ssconvert.test.ts`
   and `node --test packages/safe-bash/scripts/integration-inputs.test.mjs`.
   Compare SDK/virtual output bytes and status/channel/namespace effects using
   original fixtures. Verify public built imports, not just source imports.
6. Run the maintained safe-bash typecheck and root guarded ESLint route. Preserve
   failures and record gates that stop before checking source. A focused strict
   integration compiler check may establish that scope separately; it does not
   turn an incomplete maintained gate into a pass.
7. Capture and inspect an ad hoc screenshot of the virtual command's failure
   diagnostic using `npm run screenshot`. Keep generated images/logs in `out`;
   this is manual visual validation, not a screenshot test.
8. Reduce source hashes, verified checks and remaining gaps into
   `docs/ssconvert/bounded-workbook-verification.md`, then remove owned scratch.
   Leave unrelated `out` artifacts intact. Do not edit README files, push or
   publish. No native differential or real-format pass is inferred from a JSON
   fixture round trip or source review.
