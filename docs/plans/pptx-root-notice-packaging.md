# PPTX root package notice retention

## Ownership and scope

Own only the root `package.json` files declaration and this plan. Preserve all
other working-tree changes. Work on main; commit locally after focused checks;
do not push, release, execute the whole pipeline, or edit README files.
The safe-bash verification worker owns read-only public consumer checks.

## Validated finding

The standalone `pptx` manifest includes `THIRD_PARTY_NOTICES.txt`, but the root
manifest ships its runtime and LICENSE without that required standalone notice.
`npm pack --dry-run --ignore-scripts --json` confirmed that the root packed file
list contains `packages/pptx/LICENSE` and omits the third-party notice.
The correction adds the existing notice to the root files allowlist. No runtime
code, API, source attribution, dependency, or export route changes are needed.
Configuration changes do not require a new unit test under root instructions;
the independent npm packed-file inventory is the concrete before/after check.

## Contract and provenance accounting

Read the PPTX, shared Office CLI/SDK contracts, upstream test/API audits and
inventories, language/security mappings, and disposable corpus manifest.
This distribution-only fix adapts no behavioral case or model member. All 2,700
unit variants, 973 expanded BDD cases, and public API obligations remain governed
by their existing research ledgers; none are newly claimed as implemented here.
The existing standalone legal notice is retained verbatim. No fixture is needed,
no corpus download runs, and no research identity enters product code or tests.

## Agent QA procedure

1. Build the selected `pptx` workspace closure via the maintained build route.
2. Run focused maintained packaging/bundle tests and package declaration lint.
3. Pack standalone and root packages to a disposable temporary directory; inspect
   actual tar members and compare the retained notice bytes with the source.
4. Exercise SDK creation and command discovery through public package imports;
   verify opt-in safe-bash registration and capability results. Distinguish
   built/live imports from isolated packed consumers and deployment runtimes.
5. Review exact diff, stage only owned files, and commit the atomic correction.

## Results

- Selected maintained build: `npm run build:workspaces -- --workspace=pptx`
  passed, deriving the three-workspace closure from declarations.
- Focused packaging checks: `npx vitest run scripts/package-safe.test.ts
scripts/bundle.test.ts scripts/package-safe-native.test.ts` passed 141 tests.
- All four directly relevant package-lint rules passed: packaged runtime assets,
  license, export resolution, and shipped dependency resolution. The full
  `npm run lint:packages` run passed its other rules but failed the README rule
  for `pptx` and `@poe-code/office-package`. No README was added because the
  user explicitly prohibited README edits; this remains an unresolved gate.
- Prettier passed for both owned files.
- Actual root and standalone archives in `/tmp/pptx-notice-pack.GpC7go` include
  the notice; extracting it yielded the exact original 1,104 bytes in both cases.
  The root pre-change npm pack inventory omitted it. No corpus path was packed.
- Isolated standalone consumer extracted both local package tarballs and copied
  installed declared external dependencies (saxes 6.0.0, xmlchars 2.2.0, pako
  3.0.1, and @noble/hashes 2.4.0), without workspace symlinks. Offline npm install
  could not resolve saxes from the local npm cache; no download was attempted.
  Public `Presentation`/`Inches` imports round-tripped an original title and
  12-inch width under Node 22.23.2 default, browser and workerd conditions.
  These are Node conditional-export checks, not deployed browser/Worker runs.
- esbuild's browser-platform bundle of the isolated packed SDK public exports
  resolved 184 modules and left zero external imports, verifying the portable
  runtime closure without a Node builtin or implicit private workspace import.
- Read-only worker passed 45 selector tests. Isolated packed root/public SDK and
  opt-in shell checks passed under Node default and workerd conditions. The
  browser root shell import failed: `safe-bash/src/core.ts` exports the SafeJS
  command; that command imports its integration barrel, which reexports
  `createNodeFsBridge` through `poe-code/safe-fs`, whose browser export does not
  provide that symbol. The worker confirmed the same chain in current source.
  The standalone packed SDK and PPTX adapter alone import under browser conditions.
  This unrelated SafeJS integration defect is outside the owned PPTX and root
  declaration correction; root browser shell compatibility remains unverified.
- Tarballs reflect the live workspace, including pre-existing PPTX edits. These
  receipts do not certify an immutable committed candidate or whole API parity.
  No source code was changed, so no visual CLI screenshot or behavioral
  adaptation test was required for this packaging-only correction.
- Strict isolated packed declarations passed for standalone/root SDK, public
  adapter factories, and Shell/MemoryFileSystem using NodeNext with
  `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, and `skipLibCheck:false`,
  both default and browser custom conditions. Worker evidence lives in
  `/tmp/pptx-consumer-3hnQCO`. Browser esbuild bundles also passed separately for
  root PPTX and the adapter; these do not erase the root shell import failure.
