# Independent pdftotext qualification

## Result and candidate

Qualification is **incomplete**. Current code explicitly has no PDF extraction
engine. `execute` in `packages/safe-bash-command-pdftotext/src/command.ts`
rejects extraction before acquiring stdin or VFS access. This is a verified
capability gap, not evidence of font/layout parity or a repaired parser defect.
No speculative extraction implementation was added.

Inspected and executed 2026-09-21. HEAD:
`ab1fa8d34101e1e7f61272973f3bc28a842043d8`. The candidate includes existing
uncommitted edits; HEAD alone does not identify it. Source/check SHA256:
`32678ab82ac02ac34d1fd4450ed9dfccd27900fa4f5fd1be61c507930eeb6487`.
Reproduce by sorting the command's `src/*.ts`, its manifest, the public pdftotext
wrapper, safe-bash manifest, the three `pdftotext-*.test.ts` plugin tests,
`scripts/bundle-safe-bash.mjs`, `scripts/package-safe.mjs`, and the two
`scripts/fixtures/safe-packages-pdftotext*` fixtures. Hash each relative path,
NUL, file bytes, NUL. Documentation is outside this receipt.

Runtime: Node v22.22.2, npm 10.9.7. The maintained selected build uses the
declared SafeFS → contracts → command closure. Manifest inspection confirms
`safe-bash-command-pdftotext`, `private: true`, TypeScript ESM and an empty runtime
dependencies object. Safe Bash's command wrapper only re-exports the package.
The requested package-pattern document was moved by unrelated edits; its
[archived copy](archive/safe-bash-command-package-pattern.md) was read without
restoring it. These inspections do not establish installed-artifact qualification.

## Manual QA procedure

1. Identify the working-tree candidate using the receipt above. Inspect the
   invocation and parser prerequisites before making compatibility claims.
2. Execute the three memory-VFS pdftotext plugin test files and command workspace
   tests/lint. Check full stdout/stderr/status and VFS effects, including SDK
   equivalence, aliases, redirects, shell scripts and pipeline failure propagation.
3. For a candidate with an accepted extraction engine, independently capture
   every fixture against pinned Poppler
   `0595ca8e76f575e5f16ccc5ee6d4b552d31b0a46` / 26.09.90. Record executable,
   source/archive/assets hashes, build features, permission macro, versions,
   locale/timezone, argv bytes, fixture hashes, stdout/stderr/status and named
   output effects. Native processes are manual controls only. Unit tests must
   neither launch them nor fetch fixtures.
4. Keep the upstream default and `ENFORCE_PERMISSIONS` profiles separate. Match
   [the acceptance matrix](safe-bash-pdftotext-acceptance.md), including mapped
   upstream variants and intentional strict numeric/encoding admission deviations.
5. Inspect rendered-page bbox overlays through manual screenshots for each
   claimed geometry profile. Record mismatched boxes and missing fonts/CMaps;
   serializer tests on supplied rectangles do not prove PDF geometry.
6. Verify installed public-tarball runtime/types without an unpublished package,
   actual required runtimes/realms, authority denial, rollback and replay. Record
   missing cells individually. Performance measurements get a separate receipt.

Steps 1–2 were executed for this candidate. Steps 3–6 remain open. No product
visual output was changed; no bbox output exists to overlay. No screenshots or
native controls were executed in this task. No temporary evidence was generated
on disk.

## Exact executed controls

New controls live in
`packages/safe-bash/tests/plugins/pdftotext-independent-controls.test.ts`.
Their PDF generator is independent of product code: one page, MediaBox
216×144, Helvetica/WinAnsi 12, uncompressed `Hello world` at (20,100), regenerated
xref offsets. This is a **new fixture**, not the supplied 1236-byte P3 control.

| Fixture | Bytes | SHA256 |
| --- | ---: | --- |
| `/original.pdf` | 613 | `a43d6710075400b0972d00f1e5a7739e3999c5d2df8563f7f38aba18150dad1f` |
| `/empty.pdf` | 0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `/malformed.pdf`, literal `%PDF-1.4\nnot a document` | 23 | `92faad7b15111399835737be5fd963ee133a5f0d68d3935093955d2a653aacdf` |
| `/missing.pdf` | absent | no bytes |

For each input, CLI `pdftotext INPUT -` and SDK `{ input: INPUT, output: '-' }`
agree: status 99, empty stdout, exactly 64 stderr bytes:
`pdftotext: Qualified PDF font/text/layout engine is unavailable\n`.
Diagnostic SHA256:
`553fd89ce7dfd0b776550e95c74c639cfe21b49cd489809a9b8c44236efee921`.
The original PDF remains byte-identical; root VFS entries remain exactly the
three fixtures. Additional invocations on the original use `-f 1 -l 1`,
`-f 2 -l 1`, `-layout`, `-raw`, `-bbox`, `-bbox-layout`, `-tsv`, and `-upw wrong`;
all return 99 with no text. These are unavailable-capability observations,
not page-range/password/format semantic passes.

`pdftotext /missing.pdf - | wc -c` yields `0\n` and the unavailable diagnostic.
Without pipefail its status is 0; with pipefail it is 99. With pipefail,
`pdftotext /missing.pdf - | rg Hello` returns nonzero and empty stdout. Downstream
success cannot establish extraction success. Existing controls separately cover
named-output aliases, redirect truncation before execution, no fetch calls,
ambient-looking paths, opt-in registration and CLI/SDK invocation agreement.

## Verification and missing cells

- Command workspace unit route: 37 passed, zero failures/skips.
- Three focused plugin files: seven passed, zero failures/skips. Initial run:
  six passed, one failed because the new test assumed `readdir` returned names;
  the actual VFS returns typed entries. Corrected the test's projection and
  reran all three files. No product repair or timeout change was needed.
- Command workspace lint/typecheck: exit 0. ESLint on the added test: exit 0.
- `npm run build:workspaces -- --workspace=safe-bash-command-pdftotext`:
  exit 0, three declared builds, no missing build declarations in that closure.
- Repository-wide unit/lint/build and fresh installed consumer gates: not run.
  This change adds focused tests and documentation only; existing broad receipts
  are not attributed to this candidate.

Columns, tables, ligatures, rotated/vertical/RTL glyphs, missing CMaps,
encrypted and scanned PDFs, actual extraction through rg/wc, page normalization
in real documents, crop/slice transforms and bbox overlays remain unverified.
The original P3/F8/M10/G31/N36/B34 fixture bytes and complete native receipts are
not present in this task's evidence. Supplied research remains prior upstream
evidence, not a freshly executed differential comparison. No native permission
profile is advertised by the candidate. Extraction read/decode/layout budgets,
cancellation and publication rollback are unavailable; admission/output
cancellation and cleanup tests passing cannot discharge those cells.

Actual browser/workerd/Bun execution, cross-realm extraction, original/checkpoint/
replay extraction, private declaration bundling and an isolated installed
pdftotext consumer remain unverified in this task. No performance measurements
were collected. No compatibility acceptance or completion is claimed.

Local commits: none. Verified remote-main delivery: none. Successful releases:
none. No private command package was published. Unrelated edits were preserved.
