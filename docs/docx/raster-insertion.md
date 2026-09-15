# Bounded raster headers and inline insertion

Ordered task68's bounded raster utility is locally verified. Sole format
authority is docs/specs/docx.md; ownership and QA procedure are in
docs/plans/docx-raster-insertion.md. Task67 inventories/extracts exact bytes;
task68 adds original bounded headers and PNG/JPEG inline insertion.

Preparation retains the upstream image/shape source/API inventories and original
mapping records. No reference binary/assets/code will be imported into product
fixtures. Tiny technical PNG/JPEG/GIF/BMP/TIFF fixtures are original in-memory
header/container data. New artistic illustrations are subject to the user's image
reference rule and are not required to characterize these technical formats.

Verified native sizing follows the sole/shared contracts: explicit physical units for CLI,
integer EMUs for model numeric values, independent DPI axes and72 fallback.
No implicit pixels/px or96-DPI insertion default is admitted. Complete Image SDK
metadata/collection/object API parity remains task69/later work, not preparation
evidence. No README edit, native build/runtime dependency, implicit network,
ambient product I/O, ignored asset commit, push or release.

The local public utility exports are `characterizeRasterHeader` (synchronous
bounded metadata) and `insertDocumentImage` (always async input admission/edit/
publication). The insertion request is `{operation: "images.add", options, input?}`;
file is closed owned base64 bytes or an explicit capability-scoped VFS input.
Publication receives supplied filesystem/stdout, limits, cancellation and encoding.
PNG/JPEG insert inline; GIF/BMP/TIFF are characterized but not inserted by this
baseline. Headers retain nullable DPI axes and do not decode pixels or prove
rendering. The control PNG decoder remains unchanged.

Verified actual optional safe-bash command examples:

```sh
docx images add 'survey notes.docx' --file photo.jpg --paragraph 1 --output portrait.docx
docx images add 'survey notes.docx' --file 'leaf image.png' --paragraph 1 --width 1in --height 2in --fit stretch --decorative true --output fit.docx
```

Paragraph targets append a drawing run; an admitted block container or unique
unselected body receives a trailing image paragraph. Header/note owners are
explicit. Run/caret/range/all insertion, floating placement, supplied fallback
and replacement are not part of this baseline. Decorative defaults false and
conflicts with nonempty alt. Recognized path suffixes assert byte-derived type;
unknown/extensionless names do not. One dimension preserves native physical
aspect ratio; two set both, with explicit fit requiring both box dimensions.
An explicit allowed empty selection yields unchanged data with affected0.

Maintained final tests passed104 files/2292 tests, package lint/typechecks,
selected portable build, complete guarded root lint (0 errors/12 existing warnings)
and safe-bash guarded typechecks. Independent verification passed154 focused/
public/command tests,115 actual Shell cases across14 derived files and108 literal
registration cases;49 captured hashes including the historical34-path cohort
were unchanged. Raw-byte, MIME, relationship and native-extent QA passed12
complete original alpha-PNG/portrait-JPEG/landscape-JPEG placement cohorts;
the bounded receipt is [raster-insertion-qa.json](raster-insertion-qa.json).

Original regressions cover metadata offset/palette/empty-IDAT,
numeric drawing-ID collisions, per-axis/unrounded sizing, configured media
errors, descriptor-first inputs, producer ownership and admission before escaped
alt allocation. CLI help/workflow/sizing/refusal screenshots were inspected;
raw Unicode was exact despite missing display glyphs in the capture font.
Procedures, detailed gates and local atomic commits are in the linked task plan.
Original disposable QA pixels remain retained for the active image campaign.
