# DOCX visual QA execution evidence

The visual QA task was executed on 2026-09-15 against the current worktree,
including unrelated uncommitted work. This qualifies the exercised utility subset,
not a clean HEAD, complete object-model parity, or a release. The
[executed plan](../plans/docx-visual-qa.md) contains supported commands; the
[receipt](visual-qa.json) records input/output and page hashes, all attempts,
inspection sets, contract hashes and inventory accounting. No product code,
README or canonical binary fixture was added. Later tasks remain pending.

## CLI observations

Seven PNGs produced through `npm run screenshot-poe-code` were opened: help,
help-start, text, comments JSON, errors, root bash help and root docx error.
Adapter transcripts were displayed through `bash --root ... -c 'cat ...'`;
this is not direct root DOCX dispatch. Root `docx --help` reports unknown command
(exit 1). Root bash help remains readable, including wrapped option descriptions.
The explicit public engine/plugin supports its own help/schema/capabilities/version
(exit 0), plural resources and `text replace`. No reference branding was observed
in the inspected command output.

The long help capture loses its beginning; a separate `head -n 27` capture shows
syntax, publication, flags and statuses. Terminal wrapping splits words. Latin
text and dense wrapped comments JSON are readable; Arabic/CJK text displays boxes
in this terminal font. This is not a Unicode visual pass. Exact logical codepoints
survive the edit independently of font display.

Path publication returned exit 3 `unsupported-publication` because the trusted
RealFileSystem profile lacks transactions. The corrected binary stdout command
returned 0 and 11120 bytes, saved unchanged by the trusted host. Initial reads
failed with exit 3 because the first publication produced no edited file; repeated
reads after binary publication returned 0 for text, JSON, images, notes, comments,
revisions, sections and core-v1 validation (no diagnostics). `tables list` returned
1 `unsupported-profile`, a declared engine gap. Error screenshots show the actual
conflicting first/all usage (2), missing source (3), malformed container (1), and
unsupported table profile (1). Unsupported operations are not successful coverage.

## Document rendering and inspection

The documents skill renderer ran with managed Python 3.12.14 and bundled
LibreOffice/Poppler, not desktop LibreOffice. Runtime bundle is 26.909.12148;
manifest reports LibreOffice 25.2-headless-codex.1, while the executed binary reports
LibreOfficeDev 26.8.0.0.alpha0, build
2c87e51eeaa2b413ff4ae097b2705eea1995d8e5. This mismatch is retained explicitly.
The dependency loader was unavailable; dependencies were resolved through the
managed runtime manifest. Node runtime reports v24.19.0. Verbose render logs and
PNGs remain disposable under `/tmp/docx-visual-20260915`.

All 88 page PNGs across four baseline/edited pairs were opened and inspected.

| Pair                   | Pages per version | Observations                                                                                                                                                                                                                                                                                                                                                                                                         |
| ---------------------- | ----------------: | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Original rich document |                 3 | First literal Draft to Final replacement; image calibration blocks/red line retained, wrapped table intact, numbered list, foot/endnote text, comment anchors, insertion/deletion, portrait/landscape sections and explicit page break retained. No new clipping or pagination shift. CJK glyphs missing; some boundary spaces missing in both versions due to original QA authoring without xml:space preservation. |
| Appendix corpus        |                15 | Headings, footnotes, equations, shaded boxes and tables retained. Only page 1 raster changes; pages 2–15 pixel-identical. Baseline reference-field errors remain visible; equations clipped at right on pages 10/12 in both versions. Page 14 sparse continuation and page 15 bibliography retained.                                                                                                                 |
| CJK corpus             |                 3 | Only page 1 raster changes; remaining pages identical. CJK glyphs omitted in both versions, Latin text/lines retained. CJK readability and wrapping are unverified.                                                                                                                                                                                                                                                  |
| Tracked corpus         |                23 | Logo, dense underlined/struck review markup, table on page 4, lists and page boundaries retained. Literal QA suffix appears in repeated footer, changing every page raster. No gross new clipping observed; this does not certify every character's typography.                                                                                                                                                      |

Corpus inputs were checked against the existing corpus manifest and copied to
invocation-owned temporary paths. No new download, copied unit fixture, branding
or corpus prose was shipped. SDK attempts missing explicit archive encoding were
rejected; corrected context uses `order: 'input', compression: 'store'`. Protected
tracked selections rejected; the fourth nonempty segment was admitted inside an
existing insertion. That selected insertion intentionally changes by the literal
QA suffix, while its attributes and other review subtrees stay unchanged.

Fontconfig warnings and mixed-section DPI notes were inspected. No repair warning
was observed in the headless logs and all eight exports produced PDFs/PNGs.
Headless export cannot prove Word repair-free opening or visible comment balloons;
no Word desktop application/version was available for this task. Classic comment
parts and anchors are structurally checked. Modern/threaded comments, desktop
revision interaction and font-complete RTL/CJK qualification remain unverified.
The utility does not execute fields; renderer field refresh is external behavior.

## Structural disposition and testing

Independent ZIP CRC/XML checks passed for every pair: membership unchanged,
only `word/document.xml` dirty, untouched payloads/media exact, internal relationship
targets present, logical RTL/CJK codepoints retained, and tables/drawings/numbering/
sections/note/comment references preserved. Review subtree comparisons exclude
only the intentionally selected tracked insertion, whose attributes remain equal
and text is exactly original plus QA. An initial QA assertion incorrectly demanded
that selected insertion remain unchanged; the assertion was corrected to separate
intended mutation from preservation. Neither that assertion nor omitted host
encoding was a validated product defect.

No meaningful new product structural defect was validated. Existing original
memfs guards in `packages/docx/src/text-replace.test.ts` cover revision views,
Unicode scalar behavior and boundary preservation. No renderer or screenshot unit
tests were added. No code was changed, so there is no code-fix red/green cycle to
claim. Temporary fixtures remain available for unresolved renderer/font checks;
fixture retirement and other campaigns' caches were not touched.

## Exact language and security mappings and drift

The shared SDK and durable DOCX specification remain authoritative:

| Surface              | Exact mapping and authority                                                                                                                                                                                                                                                                                                                                     |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Model versus utility | Neutral snake_case model methods/properties retain positional order; keyword-only fields use a typed trailing options object. Utility options use camelCase; CLI uses kebab-case flags and plural resources. Whole `.text`/`clear()` replacement is distinct from format-preserving `text replace`.                                                             |
| Async boundaries     | Document factory, save and input/image admission always return Promises; admitted model access is synchronous. This task exercises utility APIs, not all live model members.                                                                                                                                                                                    |
| Collections          | Zero-based SDK access, `.length`, `Symbol.iterator`, explicit `.at`/`.slice` only where supported; one-based CLI positions within selected owner. Keyed lookup keeps keys, including comment IDs.                                                                                                                                                               |
| Values               | `undefined` uses defaults; allowed `null` represents inheritance/absence, distinct from false/zero. Bytes are owned Uint8Array copies. Safe integer EMU helpers use nearest halfway-away-from-zero conversion; typed enums retain documented values/aliases.                                                                                                    |
| Time and failures    | Copied UTC Date model values versus explicit UTC string utility timestamps, whole-second normalization. Type/value/index/key failures map to neutral input-type, invalid-value/semantic-validation, bounds and missing-key errors; absence-returning lookups remain null. CLI 0/1/2/3/4/130 retains success/document/usage/I/O/limit/cancellation distinctions. |
| Owners and security  | Live views carry owner identity and deterministic stale-handle invalidation. Public XML/package views are bounded and owner-scoped; no ambient filesystem, identity/time, network, dynamic evaluation, arbitrary XPath, macros, embedded-object or field execution. QA renderer is a separately trusted external application.                                   |

Documentation drift is resolved in this evidence by using `comment_id` and
`timestamp`, not inconsistent id/date examples; absent comment lookup returns
null. `table_direction` remains the model spelling, without inventing an alias.
Nullable getters do not imply nullable setters. Read-only CLI inspection must use
noncreating queries even where model getters create definitions. Underscore-prefixed
public XML, table and header/footer interfaces remain public obligations; inherited
members, enums, collections, helpers and APIs without external tests are included.

The complete pinned inventory contains 920 objects, not the earlier 331-object
preparation subset: 410 planned, 378 security-mapped, 124 language-mapped and 8
documentation-error records; all 920 historical adaptation entries remain
unmapped_not_implemented. No row is promoted by visual QA. The audit already
separates later bounded utility/model evidence from this historical inventory;
its research status is not runtime completeness. Whole public API coverage remains
incomplete, including declared rejected utility routes. Contract/audit hashes in
the receipt identify the exact current documents read without overwriting unrelated
audit/spec changes.

## Maintained checks and delivery

- `npm run build:workspaces -- --workspace=docx`: passed.
- `npm test --workspace=docx`: 178 files passed, 3438 tests passed, 4 skipped.
- `npm run lint --workspace=docx`: passed, one unused type-only variable warning.
- Owned Prettier, receipt consistency and whitespace checks: recorded in manifest.

These checks qualify the exercised current worktree and documentation. One atomic
owned plan/evidence commit is authorized on main with hooks enabled. The local
hash is reported after commit; no push, remote-main verification or release occurs.
