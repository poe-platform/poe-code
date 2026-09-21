# Independent split/template QA

The root delegated this review to a different agent after implementing split
output. The reviewer owns `packages/ssconvert/src/conversion/split-independent.test.ts`
and this evidence document; engine/export/integration/Git ownership remains with
the root. No native processes, LLM queries or disk fixture writes occur in the
unit cases. File effects use original tiny fixtures in memfs.

## Primary-source basis

Inspect Gnumeric 1.12.61 `src/ssconvert.c` from the root-authenticated source
archive held only under `out/ssconvert-lifecycle/gnumeric-1.12.61` (archive SHA-256
`2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12`).
`resolve_template`, `export_objects_for_sheet`, and `do_split_save` provide the
substitution, graph failure and sheet iteration expectations. This review did
not independently run a native oracle or recapture its dependency/plugin/locale
profile; native differential coverage belongs to the root evidence.

## Executed cases

Run `npx vitest run packages/ssconvert/src/conversion/split-independent.test.ts`.
The first six cases passed before any review repair:

- Repeated explicit selection `[b, a, b]` with sheet-selection support, retaining
  the original order and focus, emitted selection and zero-based filenames.
- The same selection without sheet-selection support, moving each temporary
  view's chosen sheet to the front and focusing it, without changing the caller's
  original workbook.
- Unknown escape `%q` causes identical output paths: each selected occurrence
  still writes, the final file contains the last write, artifacts retain all
  writes, and cumulative output bytes count every write.
- Cancellation after a completed first write retains that file, propagates the
  exact abort-reason identity, and never starts a second sheet writer.
- Unicode, spaces, hash, question mark, percent, backslash and slash components
  remain present through URI escaping; `..` follows ordinary lexical resolution;
  inserted substitutions are not recursively expanded; mixed unknown/literal/
  trailing percent handling follows the source for ASCII escape codes.
- A sheet name producing an unapproved HTTPS URI is refused by the injected
  resource I/O capability before publication, with no added file effects. This
  refusal is recorded as an intentional capability divergence; native URI
  availability for this mapping was not measured in this independent review.

## Validated regression

The seventh case reproduces a concrete graph failure mismatch before its repair:
on one sheet, object zero writes, object one fails with EACCES, object two should
still write; objects on the following sheet should not publish. Native
`export_objects_for_sheet` continues its same-sheet object loop after setting
failure status, and `do_split_save` stops before the next sheet. Before repair,
the shared command/SDK engine stopped immediately and never attempted object
two. The red run reported six passing cases and this one failure, with actual
writes `graph-0.svg, graph-1.svg` instead of the expected additional `graph-2.svg`.
The regression also requires exit status 1 and the native graph diagnostic
`Failed to write file:///graph-1.svg: Permission denied\n`.

Root repaired the engine after observing the failing regression. The unchanged
regression now passes with same-sheet continuation, the requested exact
diagnostic, numbering based on every attempted object, and no next-sheet write.

After the graph continuation repair, further independent cases check exact abort
reason identity and renderer finalization, fatal cumulative output-byte limits,
ordered multiple graph errors with attempted-file numbering and successful
artifacts only, and failed-write byte admission. The two-error fixture explicitly
admits 200 output bytes to fit both legitimate diagnostics; a separate 1-byte
fixture tests resource-limit rejection without changing runtime limits.

A second concrete red regression uses a 100-byte output allowance and two
60-byte graph payloads. The first write fails with EACCES after bytes have been
offered to injected I/O; the next payload must be refused before its write. The
initial implementation accounted only successful writes and incorrectly admitted
the second 60 bytes, returning failure status but publishing `budget-1.svg`.
Root repaired runtime admission after observing this failing regression; the
unchanged case now passes. Partial-write effects cannot be rolled back or
measured through the current opaque host capability; conservative byte
reservation prevents repeated failed publications from bypassing the allowance.

## Limits and remaining measurements

- Source graph ordering sorts objects by anchor. The rendering capability
  currently supplies order; this independent suite does not verify native
  anchor ordering or raster/image serialization.
- Legacy rendering artifacts with only a URI lack sheet/object identity and
  retain their existing renderer-owned filename behavior. Native shared
  template expansion is measured here only for identity-bearing artifacts.
- Unknown substitutions with a multibyte character are unmeasured. Native C
  consumes one byte after `%`; the implementation processes JavaScript code
  units. Exact URI handling of the resulting native invalid UTF-8 needs separate
  bounded oracle evidence before a repair can be justified.
- In-memory path traversal is intentional lexical filename behavior, not proof
  of containment for real, S3, WebDAV or remote adapter providers. This suite
  verifies one denied scheme mapping, not every unsafe-name capability policy.
- Full-workspace tests, visual CLI acceptance, graph rendering providers, and
  native external-service behavior are outside this independent narrow suite.

## Verification record

- Initial six-case unit run: 6/6 pass (18 ms reported test execution).
- Seven-case pre-repair run: 6/7 pass; graph continuation fails as described.
- Eleven-case pre-admission-repair run: 10/11 pass; failed graph bytes incorrectly
  permit the second payload as described.
- Final focused post-repair run:
  `npx vitest run packages/ssconvert/src/conversion/split-independent.test.ts packages/ssconvert/src/conversion/split.test.ts packages/ssconvert/src/conversion-lifecycle.test.ts`:
  3/3 files and 34/34 cases pass, including all 11 independent cases (24 ms
  independent test execution; 62 ms aggregate reported test execution).
- Final post-repair `npm run lint --workspace=@poe-code/ssconvert`: exit 0,
  including package ESLint, source typechecking and test typechecking.
