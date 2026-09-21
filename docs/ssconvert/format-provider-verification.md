# Format provider registry verification

Executed September 19, 2026. This implements the requested registry layer in
TypeScript ESM, with the shared SDK/command engine and existing opt-in Safe Bash
adapter. It does not implement spreadsheet codecs or qualify full ssconvert
parity. Existing edits and reference captures were preserved. No README changes,
commits, pushes, publication, native product dependencies or fallbacks occurred.

The [coverage register](format-provider-coverage.json) accounts for all 48
directional source services across 21 provider files. All 48 built-in services
remain unimplemented and unavailable; default installed listings are empty.
Explicit original injected fixture implementations used during validation are
not product codec availability or real-format passes. The existing broader
[coverage register](coverage.json) and [reference profile](reference-profile.json)
remain unchanged, including their blocked/unmeasured cells.

## Reference and source evidence

The official archive was downloaded and extracted only under the owned
`out/ssconvert-format-registry` directory. Fresh SHA-256 values:

| Archive | SHA-256 |
| --- | --- |
| Gnumeric 1.12.61 | `2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12` |
| GOffice 0.10.61 | `558597fd9ca59b93ff562750218d1e7ea8ec3c8d0ed6a5cc096aa715ef909a15` |
| libgsf 1.14.53 | `0eb59a86e0c50f97ac9cfe4d8cc1969f623f2ae8c5296f2414571ff0a9e8bcba` |

The retained dependency/plugin/locale profile SHA-256 is
`111b2a50a5df70f73734f536660a74317a193ff8c026823156918fcfc6402fdc`.
Its primary reference is C/UTC with the captured GOffice/GLib/GTK/libgsf stack;
optional Psiconv qualification remains blocked. No native executable was run in
this task. The default Docker socket was unavailable; explicit `colima` inventory
contained no retained reference container or reference-built image. Retained
captures are historical observations, not fresh differential executions.

Source review independently confirmed:

- Gnumeric `src/workbook-view.c:1410–1440`: priority-ordered name pass, content
  validation when available, then priority-ordered content pass. Probes may repeat.
- GOffice `goffice/app/file.c:1032–1055,1111–1155,1260–1291`: stable opener priority
  ties, reverse saver registration, registered-default priority, then preferred
  workbook/sheet/range scope. Explicit supplied codec order represents registration.
- GOffice `goffice/app/go-plugin-service.c:455–470,610–667,796–845`: manifest defaults,
  priority clamping, case-insensitive opener extensions and optional content probes.
- libgsf `gsf/gsf-utils.c:533–550`: extension comes from the basename's last dot,
  with original case retained. Saver comparison is case-sensitive.
- Gnumeric `src/xml-sax-read.c:3901–3941`: XML additionally name-probes `.xml.gz`.
  Gnumeric `src/stf.c:606–634`, `src/stf-export.c:774–787`,
  `src/xml-sax-write.c:1746–1769`, `src/print-info.c:1074–1085`: eight core services,
  distinct interactive STF importer/noninteractive exporter, policies and handlers.
- Gnumeric `src/ssconvert.c:392–435,1314–1365`: ID-sorted noninteractive listings on
  stderr, byte-based widths, exporter-first selection failures, unknown-ID status 1
  and unguessable destination-exporter status 2.

All 40 manifest services were independently reconciled against freshly extracted
XML for directional IDs, normalized descriptions, extensions/MIME, priorities,
format levels, overwrite/default/scope/selection/encoding/probe policies. The eight
core registrations were reviewed separately. Excel's source template has a leading
description space that the retained installed listing omits; the provider uses the
measured installed description. Source Unicode descriptions remain Unicode in SDK
metadata. Default CLI listings reproduce the captured C channel's ASCII conversion;
an explicit `CommandProfile.listingEncoding: "utf8"` preserves UTF-8 display.

Both full retained native listing captures matched exact status, channels and bytes
when their 19 importer and 26 exporter IDs were explicitly installed with original
listing-only fixtures. Expected IDs/bytes came from captures independently of the
registry. No fixture read/write function ran in those listing comparisons.

## Implementation and reproduced failures

One declarative file per provider supplies a provider ID/source and local service
IDs. Metadata defaults and stable full IDs are derived centrally. Maintained
build/test/lint commands regenerate the static import catalog, so adding a provider
file needs no hand-edited provider switch or catalog entry. Product code performs
no host discovery. Implementations declared in a provider file are installed
automatically; source-only declarations are retained solely for coverage. Injected
host codecs are directional and snapshot their metadata.

Before implementation, both original regressions failed: importer selection relied
only on `.xlsx`, and separate opener/saver entries sharing `Gnumeric_Excel:xlsx`
were rejected. Discovery now requires implemented probes; forced IDs bypass them.
Native source services explicitly lacking content probes retain their native name
probe behavior (for example DIF). Generic injected extensions do not implicitly
implement name probes. A source importer declaring content probing cannot be
auto-selected without an installed content callback.

Independent handwritten competing-saver expectations cover `.xls`, `.xlsx`,
`.ods`, `.html`, `.tex`, `.xml`, upper-case suffix denial and dotted parent paths.
They do not derive expected outcomes from the registry. Further failing-before-
repair cases cover compound `.xml.gz` precedence, automatic installed-provider
discovery, listing routing/widths, native selection diagnostics/status precedence,
captured C display bytes, direct-discovery input admission and caller-byte ownership.

The different stress agent independently reproduced an empty registry swallowing
pre-aborted cancellation, then fixed it with an entry cancellation check. Its final
11 cases pass, covering repeated/tied/competing probes, asynchronous reason identity,
foreign-realm/mutated bytes, metadata ownership, directional coverage, compound
suffixes and STF interaction flags. Root retains engine/exports/integration/Git
ownership. All fixtures are original and in memory; file-effect tests use memfs.

Discovery captures caller bytes before awaiting, gives each content probe its own
copy, checks cancellation around callbacks and admits bytes before allocation.
The engine retains injected byte I/O, operation cleanup, limits and workbook realm
ownership. Exporter option handlers receive owned frozen option arrays; returned
options are admitted/copied before write. Save scope, overwrite, encoding and sheet
selection are exposed native metadata, not fabricated codec implementations.

## Checks and candidate identity

| Check | Result |
| --- | --- |
| `npm run test --workspace=@poe-code/ssconvert -- --no-cache` | 116 passed in 11 files; zero skipped |
| `npm run lint --workspace=@poe-code/ssconvert` | ESLint and production/test TypeScript passed |
| `npm run build:workspaces -- --workspace=@poe-platform/safe-bash --no-cache` | Selected maintained closure passed, 18 builds including postbuild |
| Final `npm run build:workspaces -- --workspace=@poe-code/ssconvert --no-cache` | Passed after final source/serializer changes |
| `node --import tsx --test packages/safe-bash/tests/commands/ssconvert.test.ts` | Eight passed; actual virtual discovery/defaults/forced IDs/listings/status/namespace controls |
| `node --test packages/safe-bash/scripts/integration-inputs.test.mjs` | 120 passed; zero skipped |
| Focused generator/integration ESLint and strict ES2023 NodeNext compilation | Passed |
| Retained native C/UTC complete listings with explicitly injected fixtures | Two exact status/channel/byte matches, 45 descriptions; not codec qualification |
| Built public-engine/adapter terminal screenshot | Captured and inspected: aligned columns, readable messages, status 2 and correct competing saver |
| `git diff --check` | Passed |

The 54-file candidate manifest SHA-256 is
`0ca1d1b93e9581dbd6de067bfb300875c29d5433b326e1cfd3038324d8687db2`.
Membership is all recursive `.ts` files in `packages/ssconvert/src`, its package
manifest/two tsconfigs/provider generator, and the Safe Bash ssconvert adapter/test.
Sort relative POSIX paths lexically; each line is lowercase file SHA-256, two spaces,
path and newline; hash the UTF-8 concatenation. This binds the dirty candidate,
not a commit. Final screenshot SHA-256 before cleanup:
`094ff8e5be1c1b16dec6428fc6a194e6131d8370520527f11e65f71310f7901b`.

## Remaining mismatches and unavailable cases

- Maintained Safe Bash typecheck fails before checking source with
  `Public SafeFS must preserve shared SafeJS runtime identity`, actual `undefined`,
  expected `./packages/safe-js/dist/safe-fs.js`. This matches the retained prior
  prerequisite failure. Focused compilation does not complete this blocked gate;
  unrelated export changes were preserved, not repaired speculatively.
- All real-format opener/saver implementations, signatures, malformed/truncated
  native format cases, round trips and optional plugin profiles remain unavailable
  or unmeasured. Probe precedence is measured with original byte fixtures and
  source review; it does not qualify native format-signature detectors. Full parity
  remains blocked by all 48 coverage records, including unavailable source providers.
- Failed discovery currently reports the engine's unsupported-importer diagnostic;
  native's import-context unsupported-format/URI-basename error sequence is not
  implemented. Forced interactive-only importer execution and its native errors are
  unmeasured. Listing exclusion is verified independently of that execution path.
- Cross-provider registration ties depend on the explicitly supplied host order.
  Dynamic native plugin activation/load failures and profile-specific registration
  permutations have not been rerun. Comparisons cover the specified competing
  extensions independently, not every activation permutation.
- Codec-specific option grammars, native fallback `sheet`/`active-sheet` parsing,
  sheet/range selection, split/per-sheet output, overwrite enforcement by actual
  codecs and default destination naming remain unimplemented. Metadata and injected
  option-handler dispatch do not count as native option/scope execution passes.
- General GLib locale translation/transliteration, non-ASCII diagnostics and raw
  non-UTF-8 argv are unmeasured. C listing qualification covers the actual retained
  source descriptions; explicit UTF-8 display is a byte-mode control, not another
  qualified native locale/dependency profile.
- Replay/checkpoint qualification remains unavailable. Existing cooperative
  cleanup/realm/budget tests pass, without establishing hostile host-JavaScript
  isolation, arbitrary callback preemption, a total host-heap bound or performance.
  Discovery is bounded whole-buffer processing with owned copies, not streaming.
- Repository-wide tests/lint/build were not run for this focused package change.
  Selected cross-workspace build/integration checks are reported at their actual
  scope; no broad gate or release qualification is claimed.

The [Markdown QA procedure](../plans/ssconvert-format-provider-registry-qa.md) was
executed for available cells. Owned source/log/capture scratch was removed after
reducing evidence; unrelated `out` content was preserved.

A later [follow-up verification](format-provider-followup-verification.md) records
the current 55-file candidate, fresh plugin-ID census, additional independent
filename/cancellation/budget controls and the corrected Unicode-folding hypothesis.
The preceding counts and hashes describe the earlier candidate only.
