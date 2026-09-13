# Media inventory implementation and QA

Scope: bounded read-only inventory for F42/F43 and media-associated F45. This task does not execute the full pipeline, push, release, edit README, or claim playback. Product logic belongs in `packages/pptx`; adapters belong in `packages/safe-bash/src/commands/pptx`.

## Ownership and acceptance

The domain owner implements original media parsing and fast authored tests. The CLI owner wires the same SDK behavior, schema/help/capabilities and original memfs tests. The research owner maintains the case/API ledgers, draft usage and disposable corpus evidence. The coordinating owner runs maintained checks and commits explicitly named owned files on main.

Inventory must distinguish occurrences from resources, embedded from external relationships, content types and SHA-256 hashes, posters, playback metadata, captions and timing target associations. Multiple relationships to one media part remain distinct associations. External targets are inert and are never opened. Parsing metadata proves neither decoding nor playback.

Every selected source parameter variant and BDD example stays in `docs/pptx/media-case-map.json`. Model construction/insertion/editing and unimplemented live APIs remain explicit pending rows. `docs/pptx/media-api-map.json` retains inherited and underscore-prefixed obligations and exact proposed signatures/security mappings. Reference identities remain in research and required standalone notices; tests use original XML/bytes and independent expectations.

## Agent-executed QA procedure

1. Read `docs/pptx/corpus-manifest.json`; use only existing listed disposable inputs. Never download for unit tests or stage the cache.
2. Verify the selected deck's SHA-256 with bounded streaming reads, then independently inspect ZIP relationships, XML target IDs and media hashes. Record concise findings in `docs/pptx/media-corpus-evidence.json`.
3. The listed large-media deck is about 457.5 MB with a 453.6 MB MP4, exceeding ordinary limits. Exercise ordinary limit rejection; run inventory only with explicit trusted limits within available memory. Do not silently relax product defaults.
4. Compare SDK output to independently parsed evidence: one embedded MP4 resource, both relationship IDs, same owning shape, poster metadata and timing volume/target. Exercise the exposed CLI against an original tiny equivalent so the large file does not burden unit tests.
5. Reduce meaningful findings into original tiny regressions, especially internal `r:link`, duplicate references and media-target timing. Do not copy publisher media, original product assets or source fixture bytes.
6. Run narrow maintained package tests/lint and applicable adapter checks. Inspect help/error screenshots where CLI output changes. Record exact commands/results in the delivery receipt.
7. Stage only explicit owned source/tests/research/plan files after checks; commit atomically on main. Report local hashes separately. No push or release.

## Findings so far

The cached large-media deck and MP4 match manifest hashes. Slide 1 has separate video and media relationships to the same MP4. The `videoFile` element uses `r:link` for an internal relationship; attribute spelling alone cannot classify linked/external content. A media timing node has `vol="80000"` and references shape ID 4. Product QA remains separately recorded in the evidence file.

## Final integration receipt

The maintained selected build `npm run build:workspaces -- --workspace=pptx`
passed its declared dependency closure. `npm run test:unit --workspace=pptx`
passed 137 files / 3,759 cases. `npm run lint --workspace=pptx` passed ESLint,
source TypeScript and test TypeScript checks. The final suite followed the
24-case domain green checkpoint; the earlier integration suite saw five new
media regressions still red while implementation was in progress. Those cases
now pass; no failure was waived. An intermediate build exposed the string-name
versus numeric-position selector mismatch, resolved to the shared named-shape
contract before final build success.

The maintained safe-bash reporter passed all three media adapter cases, including
embedded shared relationships, posters, captions, timing, inert linked targets,
SDK parity, stdin and bounded output. Both discovery assertions and focused
guarded lint checks passed; exact receipts are in `pptx-media-cli.md`.
The coordinating agent inspected `.cache/pptx-media-help.png`: complete legible
help and explicit playback limitation, no clipping. The image remains disposable.

Delivery is one atomic read-only media inventory improvement. Stage the new media
source/schema/tests, two media plans and five research/usage files as enumerated
in this plan's ownership, plus only media wiring hunks in command-engine.ts,
index.ts and the safe-bash test discovery assertion. Existing unrelated image
replacement changes remain unstaged. No README or ignored fixtures are included.
No whole pipeline, push or release was run; the local commit hash is reported
separately in the completion message. Broader insertion/extraction/editing and
live-model parity remain explicitly unimplemented in the research ledgers.
