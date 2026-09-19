# Configuration-aware browser profile restoration

## Atomic scope and baseline

Work only in the detached `profile-configuration-restore` worktree at
`fb9380580142475b4d2dfd840f82899f1f7603a5`. Before source changes,
`packages/safe-bash/src/playwright/profile.ts` matched Git blob
`65875d978955412034213e84d0844e833ea46075`.

Owned paths:

- `packages/safe-bash/src/playwright/profile.ts`, acquisition derivation only.
- `packages/safe-bash/tests/plugins/playwright-profile-configuration.test.ts`.
- This plan.

The separate admission worktree remains untouched. Root integrates this small
source diff on top of admission, registers the exact test inventory entry, runs
maintained prerequisites/lint, and owns atomic delivery and publication. This
assignment performs no branch creation, commit, push or SDK dispatch.

## Targeted behavior

The existing restore signature and validated persisted profile remain unchanged.
Derive the two acquisition values from the parsed configuration:

```ts
browser: profile.configuration?.browserName ?? 'chromium'
headless: profile.configuration?.headless ?? true
```

Missing configuration or an omitted individual field keeps its legacy default.
Explicit `headless: false` is retained. No provider-specific branches, fallback
browser selection, new acquisition policy or capability wrapper are added.

The existing adapter remains the authority for provider support. Its unsupported
engine/headed decisions must propagate instead of being bypassed by unconditional
Chromium/headless acquisition. Tests exercise these decisions through the actual
`createPlaywrightAdapter` with memory-only native stubs, as well as a custom
provider's rejection identity.

Runtime-state restoration, deferred navigation, context/storage options, selected
page, optional settings, cancellation checks and lease retirement are untouched.
The product diff replaces one acquisition line with three lines; no admission
implementation is copied into this worktree.

## TDD and verification

September 19, 2026, Node.js `v22.22.0`:

1. Red against the untouched matching source: **20 tests, 10 failures, 10 passes**.
   Five full configuration cases and three partial-configuration cases acquire
   incorrect browser/headless values. Two actual-adapter capability tests fail with
   `Missing expected rejection`: stored Firefox is silently replaced with
   Chromium, and stored headed Chromium is silently replaced with headless mode.
2. Concrete mismatches include acquired `chromium` instead of `firefox`/`webkit`,
   and acquired `true` instead of stored `headless: false`. Legacy defaults,
   invalid-profile rejection and lifecycle preservation controls already pass.
   Invalid acquisition settings assert the parser's exact `Invalid configured
   browser` and `Invalid configured headless mode` messages before any acquisition.
   The custom provider rejection control verifies Firefox/headed acquisition
   arguments and preserves the provider's original rejection identity.
3. Green after changing only the two acquisition values: **20/20** focused tests
   pass, with zero failures, skipped cases or cancellations.
4. Adjacent source verification passes **65/65** tests, including nested native
   reader cases, across the dedicated suite, open options and storage replacement.
5. Scoped TypeScript checking of the changed source/test dependency closure uses
   maintained safe-bash compiler options and reports **zero diagnostics**.
6. Source and new-file whitespace checks pass. These local source checks do not
   certify maintained full typechecking, a release or live provider behavior.

Focused command:

```sh
node --import tsx --test packages/safe-bash/tests/plugins/playwright-profile-configuration.test.ts
```

Adjacent source checks:

```sh
node --import tsx --test --test-concurrency=1 \
  packages/safe-bash/tests/plugins/playwright-profile-configuration.test.ts \
  packages/safe-bash/tests/plugins/playwright-open-options.test.ts \
  packages/safe-bash/tests/plugins/playwright-native-storage-replacement.test.ts
```

Tests import source directly, use memory-only adapter/context/browser stubs, and
perform no network access, real browser acquisition or fixture-file writes.
Verification output stays on stdout; no temporary evidence files are retained.

## Parent integration

- Apply only the acquisition derivation diff on top of the admission milestone.
- Add the dedicated test's exact maintained inventory registration.
- Keep legacy-default assertions for omitted values. Any earlier admission test
  expecting acquired `headless: true` despite explicit stored `headless: false`
  must be updated by the integration owner to the authorized new behavior; no
  admission test or worktree is edited here.
- Run maintained build/typecheck, lint and public smoke before atomic delivery.
- Report remote-main delivery and publication independently from local checks.

## Current-main integration TDD

Against remote-main admission source
`76735b2625227774c58368b37c42711c6b48a66c`, the final dedicated 20-test suite
reproduced 11 failures and 9 passes before the acquisition fix. In addition to
the original ten regressions, the expanded provider rejection control observes
the wrong acquired browser. No publication or provider work is inferred from it.

After the acquisition-only source change, the dedicated, admission, open-options
and storage-replacement suites pass all 100 tests with zero failures, skipped
cases or cancellations. The admission preservation control now expects the
explicit stored `headless: false`; its ownership and deferred-restore assertions
remain intact.

Integration checks on September 19, 2026:

- Maintained selected safe-bash build closure with `--no-cache`: exit 0.
- Maintained integration input tests: 120 passes, zero failures or skipped cases.
- Maintained root ESLint with `--no-cache`: exit 0, all 16,128 configured
  subjects linted, zero errors, four preserved warnings, zero cache hits.
- Scoped strict compiler check of the profile source and both regression suites:
  292 source files, zero diagnostics.
- The package-wide typecheck prerequisite remains incomplete: its source build
  does not produce 18 browser export files generated by the scoped publisher.
  Neither these focused checks nor a publication job prove a full local
  package-consumer gate or hosted Cloudflare acceptance.
