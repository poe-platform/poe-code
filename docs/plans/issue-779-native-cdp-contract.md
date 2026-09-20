# Issue #779: native CDP identity type contract

## Ownership and delivery

- Work in the reused home-owned `issue-778-control-disconnect` worktree.
- Refresh its sparse checkout to delivered #778 main before implementation;
  preserve previous evidence, but include no #778 changes in this patch.
- Patch base: current `origin/main`,
  `6f7e182055655929dbbc804dd5d1dd6a96d43109`, September 18, 2026.
- Own only `src/playwright/adapter.ts`,
  `src/playwright/native-storage-replacement.ts`, the existing
  `tests/plugins/playwright-native-storage-replacement.test.ts` regression
  location within `packages/safe-bash`, and this plan.
- No staging, commits or pushes. Parent owns issue creation and delivery.
  Franklin owns native page/frame adaptation and full consumer acceptance.

## Validated issue

The public context's identity factory promises the full generic private storage
CDP sender, although its binder only needs `Target.getTargetInfo` and `detach`.
Actual installed `@cloudflare/playwright@1.3.6` uses a generic Protocol sender
whose concrete return union includes interfaces without a Record index
signature. The parent reports this public declaration seam in release `.691`.

Before modifying production code, compile an actual imported CF declaration
probe under the parent's installed dependency tree. It fails with two TS2322
diagnostics: factory return and extracted `CDPSession.send` are incompatible with
`PlaywrightStorageCDP`; the actual Protocol union includes `HandoffResponse`
without a string index signature. Exit `2`.

Also add static assertions to the existing maintained native storage test file:
a generic protocol sender uses named concrete responses without Record index
signatures, and its factory and extracted send must fit the public context.
Together with the literal identity-only runtime fixture, this produces three
TS2322 diagnostics before the implementation, exit `2`.

## Implementation plan

- [x] Confirm root/scoped instructions remain unchanged and preserve sparse checkout.
- [x] Obtain actual imported native Protocol RED and maintained regression RED.
- [x] Add `PlaywrightStorageIdentityCDP` with only literal getTargetInfo send
      returning `{ targetInfo?: unknown }` and detach.
- [x] Use it for the public context return and the binder's local CDP variable.
- [x] Remove the binder's type assertion; retain explicit object, nonempty string
      target ID and nonempty string browser context ID runtime validation.
- [x] Leave generic private `PlaywrightStorageCDP` and private lease unchanged.
- [x] Validate an existing generic Record custom sender, statically and at runtime.
- [x] Validate unknown identity results with another failing static fixture before
      widening targetInfo; unknown must reach runtime validation, not need a cast.
- [x] Run actual native and maintained compiler GREEN, focused/adjacent runtime
      regressions, scoped maintained lint policy, and whitespace/patch checks.
- [ ] Parent applies the authenticated delta, verifies its consumer adaptation,
      commits and delivers through its main/release workflow.

## Exact checks

Parent integration applied the authenticated patch at delivered main
`6f7e18205`. The existing maintained regression file compiles with the strict
flags below. Combined identity, target, preservation and transport runtime checks
pass 92 of 93 tests, zero failures, with one hosted test skipped. Maintained root
ESLint policy reports zero errors and warnings for all three changed TypeScript
files; whitespace validation passes. Remote delivery/publication remains pending.

All commands use `TMPDIR="$PWD/out/tmp"` and borrowed root dependencies.
Compiler flags shared by both probes:

```text
--noEmit --strict --noUncheckedIndexedAccess --exactOptionalPropertyTypes
--verbatimModuleSyntax --target ES2023 --lib ES2023 --types node --skipLibCheck
```

Run `node node_modules/typescript/bin/tsc` with those flags and:

- Maintained regression: `--module NodeNext --moduleResolution NodeNext`
  and `packages/safe-bash/tests/plugins/playwright-native-storage-replacement.test.ts`.
- Actual CF probe: `--module ESNext --moduleResolution Bundler`
  and `out/issue-779-native-cdp-real.ts`. It imports the installed real CF
  `BrowserContext`, `CDPSession` and native `Frame`, and also qualifies the
  currently supported generic custom sender. Both final compiles exit `0`
  without diagnostics. This is stronger evidence than the dependency-free
  handcrafted canonical shape alone; it does not execute a native browser.

CF's declarations use extensionless internal imports. Initial NodeNext probe
bootstrap was unsuitable: the package entry failed to re-export the native
types, while a direct declaration import with skipLibCheck could erase the
unresolved Protocol type. Neither result qualifies the seam. Bundler resolution
loads the actual Protocol and supplies the valid RED/GREEN reported here.

An unknown-result static fixture additionally fails before the unknown reply
contract: TS2322, `unknown` is not assignable to the concrete optional identity
shape, exit `2`. Its final compile exits `0`. Runtime rejection controls cover
missing, null, primitive, incomplete, empty and wrong-type identity values.

Focused `node --import tsx --test` on the maintained regression file:
`tests 33`, `pass 33`, `fail 0`, `cancelled 0`, `skipped 0`, exit `0`.
The same command additionally selecting `playwright-adapter.test.ts`,
`playwright-native-storage-targets.test.ts` and
`playwright-native-storage-preservation.test.ts` in `tests/plugins` reports
`tests 67`, `pass 66`, `fail 0`, `cancelled 0`, `skipped 1`, exit `0`.
The optional actual native preservation route is skipped, not counted as a pass.
An initial sparse-checkout run lacked its CF fixture import; materializing that
single unchanged helper fixed the runner setup without a product change.

Scoped lint uses the parent's authenticated maintained `eslint.config.js` with
`createLintSelection(...).eslint.lintText` on the three owned TypeScript files'
worktree bytes. Each reports `errors: 0`, `warnings: 0`, `messages: []`, exit `0`.
This is scoped policy validation, not a guarded full-root lint gate.
`git diff --check` exits `0`. No installation, full build or broad test tree
checkout is needed. Logs, the actual native probe and stable patch remain under
the worktree's `out/` for parent handoff, not in the plans directory.
