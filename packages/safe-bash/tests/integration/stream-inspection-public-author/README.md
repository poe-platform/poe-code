# Stream inspection public/default author integration

This is author integration evidence, separate from the independent public
consumer verifier. Its private/new `stream-inspection-public` cases were not
read or modified. No stream command implementation, kernel, filesystem, grep,
curl, SafeJS, table-text, dependency or package script was changed here.

## Scope and results

The root exports and `virtual-bash/commands/stream-inspection` expose
`createStreamInspectionCommands(options?): readonly CommandDefinition[]`,
`streamInspectionCommands(options?): VirtualShellPlugin`,
`StreamInspectionCommandsOptions` and `StreamInspectionLimits`.
The aggregate accepts `streamInspection?: Omit<StreamInspectionCommandsOptions,
"replace">`; only its top-level `replace` controls registration.

- Baseline `ef1699b`: actual factory and plugin registries both contain 56 unique
  names. The exact original aggregate test text and source manifest are retained
  in `evidence/baseline-state.json`; nine applicable files pass 124/124 in
  `evidence/baseline.json`.
- Wiring `3fb1405`: both registries contain 60 unique names, adding exactly tac,
  expand, fold and strings. The untouched old tests produce 122/124: only the
  exact-name list and custom-command count are stale. Full raw output and the
  unchanged assertion hash are in `evidence/wired-old-expectations.json`.
- Expectation-only commit `81a0ab7` changes the family title, four names,
  56→60 twice and 57→61 once. No other assertions change. The same nine files
  pass 124/124 in `evidence/updated-expectations.json`.
- New author tests add 21 cases: factory/plugin actual Shell dispatch of all
  four, atomic collision preflight, replacement, limit forwarding/isolation,
  memory and explicitly rooted real VFS byte pipelines, registry-only fallback,
  actual literal invoke/middleware/shared budgets, and optional-command absence.
- Initial combined run: 144/145. The author test incorrectly compared a registry
  entry to its pre-registration input object; the registry stores its own
  definition. Corrected only that assertion to compare the original stored
  entry. `evidence/initial-public.test.ts.txt` and `validation-001.json` preserve
  the exact faulty test and run. No production fix or utility diagnostic
  relaxation was involved.
- Corrected combined run: 145/145, zero skips/TODOs; scoped strict noEmit exits 0
  (`evidence/validation-002.json`). This is not a whole-repository test gate.
- Isolated build/pack/consumer passes (`evidence/validation-003.json`): root and
  subpath runtime identities, both public types, readonly definitions, aggregate
  option type, and top-level-only replacement compile. Twelve dispatches cover
  all four commands through plugin/factory/standalone, plus two VFS pipelines
  through each aggregate mode. Curl/SafeJS are absent from 60 unique defaults.

## Reproduction and package boundaries

From the repository root, using the existing development toolchain:

```sh
node tests/integration/stream-inspection-public-author/verify.mjs tests
node tests/integration/stream-inspection-public-author/verify.mjs package
```

Omitting the mode runs both. Every run creates a new `evidence/validation-NNN.json`
without overwriting prior attempts. Raw command arguments, output, statuses,
source/config/toolchain hashes and timestamps are retained. Tests use node:test
through tsx with strict unhandled rejections. The scoped configuration checks
all source and only the named public/aggregate tests, not competing test suites.

The package check snapshots source, package metadata, README and build configs
under this directory's ignored `dist/build-*`. Existing TypeScript emits only
inside that snapshot. `npm pack --offline --ignore-scripts` uses a new local cache,
isolated HOME and empty npm config files; no install runs. Native `tar` merely
extracts this locally produced package for the test consumer, never a virtual
command. All emitted files are hash-compared with their extracted counterparts.
Only packed dist and metadata are available in the consumer's package directory;
its own package name prevents a repository package self-reference. Runtime
resolutions are asserted to point inside the extracted package. Consumer
TypeScript uses explicit existing development types. This author probe is not
the separate reviewer's frozen offline consumer or an OS network-confinement test.

Observed Node22.22.2/npm10.9.7/TypeScript5.9.3/tsx4.23.12/@types-node22.20.1,
Darwin arm64. The first author tarball contains 574 files and has SHA256
`50c4bb16174543136f6b7708a6e14b98f615c550cc12b99174ededd910c67d9b`.
The full local artifact path, declaration hashes and source snapshot manifest
are in `validation-003.json`. Its source included the documented README edits
before their commit; it is an accurately hashed dirty-document snapshot, not a
clean committed-HEAD claim. All child processes exited; artifacts remain under
the ignored author dist subtree. Main dist and source were unchanged by checks.

Final `validation-004.json` repeats all 145 tests, scoped noEmit, isolated build,
pack, type and runtime consumer checks after documentation commit `6db2395`;
all pass at 2026-08-27T05:26:50.467Z–05:26:55.065Z. The second package has the
same SHA256 and file count. Source/config/development-tool hashes and main dist
stay stable during validation; unrelated worktree changes are recorded, not
claimed clean. `evidence/final-freeze.json` checks the exact seven accepted
implementation files, public API hashes, unchanged historical source-test
cohorts, export-map-only package delta, actual 60 names and dated 50+4 inventory.
Its 2026-08-27T05:27:48.648Z freeze precedes only final evidence publication;
no later product source edits are made by this author.

Official Node package exports and npm10 pack/config documentation were consulted
via web.run; exact consulted URLs are recorded in the validation JSON. Actual
local versions and results, not assumptions about those moving documents,
establish this package evidence.

## Preserved boundaries

The accepted source checkpoint is `335d2c3705b4892a56e807010cd7ca50145fefce`.
Its eight-file manifest, including the original README, was verified as
`4c52a321778aafad0e41b5858d30746d728306e35e26a44554146a69a05c91a0` before
wiring. All seven TypeScript files remain byte-identical. Only the module README
receives authorized current public/default and accepted numeric-profile
corrections; that deliberate doc delta changes the combined eight-file digest.

Independent original 84/85, separate native semantic 85/85, strict 68/85 with
17 diagnostic differences, and corrected contract 39/39 remain unchanged
historical cohorts. Previous author 99 and numeric-fixer 82 are separate,
not additions to this integration denominator. No native oracle was rerun.
The measured missing-name inventory in the original SELECTION.md remains dated
50 default plus 4 optional names, not 54 proven baseline workflows.

Tunable bounded tac buffering, C/POSIX byte-column expand/fold and raw 7-bit
ASCII-plus-TAB strings remain their actual profiles. Numeric options are now
accepted within pinned GNU/Darwin evidence; concise errors are not full GNU
diagnostic-byte parity. SGID6 and environment normative policy are unchanged.
No deployed-provider, full GNU/Linux, superiority, full-product or 72-hour claim
is made. Independent frozen public review still follows normal author closure.
