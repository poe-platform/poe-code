# Independent security partial-remediation review — 2026-08-30

## Decision

**SCOPEDREADY.** The corrected, root-authorized read-only consumer probe exited 0 on Node 22 and Node 18. Both runs reported `allControlsMatch: true` and `overallGatePass: true`; the exact version controls were shell-quote 1.8.4 rejected, 1.9.0 accepted, and 1.10.0 accepted. This supersedes only the consumer-process hold in frozen manifest SHA-256 `46af0ed7e324d61e04ef3980022cedf945276366a89672b0baf777976edc1c3e`.

The decision remains scoped partial remediation: 28 unique advisories removed, no added advisory, and no observed product regression in the retained evidence. It does not approve publication, establish whole-project Node 18 readiness, clear all security findings, or close T3.

## Probe correction and current preimages

The authorized wrapper executed once and its external shell record reports exit 0. Node 22 ran from `2026-08-30T10:30:53.773321Z` through `2026-08-30T10:30:54.294723Z`; Node 18 ran from `2026-08-30T10:30:54.295388Z` through `2026-08-30T10:30:54.778920Z`. Both runtime exits were 0 and both stderr captures were empty. Shell-level wrapper start/end timestamps are unavailable because `/usr/bin/date` was absent; no substitute times are inferred.

The successful probe replaces the prior fixture's lexical comparison defect, which treated `1.10.0 < 1.9.0` as true and produced historical exits 1/1 despite JSON `ok: true`. Those original exits and unsupported per-command timestamps remain preserved in the frozen HOLD evidence; they are not rewritten. The earlier worker's invented missing-`SHA256SUMS` stop occurred before any probe and is retained as a metadata-only diagnostic, not a product failure or additional run.

At exact commit `9b344cca528d0715917b3a4e84247b0af0258eb4` (`fix(safe-js): preserve host record prototypes during replay`), all six publication preimages match the tested `a015d8c28fa652133289949f9549ae4b47547ec5` expectations. The four existing paths match exact bytes and SHA-256; the author plan and this independent report remain absent. Thus the scoped patch is preimage-compatible with that exact current target. The fetched `origin/main` had advanced to `1b180668e29f43421ab2b89210a17ab6eab8c06e`; no readiness claim is made for that later commit.

## Retained evidence

- Node 22 default suite: exit 0, 26,732 passed, 41 skipped, 0 failed (26,773 tests; 3,343 nested suites, not source files).
- Focused eight-file checks: 256 tests on each of Node 22 and Node 18, both exit 0. Build was 68/68, package lint 17/17, lifecycle pack exit 0, and owned-file lint/types exit 0.
- Audit: 31 unique baseline GHSAs to 3 candidate GHSAs, 28 removed and none added; audit exit remains 1. T3 remains held for `GHSA-3jxr-9vmj-r5cp`, `GHSA-mh99-v99m-4gvg`, and `GHSA-rgw5-rvv9-x895` on unchanged brace-expansion 5.0.6 paths under `@ts-morph/common`, `braintrust`, and `test-exclude`.
- The 25 lock records and the five unchanged author files remain bound by the frozen 46-file evidence index. The retained artifact SHA-256 is `7d8569b475430bb89b7ea92af666902da66c681dc04e4dd69a3508ca6f0099db`; it is development version `0.0.0-dev`, not a published release.
- The corrected probe observed poe-code's physical shell-quote 1.10.0, gray-matter 4.0.3, and nested js-yaml 3.15.1; canonical/legacy public root/core/CLI ESM identities and bin metadata matched, and small shell/YAML alias parses succeeded. Agent/frontmatter caller modules were not imported. Browser conditions were metadata-inspected only, not executed.

## Qualifications

Earlier paired Node 18 baseline/candidate evidence at `49eea61131a83e2713c5b7ca3b198631bef7be4c` still has build and package-lint exits 1 from the same `node:sqlite` invalid-external rejection at `scripts/bundle.mjs:423`; candidate tasks were 66/68 cached, not clean all-source equivalence. Historical `dd7` evidence remains 99 matched assertions per side, raw exits 130, with candidate extra `packages/toolcraft/src/testing/fakes.test.ts` and shutdown unknown. There is no waiver, full Node 18 pass, answered minimum-Node-22 decision, or engines change.

The unisolated `npm init -y` HOME exception remains; no all-isolated or HOME-untouched claim is made. Unrelated seed shell-quote 1.8.4 and js-yaml 3.14.2, old `require.resolve` fixture failures, generated font paths, and `out/` remain retained qualifications; the tree is not clean. MCP/OAuth, universal-consumer security, browser runtime behavior, and an actual release artifact were not newly proven. No fork was used.

## Remaining publisher gates

Root/publisher still must compose this exact six-path change into the intended current target, run normal current hooks, and validate the actual published/version-stamped release artifact. No security publication is approved by this review.
