# Media editing research receipt

This receipt supplements the historical media inventory receipt. The operation surface and live object model are separate contracts; media editing does not establish whole-public-API or playback parity.

The complete inventories were read and filtered for movie, media, video, audio and poster identities. The [case ledger](media-editing-case-map.json) retains every matching record: 48 unit variants (45 core and three package-URI variants) and six expanded BDD scenarios. The [API ledger](media-editing-api-map.json) retains all 48 matching records from the 2,407-record public inventory, including inherited Movie members, public `_MediaFormat`, constructors, equality and enum helpers. No leading underscore is treated as private. Four enum values retain prior independent evidence; the remaining 44 live-model rows are explicit gaps. Full transitive obligations remain in public-api-map.json.

Each source parameter/example has its own row and original obligation. Existing inventory observations remain historical partial evidence, not a claim that a constructor, live property or creation scenario passes. Editing coverage is recorded separately with exact test names. Filename/extension defaults, allocation gaps, dedup hit/miss and all three timing structural variants must not be collapsed into generic coverage claims.

## JavaScript and security mappings

Media bytes are `Uint8Array`; admitted input/save operations are always async. A path is usable only through explicit VFS capability. No host path discovery, source runtime, media playback, transcoding or network lookup is available. MIME declarations describe a validated admission policy, not playback or complete codec support. Imported unsupported data stays opaque and preserves its graph.

Command/operation options use camelCase JSON fields and common selectors; the eventual live model retains `add_movie`, `media_type`, `media_format` and `poster_frame`. Corrected `add_movie` returns `Promise<Movie>`, not the incorrectly annotated BaseShape. Detached inventory or mutation results are not live Movie handles. Model enum symbols, equality, owner identity, bounds/collection helpers and the returned media-format interface remain separately registered gaps.

Video insertion and replacement require an explicitly supplied poster at the operation boundary. Audio insertion also requires an explicit supplied poster under the task instruction; the proposed optional audio-icon behavior remains an explicit scope difference. The source model's missing-poster default remains a future-model obligation, not implicit frame extraction or copied default artwork. SHA-1 is compatibility metadata only; SHA-256 identifies admitted/extracted bytes. External relationship targets remain inert. Read operations do not create timing or mutate resources.

## Disposable QA evidence

The existing small corpus template was checked against docs/pptx/corpus-manifest.json: 1,202,514 bytes; SHA-256 `885e923f148cdf4680372abe54496c824ab3a2a2d8a59fd9703d66e0aeb1164c`. Independent ZIP CRC verification passed for all 38 entries and every XML/relationship part parsed. This establishes input identity and parseability only; current product editing results are recorded below when executed.

The manifested large media deck contains a 453,608,531-byte movie, exceeding the default 256 MiB individual media ceiling. Its earlier limit-rejection receipt remains historical evidence; no new full-deck edit, playback, render or visual fidelity success is claimed. All procedures are in [the plan](../plans/pptx-media-editing.md). No corpus bytes are shipped or used by unit tests.

Original authored TypeScript assertions/assets do not copy reference implementation or fixtures. Provenance remains in research and the existing standalone [license notice](upstream-license-notice.txt); substantial derived material would require retaining that notice independently. No product branding or test names contain reference-project identities.

## Current executed smoke

The public SDK exports inserted original 16-byte container bytes and a supplied original 1-pixel GIF poster into the manifested small template, then replaced the clip bytes. The resulting disposable archive was 1,203,178 bytes with 42 ZIP entries, one occurrence, two clip relationships and one poster; replacement reported one affected object. SDK reinspection showed unchanged timing and `playbackVerified: false`. Independent Python ZIP CRC/XML reopening verified both relationships address the replacement bytes, the `video/mp4` content type and retained trim 10/20 milliseconds, loop and volume 43000. Output SHA-256 was `0f73d439a623f7efa3a665ed166e9c40851a0057f92cf4134510e34d83873e8c`. The original input remained untouched. No rendering/playback or large-deck edit was attempted.

The supplemental original behavior suite initially passed nine of ten variants and failed byte-identical media reuse. The domain owner received this concrete failure before the deduplication fix. Allocation variants, empty/existing insertion and all three timing structures have independent original assertions. Current final maintained checks are reported by the coordinating owner.

The extraction owner reports 16 original public-SDK tests passing in 68 ms after 16 initial missing-export failures. These distinguish per-occurrence outputs from duplicate bindings, explicit byte deduplication/provenance, distinct imported fallback resources, cumulative/exact output budgets, inert external rejection, opaque unknown-type filenames and hostile options/cancellation.

After the domain deduplication fix and parsed fixture construction, all 10 supplemental cases passed in 394 ms. The assertions independently inspect emitted ZIP members, media targets, original byte equality, geometry literals, timing preservation and relationship identity. Existing XML is changed through parsed structured splicing in fixture setup; no unit test downloads or writes host files.

The adapter owner reports seven command-engine cases and four safe-bash Shell adapter cases passing for add/replace/extract. Direct flags include explicit geometry/type/kind/poster, trim/loop/volume, shared replacement, extraction deduplication, atomic publication and explicit partial-output handling. Media set/remove remain unexposed. The supplemental test file passed ESLint. Automated ledger consistency checks matched all 54 source case identities and 48 direct public API identities against the full inventories; all exact new test-name links resolve. Twenty-six source rows have new operation-level assertion links, while 28 retain explicit gaps/prior observations; this does not count live-model behavior as implemented.

The corpus smoke was rerun after the final manual-action and resource-deduplication changes. Independent reopening additionally verified the manual `ppaction://media` action and indefinite initial timing; the size/hash above describe this final output. The coordinating owner reports the maintained PPTX package suite passing all 3,819 tests across 141 files. Final lint results remain the coordinating owner's delivery responsibility.
