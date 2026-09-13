# PPTX media editing

## Final integration receipt

`npm run test:unit --workspace=pptx` passed 141 files and 3,819 cases.
`npm run lint --workspace=pptx` passed ESLint and both source/test TypeScript
checks. Its first final attempt exposed overly narrow typed-array inference in
two original fixture helpers; explicit Uint8Array annotations fixed those
compile errors without changing assertions or runtime behavior.
`npm run build:workspaces -- --workspace=pptx` passed the maintained declared
dependency closure. The final rebuilt public exports passed all four actual
safe-bash adapter cases. Exact guarded adapter lint and inspected help screenshot
receipts are in pptx-media-editing-cli.md; corpus results are in the research
receipt. No playback or rendering acceptance is claimed.

Atomic staging includes media-editing, media-extraction, command-media-editing,
their tests, media-behavior-cases.test.ts, media-schema.ts, command-media.test.ts,
the existing safe-bash media-inventory test, the two new media-editing plans and
four new media-editing research/usage files. Only media wiring is staged from
command-engine.ts and index.ts. A temporary three-way source overlay excluded
the pre-existing image edits; independent TypeScript compilation of that exact
owned source overlay reported zero diagnostics. The working copies retain all
unrelated edits. Existing standalone legal notices remain intact.

Delivery is a local Conventional Commit on main, with no push or release.
Media set/remove and the remaining live Movie/media-format model members are
not claimed implemented; their explicit public obligations remain in the
research ledgers. The implemented operation profile is add/replace/extract plus
the existing list/get inventory, using original supplied assets and inert tooling.

Scope: implement declared audio/video insertion and replacement from explicit supplied bytes, valid content types, supplied audio/video/replacement posters, complete relationships and retained timing metadata. Domain ownership is packages/pptx; safe-bash only adapts capabilities in its pptx command directory. No pipeline execution, push, release, README edit, native runtime, product network or implicit host I/O.

Read root and scoped instructions, docs/specs/pptx.md F42/F43 and media command table, office-cli.md, office-sdk.md, both upstream audits and full inventories. Existing media inventory receipts are historical; the new media-editing ledgers retain all 48 unit variants, six BDD examples and 48 direct public API records. Research identities remain in these ledgers and required standalone notices. Original tests and authored assets do not derive code or binary fixtures from the reference project.

## Ownership and acceptance

The domain delegate owns media admission/editing tests and implementation. The adapter delegate owns media command schema/dispatch and CLI tests. The coordinating owner owns integration, maintained checks and atomic local commits. The research delegate owns this plan, media-editing-case-map.json, media-editing-api-map.json, media-editing-evidence.md and media-editing-usage.md. Preserve all unrelated changes.

Start each code change with an original failing test. Independently assert content types, bytes, relationships, poster references, timing target IDs and metadata through exported SDK and CLI operations. Include wrong MIME/kind, missing posters, byte ceilings, shared resource replacement intent, imported relationship graphs, allocation/dedup variants and preservation. Retain explicit live-model gaps instead of claiming operation APIs mirror Movie/_MediaFormat. Run narrow maintained package/adapter checks and review screenshots for changed CLI output. Commit only named owned files with Conventional Commits after checks pass; report local hashes separately.

## Disposable corpus QA procedure

1. Read docs/pptx/corpus-manifest.json and use existing verified cached files only; no downloads are required. Keep all edited outputs disposable and ignored.
2. Independently hash and reopen ZIP/XML of the small manifested template. Add original small audio/video bytes and supplied poster via the product capability boundary; save to a separate output and independently inspect content types, both media relationships, poster and timing targets.
3. For imported media, use the manifested large deck only within explicit byte/resource limits. Its 453,608,531-byte media part exceeds the default 256 MiB media-part ceiling. Limit rejection is valid evidence, never a full editing/playback success. Avoid large allocations without sufficient resources.
4. Reduce meaningful imported graph findings to tiny original in-memory fixtures. Re-read replacements and verify all owners retain valid relationships, captions/extensions/timing survive, and unselected shared resources remain unchanged unless explicit resource replacement is selected.
5. Report exactly which product QA actions executed, independent reopening and any visual verification separately. Parsing never proves playback; tooling must not autoplay or transcode. Never stage cached input/output fixtures.

## Progress

- Confirmed complete direct media selections against both full inventories: no omitted keyword-matching unit, BDD or API record beyond the retained ledgers.
- Retained all inherited and leading-underscore public media members; four enum values have earlier evidence and 44 model rows remain explicit gaps.
- Implementation and current check receipts are recorded in docs/pptx/media-editing-evidence.md when available.

- Public SDK corpus insertion/replacement and independent ZIP/XML reopening passed on the existing small template; output remains disposable.
- Added 10 original supplemental behavior cases. Dedup identity-hit failed before the domain fix; final suite passed 10/10 in 394 ms. Fixture mutation uses parsed XML splicing with memfs-backed archive bytes.

- Reran the complete small-template SDK smoke on final domain code and independently verified explicit manual media action plus indefinite timing, final bytes and graph. Maintained package tests: 141 files / 3,819 tests passed, reported by coordinating owner.
