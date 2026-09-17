# PPTX conversion verification

Date: 2026-09-16. Status: bounded adapters verified locally; interactive
presentation-application QA remains open. No push or release authorized.

## Dependency and conversion evidence

The separate `pptx` workspace exports usable public byte/model APIs. An original
public-API smoke test creates, serializes and reads a deck. Production conversion
does not construct ZIP/PresentationML, spawn a native tool or fetch a reference
deck. The safe-bash command delegates to the converter SDK and explicit resource
capability.

Original conversion cases independently inspect ZIP central/local records and
CRC, presentation slide relationship order (including more than nine slides),
text, media relationship targets/bytes, image geometry and layout-placeholder
geometry using builtin zlib and Saxes rather than the engine inspectors.
Memfs supplies unit mutation storage. Tests do not download fixtures, query LLMs
or invoke external executables.

The breadth review used the pinned upstream
[Writers.Powerpoint cases](https://github.com/jgm/pandoc/blob/c9a9a5eed7185783b69043e019c067370dc09615/test/Tests/Writers/Powerpoint.hs)
for breaks, preamble, nested lists/numbering/continuations, empty/title-only slides,
notes, links, tables with surrounding paragraphs, images and reference layouts.
Fixtures are original. Unsupported two-column layouts and table semantics are
rejected, not claimed as supported. No native editing or measured text fit claim.

TDD evidence: the new adapters initially had unavailable registry capabilities;
original tests exercised those failures before binding. Build dependency
admission failed against the new memfs peer fixture before its guard update.
The original placeholder case exposed fallback geometry in place of declared
geometry before correction. The added table-profile case failed with resolved
bytes instead of rejection (20 other cases passed), then unsupported column
formatting/multiple headers/footer semantics were rejected.

## Maintained checks

- Pandoc workspace unit route: 37 files, 956 tests passed.
- Pandoc workspace lint: ESLint and source/test TypeScript checks passed.
- Safe-bash maintained `test:runner`: 532 tests passed.
- Public portable bundle/declaration/packaged-consumer route: 4 tests passed.
- Normal root `npm run build`: passed, including the final table-profile change
  and root suffix stages/public bundles.
- Repository `npm run lint`: passed before the final table test; subsequent
  focused workspace lint covers that change.
- Full `npm test`: not a passing gate. It encountered the missing
  `docs/plans/archive/cli-aliasing.md` design-system fixture outside this task.
  That run also sampled the placeholder case before its fix; the current
  workspace suite verifies the corrected geometry. The task-owned full runner
  was stopped after those failures, before completing every declared workspace;
  it is neither a full-suite completion nor a current full-suite pass.
- Additional `npm run lint:packages`: failed on existing missing pandoc/PDF
  READMEs. README additions require user permission; no unrelated PDF change
  or silent documentation addition was made.

## Independent visual evidence

Original source: `pptx-qa-source.json`. Authored decks:
`pptx-qa-original.pptx` (four slides), `pptx-qa-reference.pptx` (4:3 title-only),
`pptx-qa-results.pptx` and `pptx-qa-media.pptx` (isolated preview slides).
Their adjacent `.pptx.png` files are macOS Quick Look previews generated with
`qlmanage -t -s 1600`, inspected visually on macOS 15.7.7 (24G720). Title/body,
blank, nested-list/table and image/link content rendered; 4:3 and 16:9 previews
retained their ratios. Bullet markers render close to labels; typography is a
bounded simple style. `pptx-cli-inventory.png` records actual converter inventory
through the repository screenshot helper, without a screenshot unit test.

`open -a /Applications/LibreOffice.app` accepted the deck, but LibreOffice startup
and an isolated headless version probe stalled. No interactive application-open
signoff, repair-dialog check, notes GUI check or PowerPoint interoperability pass
is claimed. Quick Look preview does not replace those checks. Remaining QA steps
are in `docs/plans/pandoc-pptx-conversion.md`.
