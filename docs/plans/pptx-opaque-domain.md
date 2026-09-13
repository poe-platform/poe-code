# Opaque package resources

Scope: F53 inventory/extraction/preservation and F54 embedded font declarations/parts. Own `packages/pptx/src/opaque-objects.ts`, `opaque-objects.test.ts`, `opaque-import.test.ts`, and this plan. Engine/schema/adapter integration and research accounting are separately owned. No README edits, downloads, native execution, commits or pushes by this delegated task.

## Design and security mapping

`readObjects(input, context)` admits explicit bounded bytes, inventories package relationships and content types, and classifies OLE, embedded packages, controls, web extensions, fonts, 3D model parts and detectable active payloads. Signature inspection is bounded to the first eight bytes; it does not interpret embedded containers. OLE, packages, controls, extensions and macros are conservatively marked potentially active. This is evidence of potential active content, not a malware scan or assurance that unflagged bytes are safe.

`extractObject(input, {part}, context)` requires an exact admitted package part selector and returns owned byte arrays. It gathers transitive package relationship closure, preserves cycles and external relationship metadata without resolution, rejects dangling internal dependencies, and returns original relationship sidecars byte for byte. Every file includes its original part identity and an opaque SHA-256-derived ASCII basename; no embedded filename becomes an output path. The output mapping and relationship edges allow preservation without claiming the renamed files form a directly loadable package. Publication authority and transaction behavior remain in the command adapter.

`readFonts(input, context)` lists embedded font declarations from the presentation root and variant bindings, including unresolved bindings. Font payloads remain uninterpreted. It neither installs fonts nor claims rendering, font-license rights, or redistribution permission. Generic text-font declarations remain covered by existing text inspection rather than this embedded-font interface.

Slide import already rejects unsupported object dependencies and presentation-wide embedded font declarations. Original regression cases verify rejection without changing either input byte array; no unsafe remapping exception was added. OLE creation, live returned object formatting interfaces, program-ID enums and broad object mutation remain separate work and cannot be claimed complete from this slice.

## TDD and checks

- First run failed because the new opaque module was absent; implemented inventory/extraction and obtained 15 passing original cases.
- Added embedded font declaration case: failed because `readFonts` was absent, then passed after implementation.
- Added generic-content macro relationship case: failed with no inventory entry, then passed after adding the exact relationship classification.
- Expanded positive/negative signature, safe extraction, cycle/closure, byte ownership, accessor rejection, and unsupported import regressions.
- Unit fixtures are small original archives admitted through memfs or owned byte arrays. No downloaded corpus is a unit dependency. Checks use independent expected bytes, a fixed independently calculated hash, explicit relationship targets and expected metadata.
- Final focused run: `npx vitest run packages/pptx/src/opaque-objects.test.ts packages/pptx/src/opaque-import.test.ts` passed all 30 cases (22 inventory/extraction/fonts, eight import-rejection cases). Scoped ESLint passed for all three owned TypeScript files. The coordinating agent runs the maintained package test/lint checks and records final delivery.

## Disposable QA procedure

Consult `docs/pptx/corpus-manifest.json`; use only listed already acquired disposable fixtures. Run `readObjects` with manifest-compatible explicit limits, select any reported opaque part, and compare extracted bytes with independently decoded original ZIP member bytes and SHA-256. Record findings in research accounting. Do not install/execute/extract nested containers, stage corpus files, or run the complete pipeline. Reduce a meaningful finding to a small original memfs regression before fixing it.
