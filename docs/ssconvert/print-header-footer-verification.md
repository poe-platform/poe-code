# Print header/footer verification — 2026-09-21

Print-layout remains **incomplete**. This follow-up adds the public pure
`renderPrintHeaderFooter` helper alongside the existing pagination helpers.
No command binding, workbook PDF writer, README, Git commit, push or release
was made. Existing edits were preserved. The workbook completion gates and
source-field/per-codec inventory remain in
`../plans/ssconvert-print-layout-qa.md`; this follow-up does not certify them.

## Candidate and source identity

This is an uncommitted live-checkout qualification, not an authenticated Git
revision or an append-proof inventory. The final owned candidate SHA-256 values:

| Path under packages/ssconvert/src | SHA-256 |
| --- | --- |
| rendering/print/header-footer.ts | `0e1927007564cb5f3ee47d7f4ef3b0145a3a1668fdcb233c05d2b8581fbb4d28` |
| rendering/print/header-footer.test.ts | `de4f990e6292d37f0b65ebd4a47c6c3d9dab1dc076dcfd96ab62e7cff2646b30` |
| index.ts | `989e0541a4bebde3e59f6ad958f66758febbb16e12a7b9e4f01a09250480efa7` |

Rechecked official Gnumeric 1.12.61 archive SHA-256
`2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12`.
The extracted `src/print-info.c` matches its archive member byte for byte,
SHA-256 `ff970d578a151d5e7a76ed962cb3e9159383c6a992cd9ce85d2c0d998a349e11`.
Primary source stays under out/ssconvert-lifecycle. GPL attribution is in the
print NOTICE; no native executable or font becomes a product dependency.

## Executed Markdown QA

Executed `../plans/ssconvert-print-header-footer-qa.md`. The separate profile
`chart-rendering-verification.json` hashes to
`538f3cb9562e9c47b874bdcbaf30507fb318561021631a524da1098c41df9b05`.
Docker context colima / ssconvert-statistics-qa provides the pinned Linux aarch64
QA oracle. Rechecked binary SHA-256
`104f1e5500432c95ac3d46a679d476d05d2bf84e7483e991d212703cb0ed131c`
and DejaVuSans.ttf SHA-256
`57f73e11f51999432bf7ab22ce55b6f945d5eca1bf824404cfa9ec2e3718c84e`.
Used LC_ALL=C, LANG=C, TZ=UTC, task-local HOME/XDG roots and the profile's
library/schema prefix. Linked-library/plugin identities are inherited from
that captured profile; a fresh full hash capture was not performed.

Fresh importer/exporter listings both exit 0. Native emits them to stderr,
not stdout: importer 1,144 bytes SHA-256
`6aede5ad3388ed810ce7d2714f2d03215ac6a54ae45b884eefa122fdf9332a36`,
exporter 1,649 bytes SHA-256
`a298b5a0400e5589d975ddb84a0529063781d4063a0dbfa1dd93af9b233eb054`.

Original inline fixture: single string cell A1, sheet SheetOne, Letter paper,
72-point body margins, 36-point header/footer edges. Its left header is:

```text
Tab=&[tAb] Page=&[pAgE]/&[PAGES] Fold=&[PAGEſ] File=&[ﬁLE] Unknown=&[NOPE] Literal=&& End=&[BROKEN
```

Pinned native `ssconvert -T Gnumeric_pdf:pdf_assistant fixture.gnumeric
fixture.pdf` exits 0 with zero stdout and stderr bytes. PDFKit independently
extracts one page with this header:

```text
Tab=SheetOne Page=1/1 Fold=1 File=fixture.gnumeric Unknown= Literal=&& End=
```

The same string matches the built public ESM export. Inspected the native
612×792 first-page PNG: the header and A1 text are visible. PDFKit supplies the
inspection rasterizer; Gnumeric generated the PDF. There is no product workbook
image to compare, so paired image/glyph/layout fidelity is **unsupported**, not
passed. No visible CLI behavior changed; a CLI screenshot was not executed.

## Regression and independent review

Before implementation, the literal-output baseline fails all five initial
regressions. Independent agent stress then reproduces the Unicode long-s/fi
opcode mismatch and fixes it. Root reproduces native C-string NUL termination
failure before fixing it; independent re-review adds three negative controls.

Final 18 header tests cover English opcode expansion, unknown removal, broken
token truncation, opaque colon arguments, lowercase rep| handling, explicit
date-system/serial/format callbacks, missing metadata, native captured text,
NUL termination, work/output budgets, UTF-8 byte boundaries, invalid page/budget
metadata, falsey cancellation identity, callback abort/error identity and a
foreign-realm callback error. No test invokes native tools, LLMs or file writes.
No new fixture file I/O needs memfs because these cases operate on strings.
Independent header + prior native-independent geometry run passes 26/26.

## Maintained gates

- PASS: `npm run build:workspaces -- --workspace=@poe-code/ssconvert --no-cache`,
  three fresh builds from the selected declared dependency closure.
- PASS: `POE_CHECK_CACHE=0 npm run test:unit --workspace=@poe-code/ssconvert`,
  final 267 files / 5,651 tests, including all 18 final header tests.
- PASS: `npm run lint --workspace=@poe-code/ssconvert`, ESLint and production/test
  TypeScript checks.
- PASS: built public ESM import and native-captured expanded header text match.
- FAIL, then repaired: initial regressions, Unicode folding and NUL termination.
- SKIP: root npm test / repository lint / full npm run build; the change is
  confined to ssconvert helpers and their exports. No shared runner or safe-bash
  source was changed. No broad gate completion is claimed.
- UNVERIFIED: actual command/SDK PDF integration, original/checkpoint/replay
  workbook printing, mapped codec variants and deployed host integration.
- UNMEASURED: performance/time/memory cohorts. Test timing is not a benchmark.
- UNSUPPORTED: product workbook PDF painting and paired output images.

## Remaining mismatches and limits

Timestamp formatting and CELL reference resolution remain supplied by the caller;
the helper does not implement relative/repeating workbook lookup or native GOFormat
date formatting itself. It requires explicit sheet/file/path/title/page data and
does not derive URI names or preview placeholders. Output/work limits bound helper
execution, not arbitrary trusted synchronous host callbacks. Translated opcode
catalogs and native locale collation remain unverified. Page values are admitted
as nonnegative safe integers, not arbitrary signed native C integers.

Workbook sheet selection/visibility/print-area resolution, style-only/object
extent, automatic-break mutations/warnings, RTL, paper catalog/custom syntax,
font licensing/data/shaping/metrics, wrapping/rotation, formatted cell painting,
merged cells, borders/fills, objects, gridlines/headings, headers/footer positioning,
workbook page numbering and PDF serialization/integration remain open. Existing
supplied-geometry pagination coverage cannot establish these capabilities.
XLSX's empty printOptions was confirmed against native xlsx-write.c:2623–2624;
no speculative interoperability change was made. Every per-codec and mapped
upstream runtime cell not explicitly measured remains unverified.
