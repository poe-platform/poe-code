# Packaged docx SDK and virtual-shell verification

Task: `public-consumer-and-shell-qa` in
[the ordered pipeline](docx-typescript-safe-bash.md). Execution date: 2026-09-15.
Only this task is authorized; subsequent inventory, visual, release-readiness,
documentation and fixture-retirement tasks remain pending. No push or release.

## Owned changes

- `packages/docx/tests/public-shell.cases.ts`: original public-import acceptance
  cases; every file mutation uses memfs.
- `packages/docx/tests/public-shell.test.ts`: maintained package-unit entry that
  strips TypeScript without bundling imports, then runs plain Node with no loader,
  aliases, source-path imports or temporary unit-test files.
- `packages/docx/tests/tsconfig.public-consumer.json`: strict NodeNext public
  declaration closure, no paths aliases and no library-check exclusion.
- This plan. Existing dirty source, evidence and pipeline edits are not owned.

Independent read-only review by `review_public_qa` identified the missing public
consumer/relocation evidence and missing docx pipefail/stage-status assertions.
Any subsequently validated closure correction receives separate owned paths,
failing regression evidence and an atomic commit.

## Acceptance and QA procedure

1. Read root/scoped instructions, `docs/specs/docx.md`, the shared Office CLI/SDK
   specifications and the complete pinned API audit/inventory. Preserve their
   historical status/provenance and all public/inherited/underscore obligations.
2. Add original tests before product corrections. Run the public consumer entry
   against emitted public exports; do not use Vitest's workspace source aliases.
   Record test-harness corrections separately from validated product defects.
3. Run the maintained selected build closures for `docx` and `virtual-bash`.
   Where final emitted browser/root packages are needed, run normal `npm run build`
   including its suffix stages. Never replace them with hand-written builds.
4. Run `npm test --workspace=docx`, `npm run lint --workspace=docx`, strict public
   consumer compilation, `npm test --workspace=virtual-bash` and maintained
   `typecheck:all`. For a validated build-harness edit, also run its maintained
   runner regression route. Do not alter literal inventories or guarded receipts.
5. Inspect `npm pack --dry-run --json --ignore-scripts` inventories and create
   disposable local tarballs outside the checkout. Relocate package payloads and
   required runtime/type dependencies without installing from the network.
   Run the original public consumer against that relocated closure with plain
   Node and compile its declarations without source aliases or skipped libraries.
   Assert no QA downloads, original tests, oracle packages or fixtures are shipped.
6. Exercise actual browser exports with a complete dependency bundle and browser
   runtime when available. Test SDK plus actual shell/plugin dispatch together;
   Node conditional resolution alone is insufficient. Record unavailable workerd
   runtime honestly. Do not externalize missing modules to manufacture a pass.
7. Preserve meaningful small original regressions and required legal notices;
   remove only newly owned disposable QA outputs. Commit explicit owned files
   after relevant checks pass; report local hashes separately from delivery.

## Exact JavaScript/security mapping and drift

| Surface | Mapping and evidence boundary |
| --- | --- |
| SDK admission/publication | Always-async factories/operations take explicit owned bytes, limits, signals and byte sinks. No ambient files, timestamps, identities, networking or native reference code. |
| Model versus operations | Neutral model snake_case names and inherited/enum/collection/helper obligations remain unchanged. Operation camelCase fields map to kebab-case CLI flags. This task verifies selected implemented utilities; it does not implement pending live owners. |
| Shared names | `images`, `tables`, `properties`, `text.replace`, schema and capabilities retain the shared contract. Singular/metadata/top-level replace aliases fail. `--` admits a leading-hyphen filename. |
| JSON | Version 1 original creation/batch content is closed-schema JSON. Explicit `--content-file -`/`--ops-file -` reserve stdin; malformed/unknown fields fail before mutation. |
| Bytes | SDK stdout and shell pipelines/redirection retain exact ZIP bytes. Output is compared independently and reparsed/validated. The memfs host explicitly supplies the `provided` device-view profile; no host fallback is used. |
| Shell lifecycle | Real plugin setup settles during execution; collisions reject that settlement and preserve the shared registry. `PIPESTATUS` is read immediately in the same execution, before another command replaces it; shell executions do not share variable state. |
| Failure | Ordinary document, usage, source and limit failures have statuses 1/2/3/4 and stable codes. `pipefail` reports the failing stage while ordinary pipelines report the last stage. Root caller cancellation preserves the borrowed reason as rejection; a shell cancellation does not promise rollback of completed effects. |
| Documentation drift | Preserve existing `comment_id`/`timestamp`, `table_direction`, nullable setter, keyed/sequence, owner equality and per-axis DPI resolutions. No new aliases or exclusions based on underscore-prefixed names. |

The pinned inventory contains 920 objects: 410 planned, 378 security-mapped,
124 language-mapped and 8 documentation-error rows. Those are historical research
dispositions, not execution coverage. This task changes no inventory disposition
and makes no whole-model, full-API, format or layout-conformance claim.

## Execution evidence

The initial public tests failed on test-host errno translation, asynchronous
plugin setup, per-execution shell state and an assumed trailing text newline.
Correcting these original harness expectations produced passing public consumer
cases without a product-source correction. Maintained workspace build closures
passed. The later validated alternate-build defect and failing-before-code
correction are recorded in [the owned closure finding](docx-typecheck-build-closure.md).

| Gate | Actual result |
| --- | --- |
| Selected maintained builds | Both `--workspace=docx` and `--workspace=virtual-bash` passed their derived dependency closures. |
| Normal maintained build | `npm run build` passed all declared workspace builds and root suffix stages, ending with `Bundle complete: dist/index.js + dist/bin.cjs`. One workspace has no declared build; that is explicitly not a pass. Final root bundling was repeated after typecheck emission settled. |
| Docx maintained unit route | `npm test --workspace=docx`: 171 files, 3,375 tests passed. The wrapper runs eight original plain-Node cases; latest focused wrapper rerun passed after the final test-host edits. |
| Docx maintained lint | `npm run lint --workspace=docx` passed ESLint and both maintained compiler phases; one existing warning, zero errors. |
| Repository maintained ESLint | `npm run lint:eslint` exited 0 with complete authenticated receipts: 15,411 configured subjects linted, zero errors and 13 warnings. No exclusions or guard changes. |
| Public declarations | Independent strict `tsconfig.public-consumer.json` compiled 570 files with library checking enabled. Its only nondeclaration source is the original consumer. |
| Safe-bash maintained runner | Original strengthened assertion failed before code (521/522); corrected runner and final original-name rerun passed 522/522, with no skipped/cancelled cases. |
| Safe-bash maintained types | Corrected `typecheck:all` passed source/tests, historical phases, three source consumer groups and 26 relocated current groups. Expected negative cases exit 2; zero runtime executions claimed by this compile-only gate. |
| Safe-bash maintained units | Final emission-stable `npm test --workspace=virtual-bash` exited 0: 39,130 tests, 38,307 passed, 823 skipped, zero failures/cancellations. Skipped cases are not passes. |

Evidence logs are invocation-local `/tmp/docx-unit-final-20260915.txt`,
`docx-public-final-20260915.txt`, `docx-lint-complete-20260915.txt`,
`docx-eslint-maintained-20260915.txt`, `docx-public-types-final-20260915.txt`,
`docx-typecheck-builder-final-20260915.txt`, `docx-shell-types-green-20260915.txt`
and `docx-final-build-20260915.txt`. The small original cases and this record
survive disposal of QA files; the logs are not shipped dependencies.

### Relocated package closure

The local root tarball contains 6,965 files, 82,301,710 compressed bytes and
445,881,964 unpacked bytes. SHA-256:
`2b4e44e65aecda00b179c7c82e33ffc124b2ad19e6b69e83bf964f86fa23312f`.
Inventories include all needed emitted docx code/declarations and legal notices,
and contain no `output/`, tests, fixtures or benchmark directories. The final
browser input membership/hash check matched all 35 product inputs in the tarball.

Eight original cases passed against the extracted root package with plain Node
22.23.2, without a TypeScript loader, repository symlinks, source imports or network
installation. The original test imports were mechanically translated to the
published root public subpaths (`poe-code/docx`, `poe-code/safe-bash` and its docx
adapter), retaining their names, assertions and original data. This verifies the
root publication shape; private workspace bare imports are separately tested in
the canonical wrapper, not advertised as standalone published packages.

Four declared installed runtime dependencies were supplied without source
symlinks: `@kayahr/text-encoding@2.2.0`, `@noble/hashes@2.4.0`, `pako@3.0.1` and
`yaml@2.9.0`. None has further runtime dependencies. The initial empty dependency
fixture correctly refused the missing declared encoding library; provisioning
the declared closure produced the eight passing cases. Test-only memfs was
bundled into the disposable driver, outside the tarball.

The relocated ESM declaration consumer passed with no paths aliases and
`skipLibCheck: false`, resolving 568 compiler/declaration files. Its sole
nondeclaration source is the original consumer; no repository product source
was used. Twenty-nine installed test-only declaration dependencies retained their
actual nested versions. The test host has its own explicit ESM package metadata.
Evidence: `/tmp/docx-packed-node-green-20260915.txt` and
`/tmp/docx-packed-types-green-20260915.txt`.

### Actual browser runtime and unavailable conditions

A full bundle from final emitted public browser exports contained 9,351,304 bytes,
35 product input files plus the entry, and zero external imports. SHA-256:
`1cce66a76ed0f69191c3268359f8aa0172127ab1bf49a43dd238509e7a2aaec3`.
All product inputs matched the packed package byte-for-byte.

Chromium 153.0.0.0 ran that closure in a secure loopback origin, with the actual
default-device `MemoryFileSystem`, SDK, Shell, aggregate plugin and explicit docx
plugin. JSON stdin creation and binary pipes produced a valid 2,142-byte original
package. Quoted stored `sh` edits/redirection and SDK text results agreed for
`Harbor 🌊 café 日本語`. Ordinary/pipefail statuses were 0/2, stage statuses were
`[2, 0]`, and root caller cancellation retained its borrowed reason. The actual
browser result screenshot was captured and inspected. No native/network product
fallback, ambient files or document renderer was involved.

The preliminary workspace-only browser closure failed on Node networking imports
because that stage emits unbundled browser entrypoints. The normal maintained
root suffix resolved those entries; no modules were externalized to hide failure.
No workerd executable is installed, so workerd runtime support remains unverified;
Node conditional imports are not substituted for a workerd pass. Document page
rendering and whole-model/API conformance belong to the still-pending later tasks.

### Isolation and disposal

The first broad shell-unit run overlapped normal root output replacement and was
stopped after transient missing-module errors. That run is invalidated rather
than called a pass or repaired by source changes. Final shell units run only after
all emissions settle. Existing source/evidence edits, held inputs and disposable
downloads from other work remain untouched.

No QA documents were downloaded or borrowed. Disposable local tarballs, extracted
packages, test/type host dependencies, browser bundle and loopback server are
owned by this invocation and removed/stopped after final verification. The final
consumer revision also checks SDK/CLI diff statuses 0/1/2 and independently
preserves bold text formatting. Both canonical and packed consumer reruns cover
these assertions. Rebundling the test-only memfs host requires an ESM
`createRequire` bridge; this changes no packed product input.
