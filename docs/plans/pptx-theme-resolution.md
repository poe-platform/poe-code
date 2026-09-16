# Read-only text style resolution

Scope: the theme-resolution task only. Do not run later theme-editing or text-editing tasks. Main branch; local commit only. No README edits, corpus changes, runtime network, host I/O or native runtime dependencies.

Implementation exposes `inventory.textStyles` through `readSelectionIndex` and `pptx inspect`. The bounded subset is bold, italic, font size in points, Latin/East Asian/complex-script typefaces and untransformed RGB/scheme text colors. Each value records the source part, structural property path, originating token and theme/map references. Missing and unresolved values are distinct. Full formatting and whole-model API parity remain unclaimed.

Original tests first demonstrated a missing resolver, then a missing SDK inventory field; additional failing tests demonstrated absent font-reference fallback and incorrect master placeholder selection. Resolution reads XML only. It must never serialize or materialize inheritance.

## Verification procedure

1. Run focused resolver and memfs SDK/command tests. Check independent literal values, explicit false, missing-value inheritance, all six theme font variants, sparse placeholder matching, theme replacement and override precedence.
2. Run the maintained pptx workspace unit and lint routes, then its explicitly selected build closure. Do not run the whole pipeline.
3. Read one verified disposable corpus file from `docs/pptx/corpus-manifest.json`, verify its hash, inspect via SDK and command engine under explicit byte/XML limits, and compare bytes before/after. A corpus input is QA only, never a unit fixture or shipment.
4. Inspect a terminal PNG of actual command output using the maintained screenshot tool or terminal-png renderer. The root screenshot-poe-code entry does not directly expose this plugin; use the same command engine invoked by the adapter. Keep output in the ignored cache.
5. Record any concrete findings and reduce them into small original regressions before committing. Stage only named files owned by this task.

## Boundaries and language mappings

The operation inventory is a readonly snapshot, not a replacement for the planned live `Font` object API. Neutral model member names and all public/inherited/underscore-prefixed API obligations remain in the existing API register. Async admission remains `readSelectionIndex(input, explicitContext)`. Paragraph/run indexes in the inventory are zero-based; command slide selectors stay one-based. Absent properties use null rather than zero/false. Point size is explicitly a display value; the future model size getter retains its documented unit contract. Unknown color kinds, color transforms, empty theme font entries and unknown theme tokens remain unresolved. No ambient font lookup, script inference, rendering or color-profile conversion occurs.

This step does not implement shape fill/line/effects, tables/charts, language-specific supplemental theme font selection, font editing or the full live model. Those remain visible obligations, not private exclusions. Inspection remains conservative about whole-format capability.

## Results

- SDK and command schema regression passed; 30 focused original cases passed. The original absent/false/true font variants remain separate parameter cases.
- The selected workspace build closure passed (pptx plus its declared build dependencies).
- Corpus QA: the manifest-listed IXPE template matched SHA-256 `885e923f148cdf4680372abe54496c824ab3a2a2d8a59fd9703d66e0aeb1164c` before and after read-only inspection. SDK and CLI both returned 20 style records across five slides. Of 140 property resolutions, 42 resolved, 38 were absent, and 60 stayed unresolved (40 unavailable theme fonts, 12 transformed colors, 8 unsupported system colors). This is preservation/inspection evidence, not slide-rendering fidelity evidence.
- Reviewed the actual human command transcript rendered with terminal-png: five readable slide rows, no clipping. Disposable output was not staged.
- The system-color QA observation is covered by an original regression that preserves the scheme token and refuses to report `lastClr` as the actual resolved system color.
- [Case receipt](../pptx/theme-resolution-accounting.json) retains 112 relevant/adjacent source identities and ten Font API records. Ten isolated getter variants have original read-behavior evidence. Live-model getters/setters, enums, brightness and other adjacent cases remain explicit open obligations; no whole-API parity or completion of those cases is claimed.
- [Usage draft](../pptx/text-style-resolution.md) records the exact operation subset, units, source provenance and unresolved boundaries. Historical audit statements that SDK implementation had not started remain historical baseline statements; this receipt describes the new operation inventory and does not relabel the future live model as implemented.
- No source implementation or binary assets were copied. Arbitrary test text is original. Existing standalone research/legal notices were preserved.
- Final maintained checks passed: `npm run test:unit --workspace=pptx` (43 files, 1,136 tests), `npm run lint --workspace=pptx`, selected `npm run build:workspaces -- --workspace=pptx`, owned-source formatting and `git diff --check`. Delivery is a local atomic commit on main; no push or release.
