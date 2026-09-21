# Independent resize review

This review used original small in-memory workbooks and a separate native QA oracle. Unit tests never spawned native programs or created files. Root retains exports, integration, Git and final cumulative verification ownership. No README, commit, push or publication was performed by this reviewer.

## Reference and procedure

The reference is released Gnumeric 1.12.61, official archive SHA-256 `2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12`. Source inspection used the existing task-owned archive extraction under `out/ssconvert-statistics-oracle/gnumeric-1.12.61`; no primary source was acquired elsewhere. Reference dependency/plugin/locale qualification belongs to [the root resize QA](ssconvert-resize-workbooks-qa.md) and `docs/ssconvert/resize-reference-profile.json`.

1. Inspect `src/sheet.c:gnm_sheet_resize_main`, `src/sheet-style.c:sheet_style_most_common`, and `src/expr.c:reloc_range` from the authenticated source extraction.
2. Run original in-memory cases in `packages/ssconvert/src/workbook/resize-stress.test.ts`; reproduce failures before repairing product code.
3. For native comparison only, construct a two-sheet XML workbook in the reviewer-owned `out/ssconvert-resize-stress` directory. Include a consistent SheetNameIndex and explicit 256-row/column dimensions. Execute the existing Docker `colima` container `ssconvert-statistics-qa`, executable `/out/ssconvert-statistics-oracle/prefix/bin/ssconvert`, and decode its gzip XML output separately from unit tests.
4. Compare individual formula/name effects, rerun maintained scope checks, reduce observations into this document, and remove the reviewer-owned scratch directory.

## Verified observations and repairs

Corrected native fixtures completed with status0. Native conf-monitor critical/warning noise occurred with this reviewer's initial ambient execution profile; that noise is not a diagnostic-equivalence pass. The first native fixture omitted SheetNameIndex and failed status1; it provided no resize-semantic evidence. Adding the required index corrected the fixture.

| Original case | Native result | Product repair or coverage |
| --- | --- | --- |
| Other sheet formula `=Small!$IV$200`, resize128x512 | `=#REF!` | Removed former sheet qualifier from deleted references; failing regression preceded repair. |
| `=SUM(Small!$IV$200:$IV$220)`, resize128x512 | `=sum(#REF!)` | Deleted range collapses to an unqualified error; product preserves original function token spelling through existing rewriting. |
| Other sheet `=Small!$IV$100`, resize128x512 | Formula unchanged | Expanded column axis preserves retained target. |
| `=Small:SMALL!$IV$200`, resize128x512 | `=#REF!` | Resolve equal sheet identities using case folding before deciding a range spans distinct sheets; failing regression preceded repair. |
| Named expression `$A$1`, parse baseA200, resize128x512 | Expression and parse baseA200 remain unchanged | Named parse bases are admitted within MAX_SHEET_SIZE, independent of resized actual dimensions; failing regression preceded repair. |
| Qualified `=Small!A300` on original256 rows, with and without resize512x512 | Both emit the string expression `="Small!A300"` | Import parsing rejects the original out-of-grid reference before resize. No speculative resize normalization was added. |
| Array columns126..129, rows199..200, resize128x128 | Array retained, dimensions256x256 | Column deletion fails before row deletion can remove the array; failing regression preceded sequential preflight repair. |
| Array columns199..200, rows126..129, resize128x128 | Array removed, dimensions128x128 | Column deletion removes the array before the potential row split. |

Additional in-memory failing regressions validated stale dependencies causing `Invalid cell address` after shrink, detached formulas rewritten without becoming dirty, missing generic FormatRange expansion, missing per-cell SDK style expansion, and incorrect separate native/generic style-majority accounting. Repairs invalidate cached dependency relationships, dirty detached formula caches, and compute expansion winners from one sparse set of original XML/generic/cell rectangles. Generated StyleRange records retain native style nodes in `style.gnumeric` for the root-owned exporter integration. Original cells participate in majority calculation even when some disappear during shrink. Expansion in both axes uses the last original column's common style for the bottom-right corner, matching source logic.

The11 reviewer tests also cover crossing object anchors retained without geometry changes, objects whose starting anchor disappears being deleted, original workbook immutability, sparse majority-style output, cancellation reason propagation, and work-limit failure without a successful resized result. Source tie handling explicitly depends on native pointer-hash iteration; deterministic product ties are not claimed equivalent.

## Checks and limits

- Final reviewer suite:11/11 passing; reviewer suite plus resize regression suite:16/16 passing.
- Workbook ownership, independent boundaries, workbook stress, and reviewer suite together:59/59 passing.
- Root workbook model tests plus reviewer suite:21/21 passing.
- Maintained `npm run lint --workspace=@poe-code/ssconvert`: passed, including source/test TypeScript. Earlier failing fixture type checks were reported and fixed by root; their failures were not suppressed.

These focused results do not establish the final whole-workspace build/test/integration gate; root records that separately. Native style majority was inspected in source, while generic/mixed/cell style winner tests qualify original in-memory model cases. Exporter emission of generated native style wrappers is root-owned validation.

Remaining unqualified cases include semantic equality between differently serialized native style nodes, native hash-dependent equal-count style ties, arbitrary native XML style-overlay/default inheritance, all foreign-format export style losses, every chart/object subclass and anchor mode, every print-setting feature, view/selection/frozen-pane relocation, dynamic PID/time GLib diagnostics, and every malformed formula/import fallback. The out-of-original-grid expansion observation is an import mismatch, not a verified resize failure. Cross-realm/realm ownership, host isolation, shell replay and all shell budgets were not independently requalified by these workbook-only tests; no product host capability or native fallback was introduced. Unsupported and unmeasured cases are not passes.
