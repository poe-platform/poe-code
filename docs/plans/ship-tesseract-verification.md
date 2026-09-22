# ship-tesseract verification

Reviewed the current candidate on 2026-09-20. Followed the package pattern at
[its current archived location](archive/safe-bash-command-package-pattern.md)
without restoring its unrelated deletion. Task changes are documentation only:
the command README, the existing Safe Bash tesseract support paragraph, and this
receipt. No runtime/export/build/registration code was changed; no speculative
engine repair or TDD code cycle was needed. Unrelated working-tree edits were
preserved.

## Markdown QA executed

1. Inspect the private manifest, argument parser, command/SDK execution,
   cancellation/cleanup, budget, stream admission, raster/model inspectors,
   morphology/seedfill and TSV source. Compare Safe Bash composition and packed
   declaration/runtime rewrite profiles with the archived package pattern.
2. Run `npm test --workspace=safe-bash-command-tesseract` and
   `npm run lint --workspace=safe-bash-command-tesseract`.
3. Run `npm run build:workspaces -- --workspace=@poe-platform/safe-bash`;
   after it finishes, run `node --import tsx --test` on
   `packages/safe-bash/tests/plugins/tesseract-wiring.test.ts` and
   `packages/safe-bash/tests/plugins/tesseract-boundaries.test.ts`.
4. Stage with `node scripts/package-safe.mjs --out-dir <task-output>/stage
   --version 0.0.0-ship-tesseract-review`. Pack staged public SafeFS/SafeJS/
   Safe Bash with `npm pack --ignore-scripts`. Install only these tarballs and
   cached Node typings in an OS temporary consumer outside the checkout with
   `--offline --ignore-scripts --workspaces=false --omit=optional`.
5. Assert private tesseract/contracts installations are absent. Import the public
   tesseract subpath and canonical contracts; assert runtime identity, opt-in
   registration, help/version/list-langs status, literal VFS refusal with unchanged
   outputbase bytes, URL denial, CLI/SDK parity, strict numeric admission,
   traineddata offsets, bounded stream buffer capacity, exact TSV header/page
   serialization and disposal accounting.
6. Repeat runtime checks with Node browser/workerd conditions. Compile a public
   API consumer using strict NodeNext/ES2023, Node types, exact optional properties
   and unchecked indexed access, with library checks enabled. Repeat declaration
   compilation with browser/workerd custom conditions. Cover command/SDK, parser,
   model/raster/stream, budgets, morphology, seedfill and TSV APIs.
7. Inspect actual installed export targets and AST-scan shipped JS/declarations
   for bare private command/contracts/CSV-engine imports, exports, import types,
   dynamic imports and require references.
8. Bundle a public-only Shell/tesseract admission consumer using esbuild's browser
   platform under browser/workerd conditions. Execute both in VM realms with
   explicitly supplied encoding, matching byte constructors, cancellation, URL,
   timer, queueMicrotask and performance capabilities, without process, Buffer or
   require. This checks conditional graphs and realm execution, not actual engines.
9. Inspect documentation and whitespace, retain this receipt and purge task-owned
   output and the temporary installed consumer.

## Results

- Private maintained unit route: 60 passed, zero failures/cancellations/skips.
- Private lint: ESLint and production/test TypeScript checks passed.
- Maintained selected Safe Bash build closure and npm postbuild passed using the
  shared machine cache. No fixed dependency/task membership was substituted.
- Focused CLI/SDK/VFS integration: five passed, zero failures/cancellations/skips.
- Fresh public-only offline installed runtime and strict declarations passed under
  normal, browser and workerd conditions. Private tesseract/contracts were absent.
- Canonical command runtime identity was preserved in the installed artifact.
- Installed subpath targets are
  `./dist/safe-bash/commands/tesseract/index.js` and
  `./dist/safe-bash/commands/tesseract/index.d.ts`. Both resolve without an
  unpublished package installation.
- AST scan of 1,312 installed Safe Bash JS/declaration files passed the private
  specifier check. Browser/workerd browser-platform bundles and VFS VM execution
  passed without process, Buffer or require.
- Manifest remains `safe-bash-command-tesseract`, `private: true`, TypeScript ESM,
  empty runtime dependencies, with a development-only canonical-contract edge.
  Safe Bash only composes/exports its API. No command package was packed/published.
- README now lists exact flags/symbolic modes, command/SDK examples, defaults,
  strict native deviations, resource caps, byte outputs/statuses, utility output
  ownership, cancellation/cleanup, runtime assumptions and engine limitations.
  Corrected Safe Bash's outdated claim that opt-in registration was unavailable.
- Documentation now accurately admits empty `-c` values (empty names fail), and
  explicitly distinguishes untouched outputbase files from destructive shell
  redirection, including VFS symlink aliases.

Local tarball SHA256 receipts (candidate artifacts, not Git/release identities):

| Public artifact | SHA256 |
| --- | --- |
| Safe Bash | `94b20a29be532a0cc9620a4c4358783c0f621082c114b0160484d8349c87b30b` |
| SafeFS | `931b208e865b50fe202f85ce65e247726839e8e2c543d81636dd3f214b27fe04` |
| SafeJS | `d9dc7d11c7f3e2678ad7640e89a409f0bf41bad71c194152546d22b8cf5a37f2` |

## Qualification and delivery boundaries

Packed delivery of the current command admission/utilities passed. OCR is still
unavailable: recognition deterministically returns 1 before input acquisition;
help/version return 0, and list-langs returns 0 with an unavailable-loader stderr
diagnostic. No approved recognition asset, model loader/inference, segmentation,
image codec or searchable-PDF engine was added or qualified. Pinned native
source/model/bitmap controls supplied with the task are upstream research, not
new runtime measurements or authorization to adopt assets. No native executable
was invoked. Traineddata inspection is not digest/provenance or recognition
approval; raster primitives and supplied-layout TSV are not OCR.

Actual browser/workerd engines, broad OCR accuracy, native renderer equivalence,
and original/checkpoint/replay qualification were not exercised or counted as
passed. Byte/raster APIs currently use same-realm Uint8Array admission. This leaf
package's empty dependencies does not establish zero external dependencies for
all Safe Bash integrations. Existing engine-fidelity gates remain open.

No shared implementation changed; full repository test/lint routes were not
required or executed for this documentation task. No visible CLI behavior or
document rendering changed, so adhoc CLI/document screenshots were inapplicable.
Tarballs include the updated Safe Bash support paragraph; private README final
compaction happened after packing and does not change runtime/declarations.
Task-file whitespace checks passed.

Absolute `/out` could not be created (read-only filesystem). Ignored workspace
`out/ship-tesseract` and an external OS temporary consumer held generated
evidence; both were purged after capture. Local commits: none. Verified
remote-main delivery: none. Successful releases: none. No push or public/private
publication was performed. Local verification is not a release.

## Follow-up task-diff review

Re-reviewed the current candidate on 2026-09-20 for unnecessary abstractions,
proxy-only functions, duplicated logic, host access, failure paths, cancellation,
resource budgets, ownership and compatibility. No validated runtime defect or
unsupported simplification was identified. The SDK entry point snapshots options;
command construction freezes invocation configuration; the shared executor keeps
CLI/SDK admission together. The small per-result disposal closures track distinct
reservations and remain local. No implementation change was justified by the
current tests. Snapshot/checkpoint/replay support remains unqualified; this review
changes no serialized state, runtime identity, command defaults or version output.
Existing recognition/codec/model/PDF gates are capability boundaries, not newly
closed gates.

One documentation defect was validated: the Safe Bash README linked to the
private command README with a sibling filesystem path, but the installed artifact
has no private sibling package. Changed this link to the repository URL, following
existing command support links. Preserved the compact private package README and
all unrelated edits.

Follow-up Markdown QA:

1. Re-read every command implementation, current tests, canonical contracts and
   Safe Bash export/composition. Search production command sources for host,
   process, fetch, native/WASM and dynamic-runtime access.
2. Re-run maintained command unit/lint and selected Safe Bash build closure;
   re-run both tesseract Shell integration files.
3. Stage and pack only the three public Safe libraries. Install public tarballs
   offline into an isolated temporary consumer outside the checkout, without
   scripts/workspaces/optional dependencies. Assert private tesseract/contracts
   packages are absent.
4. Exercise public subpath imports, canonical runtime identity, opt-in Shell
   registration, CLI/SDK refusal parity, unchanged VFS outputbase, URL denial,
   strict DPI, traineddata offsets, bounded stream capacity, TSV output/disposal.
   Repeat under Node normal/browser/workerd conditions and compile strict
   NodeNext declarations under each condition with library checks enabled.
5. Bundle a public Shell/tesseract consumer on esbuild's browser platform under
   browser and workerd conditions. These are graph checks, not actual engine
   qualification.
6. Check task documentation whitespace and remove only task-owned generated
   evidence. No CLI/document rendering changed; screenshot checks do not apply
   to the corrected link target.

Fresh follow-up results: all 60 private tests and five focused integration tests
passed; private ESLint and production/test TypeScript checks passed; maintained
Safe Bash build closure and postbuild passed. Offline installed runtime and strict
public declarations passed under normal/browser/workerd conditions, with canonical
identity preserved and no private package installed. Both browser-platform bundle
profiles passed. Export targets remain `./dist/safe-bash/commands/tesseract/index.js`
and `./dist/safe-bash/commands/tesseract/index.d.ts`. The first temporary SDK QA
harness supplied functions instead of byte sinks; correcting that harness to the
published `write` capability made the check pass without production changes.

No unresolved task-diff finding remains. OCR and actual browser/workerd engine
qualification remain unavailable as documented. Full repository checks were not
required for the documentation-only correction. `/out` remains read-only; ignored
workspace output and the external consumer were removed after verification. Local
commits: none. Verified remote-main delivery: none. Successful releases: none.
No private package was packed or published, and no push/publication was performed.

## Current request verification

Fresh verification on 2026-09-20 used working-tree candidate based on
`ab1fa8d34101e1e7f61272973f3bc28a842043d8`; the extensive existing unrelated
edits were preserved. Re-executed the Markdown QA above for command ownership,
source inspection, maintained package tests/lint, selected Safe Bash build,
focused integration and public-only installed runtime/declaration checks.
No code defect was validated; no production code or build configuration changed.
The existing package README now explicitly documents strict DPI's deliberate
native `atoi` deviation. The existing Safe Bash support paragraph now includes
its exported binary morphology/seedfill and raster inspection utilities.

Fresh passes:

- Maintained private workspace unit route: 60 passed, no failures, skips or
  cancellations. Includes independent edge/negative controls, seeded UTF-8
  comparisons, foreign-realm rejection, resource rollback and cancellation.
- Private workspace lint, production/test typechecks: passed.
- `npm run build:workspaces -- --workspace=@poe-platform/safe-bash`: passed,
  including maintained dependency closure and postbuild, shared cache enabled.
- Both tesseract Shell integration files: five passed, no failures, skips or
  cancellations. Covers scripts/pipes, CLI/SDK parity, negative host/network
  authority and shell-redirection alias behavior.
- Packed only public SafeFS/SafeJS/Safe Bash, installed offline outside the
  checkout with scripts/workspaces/optional dependencies disabled. Private
  tesseract/contracts installations were absent.
- Installed public subpath and canonical runtime identity, opt-in dispatch,
  help/version/list-langs, CLI/SDK refusal parity, unchanged outputbase, URL
  denial, strict DPI negative cases, first-equals assignment, option-like
  outputbase, input overflow/iterator cleanup and fail-closed budgets passed.
- Repeat installed runtime and strict NodeNext declarations with library checks,
  exact optional properties and unchecked indexed access: normal, browser and
  workerd conditions all passed. Declaration consumer references command/SDK,
  parsing, traineddata, streams, raster, morphology, seedfill, TSV and budget APIs.
- Production command source search found no host imports/process/fetch/WASM or
  dynamic-import access. Task documentation whitespace passed.

Safe Bash candidate tarball SHA256:
`754bde881d6b96374bdb12422e70b63913b1d2fce3c3d5a3f06d787d113582d8`.
This hash identifies the freshly installed runtime/declarations and updated Safe
Bash support paragraph. Private README-only DPI clarification followed packing;
it changes neither runtime nor declarations and is not included in that artifact.

Failures: none in maintained or installed verification. Environment limitation:
absolute `/out` creation failed because the filesystem is read-only; used ignored
workspace `out/ship-tesseract-current` and an isolated OS temporary consumer,
then removed task-owned generated evidence.

Not run or qualified: full repository routes (no shared implementation changes),
actual browser/workerd engines, original/checkpoint/replay, OCR/segmentation/model
inference/codecs/searchable PDF and language-wide accuracy. Node custom conditions
are resolution checks, not engine qualification. CLI/document rendering is
unchanged; screenshots are inapplicable to these prose-only edits. No native
oracle/model was invoked or adopted. Unsupported recognition still returns 1;
its fidelity gates remain open.

Local commits: none. Verified remote-main delivery: none. Successful releases:
none. No push or publication performed; the private command was not packed or
published. This receipt establishes local candidate verification only.
