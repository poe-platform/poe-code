# Chart and object follow-up QA

This is an agent-executed procedure. Native Gnumeric is a separate oracle;
no product or unit-test path may invoke it. Preserve previous evidence and
unrelated edits. Do not push, publish, edit READMEs or commit the pre-existing
untracked ssconvert implementation.

## Procedure

1. Authenticate the existing official archive in `out/ssconvert-lifecycle`:
   SHA-256 must be `2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12`.
   Use `docs/ssconvert/reference-profile.json` for the captured dependencies,
   plugins and locales; its incomplete optional profiles remain unverified.
2. Run original in-memory XML and passive SDK records through rename, merge,
   resize and XML round trip. Independently distinguish literal GOffice data
   from Gnumeric expressions. Foreign namespaces, non-graph objects and opaque
   properties must not acquire expression-rewrite or graph-render authority.
3. Verify passive paint metadata and graph-only export selection independently.
   Use injected byte I/O, cancellation and memfs for unit file changes. Verify
   a rejected ownership or work-budget case creates no output. Cross-realm
   projection and workbook-snapshot admission are separate runtime cells.
4. Have a different agent stress and fix implemented boundaries, with root
   retaining exports, integration and Git ownership. Record independent cases
   in `ssconvert-object-data-independent-qa.md`.
5. Run maintained uncached ssconvert build closure, fresh package unit route,
   package ESLint/product/test TypeScript, and existing safe-bash ssconvert
   command/model integration cases. Investigate every failure and rerun the
   complete failed scope. A focused rerun alone is not a completed package gate.
6. Manually run the virtual command in a MemoryFileSystem using the shared
   engine, once on XML with only an embedded image and once on a linked graph
   with no renderer. Inspect status, diagnostics and exact namespace effects.
   Capture and view a CLI screenshot. Store owned scratch in `out` and purge
   it after reducing observations.
7. Bind the evidence to base HEAD and SHA-256 of every changed product/test file.
   This workspace contains pre-existing untracked implementation; a dirty-file
   hash binding is not a committed candidate or remote delivery.

## Compatibility boundaries

The stable sheet-object registry includes all 18 released concrete object
classes and their historical aliases. It records canonical XML export names
without changing imported spellings. `GnmSOPolygon` is a notable source edge:
its writer emits `SheetObjectPolygon`, its Cairo method is empty and it has
no specialized SAX parser; the reader has no matching export-name alias.
Do not invent polygon round-trip or printing fidelity.

The GOffice 0.10.61 census covers all ten plugin manifests: six plot plugins,
three trendline plugins and optional Lasem. Commented-out `GogDoubleHistogramPlot`
is not a service. The registry is source metadata, not activation, rendering
or codec-compatibility evidence. Plot-type minor variants, plugin-specific
defaults and runtime validation remain unqualified.

| Codec | Current preservation/render boundary | Qualification |
| --- | --- | --- |
| Gnumeric XML/gzip | Grammar-filtered passive object tree; shared chart links, styles, text, names/order and anchors | Original semantic unit round trips; native defaults/spelling/opaque-policy parity unmeasured |
| XLSX | Existing selected drawing/VML/related package parts; no new semantic chart/drawing handler | Shared model translation and native preserve/drop/reject policies unimplemented/unmeasured |
| ODS/SXC | Existing selected image/chart package parts and mapped comments | Full shared-model object translation and native policies unimplemented/unmeasured |
| XLS BIFF | Existing partial binary codecs | Chart/drawing/control object translation unimplemented/unmeasured |
| SVG/PDF/HTML/document export | Existing codec behavior only | Native chart/image/shape/text print/render policy unqualified |
| Text/data exports | Existing cell-oriented behavior only | Per-object native drop/reject diagnostics unqualified |
| `--export-graphs` | Graph classes only in admitted namespaces; nonempty graphs require explicit rendering capability | Selection negative controls verified; graph painting unimplemented |

Literal data is retained as serialized metadata; only `GnmGODataScalar`,
`GnmGODataVector` and `GnmGODataMatrix` acquire expression semantics. Abstract,
unknown and missing types acquire none. The native reader rejects unknown,
abstract and missing dimension types; passive product retention of those trees
is a remaining mismatch, not native preservation parity. Serialized vector
multiple-expression dialects are not qualified by these single-range cases.

Styles expose persisted attributes, including colors/fills/fonts/lines/markers
and text rotation. Automatic styles, numeric/color normalization, font metrics,
image decoding, control execution and chart painting are not implemented by
this projection. No metadata access resolves image URIs or runs scripts/macros.
The broader task remains incomplete until semantic codec handlers, native
policy matrix and required rendering/runtime cells are implemented and measured.

## Verification record

Executed on Node v22.22.2, Darwin arm64, against base HEAD
`b97c4938a469ee70e09bd08a0e5fcf7e868ca04c` plus the file bindings below.
The pre-existing ssconvert implementation and safe-bash integration are untracked
or edited in this workspace. No commit, remote-main delivery or release occurred.
No README was edited. Existing tracked edits remain unchanged by this task.

Passes:

- Official primary source archive hash matched the supplied digest.
- `npm run build:workspaces -- --workspace=@poe-code/ssconvert --no-cache`
  passed the maintained office-package/safe-fs/ssconvert build closure after
  the final product changes. Later changes affect test fixtures only.
- Final `npm run lint --workspace=@poe-code/ssconvert` passed ESLint,
  product TypeScript and test TypeScript.
- Final fresh `npm test --workspace=@poe-code/ssconvert` passed all 250 files
  and 5,407 tests, including 42 object-model tests. This complete package rerun
  supersedes the two failed intermediate runs; it is not a repository-wide gate.
- Existing safe-bash command/model integration: 61 passed, zero failed,
  skipped, cancelled or TODO. These cases include command/SDK diagnostics,
  status, namespace effects and checkpoint/replay. They do not qualify newly
  implemented native chart painting.
- Original chart-link cases verify rename, collision merge, shrink clipping
  and removed references while preserving literal title/vector metadata.
  Added memfs command/SDK update/recalc case verifies identical output bytes,
  live linked expressions and original/checkpoint/replay cell values 10/14.
  Gnumeric XML does not persist these formula caches; reimport is explicitly
  recalculated before inspecting numeric values.
- A different agent reproduced and fixed four structural namespace/object
  rewrite defects and mutable registry descriptors. Its independent graph-only
  and passive-style negative controls passed. See the independent QA record.
- Manual shared-engine virtual command: image-only export exited 0 with no
  diagnostics/output file. Linked graph without renderer exited 1 with exact
  `Unsupported ssconvert feature: graph export\n`; no output file was created.
  Final VFS names were exactly `graph.xml,image.xml`.
- Maintained generic CLI screenshot tooling ran against the virtual-command
  host and the resulting screenshot was viewed. It clearly displayed both
  commands, statuses, diagnostic and unchanged namespace. Screenshot SHA-256
  before scratch purge: `f73d351b7da3c83c7e80c6eb2e15d94d43e8a401b2a192418cb1c97d91dda9e4`.
  The root poe-code screenshot route was not used: this is an opt-in virtual
  command, not a new root poe-code command or visual design change.

Failures investigated and resolved:

- Initial literal-data regression: rename/merge rejected a literal chart title
  as formula syntax. This was concrete failing evidence before implementation.
- Initial resize fixture used unsupported 2×2 dimensions; corrected to the
  maintained 128×128 minimum and tested references through row 129. Existing
  quoted sheet serialization was retained; incorrect unquoted expectations
  were corrected without changing the serializer.
- Initial graph-export negative control admitted a foreign-namespace graph;
  shared classification now also requires matching namespace.
- First full package run: one merge test failed because its fixture omitted
  dimension type. Released GOffice rejects missing types; corrected the fixture
  to specify `GnmGODataVector` without weakening the rename assertion.
- Second full package run: one independent descriptor-immutability test failed
  while review changes were landing. Descriptors are now frozen; the complete
  package scope was rerun against final inputs.
- New recalc characterization initially had an incorrect CLI import path,
  then expected formula caches immediately after XML import. Corrected the
  import and explicitly recalculated the reopened workbook. The resulting
  four original data-link/lifecycle tests pass; no production cache behavior
  was changed to satisfy the test.

Skips/unverified:

- Repository-wide `npm test`, repository-wide lint and root suffix build were
  not run. Changes are confined to ssconvert; its complete package checks,
  maintained dependency build closure and selected safe-bash consumer checks
  cover this local scope. No repository-wide gate is claimed.
- No fresh native differential, optional-plugin runtime cells, native printing,
  bounded performance cohort or full object codec policy matrix was captured.
  The existing reference profile is provenance only.
- Cross-realm projection passes; cross-realm workbook rename remains unsupported
  at the existing snapshot prototype guard. This is not a realm parity pass.
- Semantic XLS/XLSX/ODS/SXC chart/drawing translation, native object defaults,
  opaque-payload parity and chart/image/text rendering remain incomplete as
  described in the matrix above. No unmeasured cell is counted as passing.

## Exact working-file bindings

| File under packages/ssconvert/src | SHA-256 |
| --- | --- |
| objects/index.ts | `5b80534a9c66e38f0c52d9caa96bb2cc8a5f875822e2894c4af05d891e5063bb` |
| objects/data.ts | `510113e15eb88a3fd0e12d32215b93ab921084cff136603990939cd279c9d855` |
| objects/registry.ts | `2301fce5b3543f40e4aabf7bb0cd01be4954e6c824bdf51b81edd88328f617c0` |
| formulas/workbook.ts | `eebf7b11693431efb70e11eeb8a030bbdd0f45d473ca007b3bf681f7b45d753d` |
| rendering.ts | `7248ea9820ffffd3649959d16b361321c82000462721a7b0e167dae143a23ebb` |
| codecs/gnumeric.ts | `ecd5e68ed790f4d6bbe158948dc35e5614976bfc9f84eb58684ecf2d002c407e` |
| objects/styles.test.ts | `3b086834bb5d24c2fcb6b001b9683d5a4c39a5aea723946adb4cc9c656cfcfdf` |
| objects/data-links.test.ts | `89f85c5df4170ac0adf018a08dbd5041b8596a5cbf8e6541eb8efa8af23e9726` |
| objects/graph-export.test.ts | `c8ecf3688698bbfd6e89a45372452079c7ae994373829b0ae15129eb706ccd60` |
| objects/data-independent.test.ts | `1053734a881c2f36f7a0372181b1afec9a88277f44434716f6ea05e04f689b02` |
| objects/registry-independent.test.ts | `0cd412b06c2312a60cc91dceaecb45801c227961bb9df9cedcd7a1ba4f6710f8` |
| objects/model.test.ts | `51b8efe1a3f0d243d2896f83b4f5e81b207ddbbf59904bcf582eaad14cbd4a65` |
| workbook/merge.test.ts | `45ace10208f3a678e3e72e5c877617e8dce1e5ec66d2728a7bcd40d0af4f589e` |
