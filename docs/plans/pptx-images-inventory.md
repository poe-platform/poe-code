# PPTX image inventory

Scope: F30 read-only image occurrences and unique media parts, with F34 retained
vector/fallback references. No image insertion/replacement/extraction, whole
pipeline execution, README edits, push or release is authorized by this slice.

## Ownership

- `image_domain`: `packages/pptx/src/images.ts`, its schema, public exports and
  original SDK tests.
- `image_metadata`: bounded intrinsic image-header metadata and original tests.
- `image_cli`: command-engine wiring and real safe-bash Shell memfs regressions,
  required test discovery registration and visual CLI review.
- Root: research/API/case accounting, disposable corpus QA, integration review,
  maintained checks and explicit-file local commits on main.

Existing unrelated changes remain outside these assignments.

## Procedure

1. Establish missing SDK/CLI image inventory with failing original tests.
2. Distinguish structural occurrences, source relationships and unique part
   identities. Default media records retain distinct parts; explicit `--unique`
   groups equal hashes while retaining all contributing part names, as required
   by the shared CLI contract. Preserve external targets without dereferencing.
3. Read slide-local content by default and require explicit notes/layout/master
   scope. Report inherited use as provenance, not proof of rendered visibility.
4. Cover shared resources, backgrounds, SVG raster fallbacks, MCE branches,
   relationship namespaces, crop defaults/negative/greater-than-one values,
   alt text and dimensions. Characterize bounded raster headers without decoding;
   unsupported intrinsic dimensions remain explicit null metadata.
5. Reconcile all inventory-relevant parameter variants and expanded BDD rows in
   a separate research receipt. Retain adjacent mutation/model API obligations
   as visible gaps rather than counting inventory output as model parity.
6. Run the PPTX maintained unit/lint/build routes and focused real-Shell tests;
   check generated help/schema/capabilities and inspect actual output screenshots.
7. Use only existing manifest-listed disposable corpus inputs for QA, verify their
   hashes, compare source relationship/media counts independently, and reduce any
   meaningful finding to a small original regression. Never stage corpus bytes.
8. Commit each verified atomic improvement with named owned paths and its plan
   evidence. Report hashes as local commits; do not push or release.

Research authority: `docs/specs/pptx.md`, shared office CLI/SDK contracts,
`docs/pptx/upstream-test-audit.md`, both upstream inventories, the current
language-mapping register and `docs/pptx/corpus-manifest.json`. Reference identities
remain in research and existing standalone legal notices only.

## Evidence

### TDD and review

- Original SDK tests initially failed on the absent module; actual Shell tests
  initially failed with exit 2, unsupported operation.
- Original regressions cover crop defaults/negative/greater-than-one values,
  seven audited unit variants and both crop read BDD examples, repeated media,
  SVG fallbacks, linked targets, picture numbering, inherited master backgrounds,
  notes, Strict namespaces, MCE references and shape fills.
- Final read-gap regression adds signed decimal-percent crop values and rejects
  malformed percentage spellings, preserving the same fractional semantics as
  integer hundred-thousandths without regexes or coercing exponent syntax.
- Review findings reduced to failing original cases before fixing: filtered
  occurrence IDs changed, binary parts entered the drawing-owner scan, package
  entry order affected output, fallback references shifted picture numbering,
  mixed MIME declarations disappeared during hash grouping, and human `--unique`
  output still listed occurrences. The fixes retain structural provenance.
- Research receipt keeps all 80 selected unit variants and 41 expanded BDD rows
  separately. Eighteen rows have inventory behavior evidence, seven partial
  inventory evidence, one deliberate inventory extension, and 95 adjacent model/
  editing obligations remain visible. No whole-row model parity is asserted.
- The API receipt retains 99 image/picture/movie/placeholder records, including
  inherited members and underscore-prefixed returned interfaces. Operation reads
  do not count as implemented live model getters/setters. Existing standalone
  legal notices remain intact; no reference fixture assets were copied.

### Disposable corpus QA

All four selected files already existed in the manifest cache. Each SHA-256 was
verified before QA and after reading. Independent ZIP/XML inspection counted
`blip`/`svgBlip` relationship attributes by drawing-owner scope. The public built
SDK matched the counts below; every returned media part's byte length and SHA-256
matched the manifest's independent media census. No input bytes changed.

| Manifest basename | Slides | Layouts | Masters | Notes |
| --- | ---: | ---: | ---: | ---: |
| IXPE-Presentation-Template.pptx | 0 | 1 | 1 | 0 |
| CERN-job-opp-250925.pptx | 1 | 1 | 0 | 0 |
| ISOLDE-drawings.pptx | 12 | 0 | 0 | 0 |
| WWL-template-1slide.pptx | 1 | 0 | 0 | 0 |

These are structural reference counts, not displayed-image counts. All resources
in these four decks were internal. Linked/vector/MCE cases use original unit
fixtures. No new corpus defect was found; no downloads, rendering runtime, source
asset copies or cleanup of another campaign's cache occurred.

### Maintained checks and visual review

- Maintained PPTX build closure passed using
  `npm run build:workspaces -- --workspace=pptx` (declaration-derived dependency
  closure, including shared package and schema dependencies).
- Final `npm run test --workspace=pptx` passed 3,028 tests in 105 files (43.49 s).
  Final `npm run lint --workspace=pptx` passed ESLint and both TypeScript projects.
  The header helper contributed 30 original cases; image inventory has 46
  original SDK cases. The final selected build closure also passed after the
  percentage-crop fix.
- All 105 actual Shell PPTX adapter tests passed with
  `node --import tsx --test packages/safe-bash/tests/commands/pptx/*.test.ts`.
  Four new image cases cover default/unique output, scoped reads, schema/errors,
  and human hash-group output. All four passed again against the final rebuilt
  package after the last domain changes.
- Actual success and error envelopes validate against generated result schemas.
  The exact-path normal-runner registration check passed, admitting the new file
  among all discovered active paths. Focused adapter test/registration ESLint passed.
- Root and CLI owner opened `/tmp/pptx-images-cli.png`, showing actual Shell list,
  unique hash groups, focused help and invalid-position output. It is readable
  without clipping. This optional injected command uses the existing terminal
  PNG renderer because the root screenshot wrapper cannot register its plugin;
  no screenshot test or image artifact is committed.
- `npm run typecheck --workspace=virtual-bash` passed source/tests and all 26
  public-consumer groups; three expected negative consumers rejected with exit 2.
  The route reported `typecheck-passed-not-runtime-acceptance` and cleaned its
  temporary inputs. Runtime evidence is the separate actual Shell test route.
- Validated all 121 research source pointers and original test paths, and retained
  all 99 API receipt records. Whitespace checks and product-identity scan passed.
- Local metadata commit: `a3ee05354`. No push, remote-main delivery or release was
  performed. Inventory integration is a separate local atomic commit containing
  this plan, its original tests, research receipts and draft usage.
