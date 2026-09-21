# DOCX visual QA

Status: Executed with explicit unavailable renderer/root-dispatch cases; document
visual acceptance remains open. Later tasks pending.

## Scope and contracts

Use root AGENTS.md, docs/specs/docx.md, docs/specs/office-cli.md,
docs/specs/office-sdk.md and the API audit/inventory under docs/docx. No product
code, README edits, push or release. Existing unrelated changes remain untouched.
The historical 2026-09-15 report is retained as historical evidence; this execution
has its own dated receipt. Renderer success, structural validity and CLI usability
are separate outcomes. Unsupported commands and unavailable rendering are gaps.

The skill catalog and installed plugin skill paths have no applicable document
skill. Do not claim the historical managed renderer is available. Use the locally
installed LibreOffice headless command as a documented fallback, with an isolated
profile and bounded host timeout; record this departure from skill-based rendering.
Reference: https://help.libreoffice.org/latest/en-US/text/shared/guide/start_parameters.html

## Preparation

1. Verify branch main and capture HEAD, contract hashes and inventory counts.
2. Store temporary probes, logs, authored QA packages and PNGs in `/out`.
   On this machine `/out` creation fails with a read-only filesystem; use ignored
   repository `out/docx-visual-20260921` and record that exception. Purge only
   invocation-owned files after extracting the receipt.
3. Run `npm run build:workspaces -- --workspace=docx`. Create an original package
   with a calibration PNG, wrapping prose/table, numbered list, portrait/landscape
   sections, explicit page break, footnote/endnote, classic comment, inserted and
   deleted text, Arabic/Hebrew and Japanese/Chinese/Korean text. Generate its
   ZIP/XML and PNG with standard-library host tooling, without downloads or
   canonical binary fixtures. Keep fixture generation temporary, not a QA script
   shipped in the repository.
4. A temporary trusted Node bridge imports the built public
   `createDocxInspectionCommandEngine`, supplies an explicit read capability and
   streams, and records real output and exit statuses. It executes:

   ```text
   docx help text replace
   docx schema text replace --json
   docx capabilities --json
   docx text replace original.docx --find Draft --with Final --first -o -
   docx text edited.docx
   docx comments list edited.docx --json
   docx validate edited.docx --json
   docx tables list edited.docx --json
   docx notes list edited.docx --json
   docx sections list edited.docx --json
   docx revisions list edited.docx --json
   docx text replace original.docx --find Draft --with Final --first --all --dry-run --json
   docx text absent.docx --json
   ```

   These are engine commands, not a claim of root CLI registration. Save binary
   stdout as edited.docx; do not combine package stdout with JSON. Expected
   successful commands return 0; conflicting first/all returns 2, missing input 3.

## Terminal inspection

Execute the requested root screenshot route with real argument shapes:

```bash
npm run screenshot-poe-code -- -o out/docx-visual-20260921/root-help.png -- docx help text replace
npm run screenshot-poe-code -- -o out/docx-visual-20260921/root-text.png -- docx text edited.docx
npm run screenshot-poe-code -- -o out/docx-visual-20260921/root-json.png -- docx comments list edited.docx --json
npm run screenshot-poe-code -- -o out/docx-visual-20260921/root-error.png -- docx text absent.docx --json
```

If root dispatch rejects docx, record all four as unavailable coverage. Do not
present a transcript as root dispatch. Supplement with `npm run screenshot` on
the temporary public-engine bridge in capture mode, preserving its actual exit
code, to inspect help, text, JSON and error output. Open every PNG. Inspect
wrapping, start/end truncation, diagnostics and glyph visibility. No screenshot
tests. The screenshot runner itself can return 0 for a failed child; retain the
child exit status separately.

## Document inspection

Execute with a 30-second trusted host timeout:

```bash
/Applications/LibreOffice.app/Contents/MacOS/soffice \
  -env:UserInstallation=file:///Users/kjopek/Workspace/poe-code-3/out/docx-visual-20260921/render-profile \
  --headless --convert-to pdf:writer_pdf_Export \
  --outdir out/docx-visual-20260921 \
  out/docx-visual-20260921/original.docx out/docx-visual-20260921/edited.docx
```

If export succeeds, rasterize PDFs with an available documented PDF renderer and
open every baseline/edited page. Inspect warning logs, repair messages, table and
prose wrapping, page/section breaks, clipping, calibration graphic, list numbering,
note placement, review display, RTL direction and CJK glyphs. Record actual app
version versus metadata. A timeout without PDFs leaves these checks unverified;
no warning output is not proof of repair-free opening. Desktop Word repair and
comment balloons require independent application evidence.

## Structural checks and delivery

Independently inspect ZIP CRCs and XML; require unchanged package membership,
only the intended document XML edit, exact unedited parts/media, preserved table,
numbering, section, note/comment anchors and review subtrees, and logical Unicode.
A meaningful validated product defect must enter a small original memfs structural
unit test that fails before any fix. This task forbids product fixes: retain a
failing regression and record the blocked acceptance rather than implementing a
later task. Do not invent a defect to justify tests.

Run `npm test --workspace=docx` and `npm run lint --workspace=docx`, plus owned
Prettier and `git diff --check`. Record skips honestly. Record exact JS/security
mappings and documentation drift without promoting inventory rows. Commit the
owned plan and dated evidence as one atomic Conventional Commit on main with hooks,
explicit paths and no co-author. No ignored QA files enter Git. Report the local
hash separately from remote delivery/release, neither of which is authorized.

## Execution result, 2026-09-21

The [dated evidence](../docx/visual-qa-20260921.md) and
[receipt](../docx/visual-qa-20260921.json) record all attempts. Ten terminal images
were inspected, including two supplementary 120-column PTY captures made with
`POE_SCREENSHOT_PTY=1 POE_SCREENSHOT_ROWS=40 npm run screenshot -- -o PATH -- node CAPTURE ID`.
Root captures preserve the literal extra `--` in the runner's child arguments;
independent matching dev invocations confirm child status 1 for unknown docx.
Engine reads/edit return 0, conflicting cardinality 2 and missing source 3.
ZIP/XML/preservation/Unicode assertions pass; no new structural product defect
was validated. Renderer version/export probes time out without page images;
repair, layout, graphics, review and document RTL/CJK remain unverified. Terminal
RTL/CJK glyphs show boxes. No skill-based renderer execution is claimed.

Maintained selected build passed; workspace tests passed 254 files/5,198 tests
with zero skips; workspace lint passed with one type-only unused-variable warning.
Owned formatting/whitespace checks passed. Invocation-owned ignored temporary
files were purged after inspection and receipt extraction; historical fixtures
and unrelated work were preserved. Only this plan and the two dated evidence
files enter the atomic local documentation commit. No push or release.
