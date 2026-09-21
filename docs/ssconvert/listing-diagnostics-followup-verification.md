# Listing and diagnostics follow-up verification

This follow-up preserves the existing implementation and earlier evidence in
`listing-and-diagnostics-verification.md`. It repairs two validated output
classification discrepancies: GLib excludes vertical tab from whitespace, and
accepts Unicode letter/number categories in unquoted export-option keys.
Three vertical-tab regressions failed before root's repair. A different agent
reproduced `é=1` yielding syntax error before repairing it to yield the unknown
export-option diagnostic. The shared CLI/SDK engine uses pinned Unicode 16 data
and advances supplementary keys by code point. No runtime/native dependency,
fallback, generic status handler or export/integration change was introduced.

## Candidate identity

Verification used the dirty main worktree based on
`b97c4938a469ee70e09bd08a0e5fcf7e868ca04c`, not a committed release candidate.
The aggregate SHA-256 is
`64112a6321b241e82009dc19a236815094817116b909186aa95b897f97b22948`.
Its reproducible input is 74 lexicographically sorted relative paths: all
`packages/ssconvert/src/**/*.ts`, `packages/ssconvert/scripts/*.mjs`, the package
manifest and both tsconfig files, and safe-bash's ssconvert adapter and command
test. Hash each path's UTF-8 bytes, NUL, exact file bytes, NUL consecutively.

| Edited file | SHA-256 |
| --- | --- |
| cli/export-options.ts | 00c1d0671046152b5a7e85e3ce5a6db857ed2164a1035695cc29d9f7b27cdc31 |
| cli/unicode-alphanumeric.ts | 010fa25f6e14b705e3ac93d234cddfd50b60e9e526ca793e4d1dc878e13ef251 |
| scripts/generate-unicode-alphanumeric.mjs | afe256cac17df594673bf1af4de2686e5ecdebdb7731374927eb643dee7a4507 |
| cli/listing-review.test.ts | f85ca1e832ba13972a7af7747f5e2265f384728063057c31b95ddb5b7a4afb4c |
| cli/diagnostics-independent.test.ts | 959e310d2f0b69451f47c22d3290e464cde7332a5a4e42d165d9fe1e5b1a8f8f |

Paths in this table are relative to `packages/ssconvert/src`, except scripts.

## Completed checks

| Check | Result |
| --- | --- |
| Maintained package tests | `npm test --workspace=@poe-code/ssconvert`: 335 passed, 21 files, zero failures/skips/TODOs; no result-cache skips |
| Independent agent stress | 45 passed: whitespace/nonspace controls, Unicode categories/supplementary keys and Unicode17/combining/surrogate negatives, listing ordering/width/cancellation, falsey sink exception identity, CLI/SDK sinks and namespace preservation |
| Maintained package lint | `npm run lint --workspace=@poe-code/ssconvert`: ESLint, production TypeScript and test TypeScript passed |
| Selected uncached build | `npm run build:workspaces -- --workspace=@poe-code/ssconvert --no-cache`: passed declaration-derived single-workspace closure |
| Generator syntax/lint | `node --check` and explicit ESLint of generator passed |
| Virtual Shell integration | `node --import tsx --test packages/safe-bash/tests/commands/ssconvert.test.ts`: 16 passed, zero failures/skips/TODOs, on final built engine |
| Built public command reference captures | Exact status/stdout/stderr equality for version, 19 importers, 26 exporters and image enum listing; codec activation fixtures prove listing metadata only |
| Independent category differential | Every one of 1,114,112 code points matched official Unicode 16 UnicodeData L*/N* categories; no random seed or performance qualification involved |
| Ad hoc screenshot | Built public image listing inspected: readable aligned columns and enum order; screenshot SHA-256 c80cd68dcc61a9257c328a12d0076d4ce1068d16ea21409cd7811df6d1a18a11 |

Manual QA followed `docs/plans/ssconvert-listing-diagnostics-followup-qa.md`.
Gnumeric, GOffice and GLib official sources were acquired exclusively in owned
`out/ssconvert-listing-current` scratch. Archive SHA-256 values matched the
captured profile, including required Gnumeric
`2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12`.
The classifier's authenticated GLib header hash and Unicode license accompany
the generated source. The independent UnicodeData source hash was
`ff58e5823bd095166564a006e47d111130813dcf8bf234ef79fa51a870edb48f`.
Native ssconvert was not invoked. Owned scratch was purged after reduction.

## Incomplete and unverified cells

An attempted maintained safe-bash run with `SAFE_BASH_TEST_RG` ignored that
selector and started its 1,335-file inventory. Root stopped the owned process
tree after progress beyond 200 files: this is an incomplete gate, not a pass
or timeout. Its visible numeric/null CSV serialization and XLSX descriptor
items were TODOs, not repaired or certified here. No completed repository-wide
`npm test`, lint or build is claimed for this follow-up; code changes remained
inside ssconvert. Earlier report gate results belong to the earlier candidate.

The earlier report's remaining mismatches and unmeasured cases remain applicable
except its ASCII-only unquoted option-key discrepancy, now fixed. In particular:
fresh native diagnostic/conversion/sink differentials, optional plugin/locale
cells, platform errno/backend/partial-publication variants, non-UTF-8 resource
names, URI/descriptor aliases, full reference grammar, valid raw transformations,
supported subset/split execution and rich merge semantics remain unsupported or
unmeasured. Non-C translated/encoded diagnostics are unverified. The captured
C argument profile requires explicit UTF-8 argument encoding to exercise Unicode
option text. The Unicode classifier does not broaden that profile implicitly.

Existing package tests exercise budgets, inherited-accessor denial, byte ownership,
host cleanup and cancellation; this follow-up adds independent cancellation and
sink-negative controls, without changing authority boundaries. Other realms,
browser/workerd executions and original/checkpoint/replay execution have no new
measured cells; the command does not implement checkpoint/replay. Exhaustive
category equality is deterministic semantic evidence, not a throughput/RSS bound.
Unavailable profile cells, unsupported operations and partial gates are not passes.

No README files, existing reference profile or unrelated edits were changed.
No local commits, remote delivery, pushes or publications were performed.
