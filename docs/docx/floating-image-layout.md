# Floating image layout evidence

Task71 read-only preparation begins at verified local main commit
2057602218bf92be14f1a8966bdab6d808015c4e. Implementation and product/render QA
remain pending. docs/specs/docx.md remains the sole format contract.

Original memfs probes confirm images.set rejects unsupported-profile before
filesystem reads; current flags omit task71 independent frames/alignment,
distances, overlap, behind-text and aspect lock. Negative zOrder is admitted by
the current schema although native relativeHeight is unsigned32. Axis-native
frame/alignment values and merged crop/decorative constraints need reconciliation.
Tight/through wrapping needs an explicit coherent polygon rather than a guessed
outline. Media/relationships and unchanged alternates must remain exact.

Independent preparation authenticated exact two report originals and found
QuickLook Office generator5.0/build48. Renderer execution/page adequacy are
unverified; cached page counts and physical paragraph positions are not render
evidence. No Word or LibreOffice exporter was found at standard checked paths.
Original assets remain local QA only; no artwork is adapted or redistributed.
The bounded rendering and future implementation procedure is in
../plans/docx-floating-image-layout.md. No task72 work has begun.

## Schema reconciliation evidence

Root reconciled the proposed images.set option register, bounded layout semantics
and requested inventory fields only in docs/specs/docx.md. The bundled spec
checker passed with zero warnings; independent semantic review approved sole
SHA256fa3c3ad8fa4dfefa6b9c830921043a5083bd1477036819840e8cd1c4af681248
before product edits. Shared CLI/SDK semantics remain unchanged.
No implementation or product test pass follows from this wording change.

Later lower-bound reconciliation, independently approved before code correction,
authenticates sole447027d6e2c82083962b8dd31bc5f44d251de481c8d04356f6b35e1ee7e34516.
Positive unrounded extent lengths remain >0 and below the native pre-round upper
bound; final written extents are integers1..2147483647. Shared half-away rounding
therefore admits0.5/0.75emu as1 and refuses positive values rounding tozero.
Original RED08 verifies the earlier rawmin1 drift; checker again0warnings.
No published/live model or completed product QA status follows from reconciliation.

Explicit bounded primary toolkit metadata acquisition on2026-09-15 fetched
https://raw.githubusercontent.com/dotnet/Open-XML-SDK/main/data/schemas/schemas_openxmlformats_org_drawingml_2006_wordprocessingDrawing.json
at03:20:07.276624Z,41283bytes,SHA256
935b017531de3f3ab650c99daf7cda2787f62ce7b0f6860277c2532ca00a7c93,
and the corresponding schemas_openxmlformats_org_drawingml_2006_main.json
at03:20:07.566266Z,809697bytes,SHA256
e760b534c96ee02745d2a8084f1be362826da4470a85d0b0102a67c3b1678ab7.
Source URLs use unpinned main; source commit is unknown. Hashes authenticate the
actual research bytes, not ISO XSD provenance or every ISO prose requirement.
Both temporary metadata files remain /tmp/docx71-schemas_* research only.

Independent review authenticated both hashes and confirmed WrapPolygon sequence
start then lineTo(min2), optional edited BooleanValue, and required Point2DType
Int64 x/y bounds[-27273042329600,27273042316900]. No native closure equality,
area, distinctness, nonintersection or21600normalization rule was established by
these records; the bounded utility does not invent one. Native vertical frame
line was confirmed and a draft omission corrected before implementation.
Unsigned anchor distances/relativeHeight and positive bounded extent writer
limits are distinct from shared generic Length admission. Signed32 offsets are
an explicit utility profile; the reviewed metadata did not resolve that external
simple type's primitive. Existing extent-ratio layout resizing is distinct from
replacement's newly admitted media physical ratio. Live model/inherited/enum/
collection obligations retain their existing pending inventory dispositions.

## Portable paginated renderer preparation

Official LibreOffice26.8.0 arm64 DMG acquired as a QA-only tool,298773447bytes,
SHA2568858d8058da4f862f47559486814e65efc27294da67c5e4bb56b006b1ee59f89,
matching explicit Homebrew cask metadata. HTTPS official URL redirected to the
documented southfront.mm.fcix.net distribution mirror. Read-only exclusive mount
and codesign --verify --deep --strict passed; bundle26.8.0.3. No system app
installation, repository manifest/lock/build change or product dependency.
First network-denied/cache-write-confined headless export returned1 after28.1s
without stdout/stderr/PDF. It remains failed feasibility, not rendered evidence.
QuickLook's earlier clipped continuous previews remain an explicit inadequate
cohort. Later IP inbound/outbound denial with local Unix IPC allowed exported the
circular-economy original to a real PDF,exit0 after12.87s. Prior network* denial
also denied required local IPC; all failed cohorts remain separate. The successful
QA profile uses exclusive UserInstallation and explicit TMPDIR/TMP/TEMP paths,
but whole-host write confinement was not established. Fontconfig cache warnings
remain; host fonts are QA dependencies and rendering parity is not established.
Independent and root inspection of five actual baseline page PNGs established
pagination availability: circular-economy167pages and Wales27pages. Circular
page1 compresses cover/acknowledgment/copyright with overlap and page3 is blank
numbered; Wales page2 has a bottom figure cropped at its page boundary. These
are original native-renderer limitations, not product defects or fidelity proof.
Baseline receipt SHA256e05e3ce75bac4a6529c993393ae34f25ceeb970db3d5a13227d6550a8881bbbe
authenticates that cohort. All task71 edited-product/page QA remains pending.

## Exact language and public API boundaries

| Observable task71 behavior | JavaScript/security mapping and retained obligation |
| --- | --- |
| images.set utility | setDocumentImageLayout always returns Promise; owned admitted bytes and explicit PublicationContext, no host path/time/font/media discovery; changed physical drawings return shared MutationData kind set. Final execution verification remains pending. |
| Coordinates/sizes/distances | SDK accepts the same explicit Length value/unit records as direct CLI flags, checked half-away rounding once; inventory emits integer EMUs. Polygon points are bounded native integers in a closed owned record, not physical units or pixels. |
| Selection/Locations | CLI ordinals are one-based per owner; immutable utility snapshots/current generation tokens are distinct from live model objects and zero-based model sequences. All preadmission does not authorize shared-story appearances. |
| Optional native properties | Undefined preserves; false/zero are explicit values; absent/invalid inventory metadata is null with warnings. Merged crop/alt/decorative and native semantic-equivalent lexical noops require original tests. |
| InlineShape.height/width/type | Historical API rows docx.shape.InlineShape.height, .width and .type remain pending live synchronous properties/value helpers. Extent utility edits and inventory do not complete those rows or instantiate a live InlineShape. |
| InlineShapes and inherited part | docx.shape.InlineShapes, .part (canonical docx.shared.Parented.part), .__getitem__, .__iter__ and .__len__ remain pending live zero-based collection/iteration/length and bounded package-owner views. No proxy-wrapper or identity pass follows from utility tests. |
| Insertion and enum graph | docx.text.run.Run.add_picture and docx.enum.shape.WD_INLINE_SHAPE_TYPE retain their separately inventoried construction/returned-owner/enum-alias obligations. Neither layout tests nor downloaded grouped artwork complete those members. |

Pinned API/test inventories and their upstream-case identities remain research
provenance. Task71 adds original utility cases only; no historical case/model
status is promoted by acquisition, wording approval or baseline rendering.
See upstream-api-audit.md, upstream-test-audit.md and the existing image inventory,
format and replacement records for the retained broader obligations. Final
product identity scanning and native-free build closure verification remain
pending; no complete current-scope proof follows from these mappings.
