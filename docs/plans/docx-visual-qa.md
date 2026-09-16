# DOCX CLI and document visual QA

Task: `visual-cli-and-document-qa` only, executed on 2026-09-15. Later tasks,
product corrections, fixture retirement, README edits, push and release remain
pending. Own this plan and new evidence `docs/docx/visual-qa.md` and
`docs/docx/visual-qa.json`; own only newly created files beneath
`/tmp/docx-visual-20260915`. Preserve other worktree/index entries and corpus
caches. Do not implement product code. A validated defect must first become a
small original structural memfs regression, with a failing run recorded; no
screenshot tests or copied binary fixtures.

## Contracts and acceptance

Read root AGENTS.md, docs/specs/docx.md, office-cli.md, office-sdk.md, the API audit,
complete 920-row inventory and reconciliation. Use plural resources, `text
replace`, declared scopes/selectors, common JSON/flags and statuses. Historical
research/model dispositions are not visual passes. Keep exact JS/security
mappings and documentation drift in the evidence; do not exclude inherited,
enum, collection, helper, untested or underscore-prefixed public members.

Inspect actual CLI help, logical text, JSON and errors for wrapping, clipping,
readability and unexpected branding. Root `poe-code bash` does not register the
explicit docx plugin. Invoke the public engine/plugin in an inline plain-Node
session with an explicit VFS, record its unmodified streams and statuses, then
use the maintained screenshot-poe-code route to display those transcripts.
This is transcript display, not root docx registration or direct dispatch.
Capture root discovery/unsupported-root errors separately. No fake docx root
command and no new product registration are introduced.

Use the documents skill's `render_docx.py`, bundled Python, bundled LibreOffice
and Poppler. Inspect all pages of representative original edited packages and
selected edited corpus documents: images, tables, sections, lists, foot/endnotes,
comments/revisions and actual RTL/CJK content. Check baseline versus edited
wrapping, pagination, clipping, missing graphics/glyphs and repair diagnostics.
Headless comments require structural anchors/parts checks; PDF export alone does
not qualify comment balloons. Record actual app/version, declared runtime version
and unavailable cases. Do not substitute installed desktop LibreOffice.

## Supported execution commands

Workspace build (derived dependency closure):

```bash
npm run build:workspaces -- --workspace=docx
```

Use an inline `node --input-type=module` session importing `docx`,
`virtual-bash`, and `virtual-bash/commands/docx`. Construct
`new Shell({ fs: new RealFileSystem({ root: '/tmp/docx-visual-20260915' }),
cwd: '/' }).use(docxCommands({ engine:
createDocxInspectionCommandEngine({ limits }) }))`; always dispose the shell.
The test host owns explicit paths/limits and writes transcripts outside the
checkout. QA is executed from this markdown plan, not a retained QA script.

Execute the following source strings through that shell (baseline authored
in memory with original WordprocessingML and `writeDocumentArchive`; serialize
ZIPs only as disposable QA inputs):

```text
docx help text replace
docx schema text replace --json
docx capabilities --json
docx version
docx text replace original.docx --find Draft --with Final --first -o edited.docx --json
docx text replace original.docx --find Draft --with Final --first -o -
docx text edited.docx --scope body
docx text edited.docx --scope body --json
docx images list edited.docx --json
docx tables list edited.docx --json
docx notes list edited.docx --json
docx comments list edited.docx --json
docx revisions list edited.docx --json
docx sections list edited.docx --json
docx validate edited.docx --json
docx text replace original.docx --find Draft --with Final --first --all --json
docx text absent.docx --json
docx text malformed.docx --json
```

The path-output attempt returned 3 (unsupported-publication): RealFileSystem has
no transaction publication capability. The supported corrected command uses
`-o -` without JSON. Save its exact `stdoutBytes` through the trusted host as
`edited.docx`, then repeat the reads (initial missing-output failures stay in
the receipt). Never reconstruct the ZIP from decoded text.

Display exact adapter transcripts, including their captured failure streams:

```bash
npm run screenshot-poe-code -- -o /tmp/docx-visual-20260915/help.png bash --root /tmp/docx-visual-20260915 -c 'cat help.txt'
npm run screenshot-poe-code -- -o /tmp/docx-visual-20260915/help-start.png bash --root /tmp/docx-visual-20260915 -c 'head -n 27 help.txt'
npm run screenshot-poe-code -- -o /tmp/docx-visual-20260915/text.png bash --root /tmp/docx-visual-20260915 -c 'cat text.txt'
npm run screenshot-poe-code -- -o /tmp/docx-visual-20260915/json.png bash --root /tmp/docx-visual-20260915 -c 'cat comments.txt'
npm run screenshot-poe-code -- -o /tmp/docx-visual-20260915/errors.png bash --root /tmp/docx-visual-20260915 -c 'cat errors.txt'
npm run screenshot-poe-code -- -o /tmp/docx-visual-20260915/root-help.png bash --help
npm run screenshot-poe-code -- -o /tmp/docx-visual-20260915/root-docx-error.png docx --help
```

Resolve the installed managed runtime from
`/Users/kjopek/.cache/codex-runtimes/codex-primary-runtime/runtime.json` and check
its actual binaries. `load_workspace_dependencies` is not exposed in this
session; record this explicitly instead of claiming its invocation. These paths
are managed runtime dependencies, not system Python or desktop LibreOffice:

```bash
/Users/kjopek/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/override/soffice --version
/Users/kjopek/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python /Users/kjopek/.codex/plugins/cache/openai-primary-runtime/documents/26.909.12148/skills/documents/render_docx.py /tmp/docx-visual-20260915/original.docx --output_dir /tmp/docx-visual-20260915/original-render --emit_pdf --verbose
/Users/kjopek/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python /Users/kjopek/.codex/plugins/cache/openai-primary-runtime/documents/26.909.12148/skills/documents/render_docx.py /tmp/docx-visual-20260915/edited.docx --output_dir /tmp/docx-visual-20260915/edited-render --emit_pdf --verbose
```

Recheck SHA-256 of corpus inputs against their existing manifest. Read originals
without changing them; use public `replaceDocumentText` with `find`, `with`,
`first`, `output: '-'`, explicit context and supplied byte sink. Context
must include `encoding: { order: 'input', compression: 'store' }`; omitted
encoding was rejected before publication. Append original literal ` QA` to the
first admitted nonempty segment; the tracked corpus admits segment four after
protected earlier selections reject. Render selected
outputs with the same command/path substitutions. A refused corpus edit or
failed renderer is not a visual pass. No external links/fields/objects execute.

Open every generated CLI/page PNG using the image tool. Record page counts,
explicit feature presence and observations rather than inferring layout from
XML or cached document metadata. Independently verify ZIP CRC, membership,
exact untouched-part payloads, preserved comment anchors/revision nodes and
logical Unicode. If a meaningful defect appears, preserve its input until a
small original failing structural test exists; do not fix product code here.

## Maintained checks and owned commits

Run `npm test --workspace=docx`, `npm run lint --workspace=docx`, scoped
`npx prettier --check docs/plans/docx-visual-qa.md docs/docx/visual-qa.md
docs/docx/visual-qa.json` and `git diff --check`. Tests-only regressions, if
necessary, join these checks; no unit cases depend on downloaded documents or
renderer processes. Whitespace/format checks cover documentation edits; package
checks qualify the engine used for QA rather than imply whole-API conformance.

After relevant checks pass, review and explicitly stage only the three owned
plan/evidence files (plus any separately verified original regression). Commit
one atomic QA documentation improvement as `docs(docx): record visual QA results`
on main, with hooks enabled and no co-author. Record local hash separately from
remote delivery. Do not push/release, stage ignored documents/images/logs, retire
another campaign's fixtures or mark later pipeline tasks complete.

## Execution record

Results, actual command outcomes, image inspections, defects and unavailable
cases are recorded in [visual evidence](../docx/visual-qa.md) and its
[machine-readable manifest](../docx/visual-qa.json). Update these only with
observed results. Cleanup is limited to invocation-owned fixtures after meaningful
findings have a durable structural disposition; historical caches remain intact.

Executed: seven CLI PNGs and all 88 baseline/edited document pages opened and
inspected. Build and unit routes passed; final lint/format/manifest results are
recorded in evidence. No new structural product defect validated, no product
code or README edited, and no fixture cleanup or later task performed. Visual
CJK, comment balloons and Word repair qualification remain unverified.
