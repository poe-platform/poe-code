# Workbook ownership follow-up verification

Executed September 19, 2026 against the existing bounded workbook implementation.
Existing edits and verification records were preserved. This task added ownership
repairs and independent cases, rather than replacing the pre-existing model.
No README edits, commits, pushes or publication occurred.

## Candidate and reference

Git base: `b97c4938a469ee70e09bd08a0e5fcf7e868ca04c`, with existing uncommitted
edits. The verified candidate is bound by a 24-file manifest SHA-256:
`60fc05c87068bc52361a5ab40fe777343cc7b62e0ce0379c387369f9716b3e5a`.
Manifest membership is every `.ts` file recursively in `packages/ssconvert/src`,
the package's `package.json`, `tsconfig.json`, `tsconfig.test.json`, and
`packages/safe-bash/src/commands/ssconvert/index.ts` plus
`packages/safe-bash/tests/commands/ssconvert.test.ts`. Sort relative POSIX paths
lexically; encode each line as lowercase file SHA-256, two spaces, path, newline;
hash the UTF-8 concatenation. This binds the dirty candidate, not a local commit.

| Changed implementation | SHA-256 |
| --- | --- |
| `packages/ssconvert/src/workbook/model.ts` | `a25875d16e76d66b9c4d10fe2dfd277ab0379ee9743a1c5980385fc229383381` |
| `packages/ssconvert/src/engine.ts` | `1f01670c64336916ff4b99ad3130876a14c878789993d9d24195f0b318d87a81` |

The official archive was downloaded and extracted only under the task-owned
`out/ssconvert-workbook-followup` directory. Fresh SHA-256:
`2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12`.
The preserved [reference profile](reference-profile.json) hashes to
`111b2a50a5df70f73734f536660a74317a193ff8c026823156918fcfc6402fdc`.
Fresh source review confirmed dimension defaults/minima/maxima and powers of two
(`src/gnumeric.h`, `src/sheet.c:1208`), blank-inclusive stored-cell extent
(`src/sheet.c:2462`), Unicode sheet folding (`src/sheet.c:315`), and exact-spelling
name hashing/equality with sheet-first lookup (`src/expr-name.c:176–187,551–553`).
No native utilities were spawned by product code or unit tests. No native oracle
was invoked during this follow-up, and no profile qualification was upgraded.

## Reproduced failures and repairs

- Before repair, three of four original own-property cases failed: hidden
  accessors and custom array fields were silently discarded; hidden data fields
  were lost. Snapshots now inspect all own string properties, retain data fields,
  exempt ordinary array length and reject accessors/custom array fields. Property
  keys and values remain charged against metadata budgets.
- A different agent reproduced inherited optional limit getters executing 21
  times across model entry points. Validation now captures own numeric limits;
  subsequent budget use cannot invoke those inherited getters.
- The independent agent reproduced admission of rich-text runs lacking required
  attributes. Each run now requires an attributes record.
- The independent SDK regression reproduced reads and writes redirected to
  foreign resource names and changed exporter options after API invocation. Root
  reproduced the failure and repaired the engine: read input/options and write
  destination/options are captured before deferred host work. Disposed/pre-abort
  checks precede capture, and exporter-option count is admitted before copying.

The independent reviewer reran all six original boundary cases on the final
candidate. Root retained engine, export, integration, documentation and Git
ownership. Fixtures are original and in-memory; file-effect tests use memfs.
No generated cases were used, so there are no random seeds to preserve.

## Completed checks

| Check | Result |
| --- | --- |
| `npm run test --workspace=@poe-code/ssconvert -- --no-cache` | 80 passed in six files; zero skipped |
| `npm run lint --workspace=@poe-code/ssconvert` | ESLint and production/test TypeScript passed after final engine repair |
| `npm run build:workspaces -- --workspace=@poe-platform/safe-bash --no-cache` | Final selected dependency closure passed, 18 builds including postbuild |
| Selected ssconvert workspace uncached build | Passed; final integration closure rebuilt it after subsequent engine repair |
| `node --import tsx --test packages/safe-bash/tests/commands/ssconvert.test.ts` | Final rebuilt SDK: seven passed, zero skipped; byte/status/channel and destination namespace controls |
| `node --test packages/safe-bash/scripts/integration-inputs.test.mjs` | 120 passed, zero skipped |
| Focused integration ESLint | Passed |
| Focused strict NodeNext integration compilation | Passed with ES2023/DOM libraries, unchecked-index/exact-optional/verbatim-module checks |
| Built public SDK manual controls | Foreign-realm bytes 0/255 preserved; cross-engine workbook write denied before sink calls; foreign plain-object prototype denied; null pre-abort reason preserved with zero option-getter calls |
| Manual CLI screenshot | Captured and inspected: readable accessor diagnostic, status 1, destination `keep`; final rebuilt host entry point rerun matched |
| `git diff --check` | Passed |

The package tests exercise sparse maximal capacity, populated-cell extents,
missing/blank/empty cells, serial dates, cache presence, rich text, formula groups,
names, Unicode, detached sheets, metadata transfer and malformed records. The
added cases independently exercise A1 boundaries and adjacent invalid addresses,
exact UTF-8 budgets, detached update rollback/storage accounting and authority
negative controls. Existing cooperative cleanup/cancellation cases remain active.
These are deterministic semantic checks; test durations are not performance
measurements. Screenshot SHA-256 before scratch cleanup:
`dfc9ee52461623e169128928d421bd74cd1be5fd739d6f4e708c8c2cfde3d175`.

## Failures, unavailable cells and limits

- The maintained safe-bash typecheck exited 2 before source checking:
  `Public SafeFS must preserve shared SafeJS runtime identity`, actual `undefined`,
  expected `./packages/safe-js/dist/safe-fs.js`. This reproduces the existing
  prerequisite failure. Unrelated exports were not changed or bypassed. Focused
  compilation/build/runtime success does not complete this gate.
- An initial ad hoc compiler command selected ES2022's default libraries; it
  failed on existing shell `findLast` usage. Inspection confirmed the maintained
  workspace targets ES2023. Corrected ES2023 compilation, including the relevant
  strict flags, passed. The failed attempt remains a failed attempt.
- Repository-wide `npm test`, lint and build were not run in this follow-up:
  changes are limited to one engine/model workspace and its selected integration
  test, with no shared infrastructure/export changes. No broad gate is claimed.
- Native real-format round trips, diagnostics/status parity for malformed native
  formats and required reference runtime/plugin variants remain unverified here.
  The profile's unmeasured/blocked cells, including Psiconv compilation and
  unmeasured importers, remain so. A JSON fixture round trip is model coverage.
- Permanent/placeholder-name import recovery, overlapping array import behavior,
  shared-formula rebasing, formula parsing/dependency inference/recalculation,
  format-specific unknown-record transfer, native rendering/view reconstruction
  and date conversion remain importer/capability work or unmeasured. Explicit
  imported-record disposition is preserved; opaque native passthrough is not
  established. See the preserved [bounded model report](bounded-workbook-verification.md).
- Original SDK/virtual execution was verified. Checkpoint/replay execution is
  unavailable in this package and was not measured; immutable snapshots and JSON
  fixtures do not establish replay guarantees. Foreign plain objects require
  canonicalization by the trusted capability; foreign byte input interoperability
  does not establish host isolation. Host Proxies are not a sandboxed input realm.
- Metadata-cap calibration, large-workbook performance and whole-host allocation
  bounds remain unmeasured. Own-property enumeration creates a key list before
  checking its length; this does not promise a hard host heap bound. Explicit
  safety caps/depth may differ from native unlimited metadata admission.

The executed [Markdown QA procedure](../plans/ssconvert-workbook-ownership-qa.md)
records the manual steps. Owned source, capture harness and screenshot scratch
were removed after reducing observations; unrelated out content was preserved.
