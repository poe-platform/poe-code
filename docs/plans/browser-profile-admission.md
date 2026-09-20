# Current browser profile admission and lifecycle

## Scope and baseline

This milestone targets the existing `profile.ts` API in the
`profile-admission-audit` worktree at
`fb9380580142475b4d2dfd840f82899f1f7603a5`. Before source edits, its Git blob and
worktree hash both matched `65875d978955412034213e84d0844e833ea46075`.

Owned paths:

- `packages/safe-bash/src/playwright/profile.ts`
- `packages/safe-bash/tests/plugins/playwright-profile-admission.test.ts`
- This plan.

The earlier `browser-profile.ts` prototype and its evidence remain draft-only;
they are not used as proof against current main and are not integrated here.
Root owns index exports, test registration, maintained build prerequisites, lint,
commits, remote delivery and publication smoke. No commit, push, SDK dispatch,
provider binding or secret access belongs to this milestone.

## Targeted implementation

Preserve all current signatures:

```ts
encodeBrowserProfile(profile, limits)
parseBrowserProfile(bytes, limits)
restoreBrowserProfile({ adapter, profile, limits, name, signal })
checkpointBrowserProfile(session, limits, signal)
```

Completed targeted fixes:

- Admit encoder limits before serialization. Check the known own-data tab array
  before serializing provider runtime state, without invoking tab accessors early.
- Count serialized UTF-8 bytes before allocating the TextEncoder output buffer.
  Ordinary JSON serialization, including runtime-state `toJSON`, omitted values,
  nonfinite numbers and escaped/lone-surrogate strings, remains intact. This does
  not bound `JSON.stringify` scratch memory or sandbox hostile host callbacks.
- Validate checkpoint tab count and selected-page ownership before storage read.
  Revalidate the current page snapshot after storage read and provider capture so
  stale selection cannot silently become selection zero and provider-added tabs
  cannot evade the final tab bound.
- Validate restore's combined existing plus to-create page count, including the
  blank fallback, before the first allocation inside the owned lease failure path.
  Check acquired cancellation first. Release rejected leases and preserve cleanup
  error aggregation; never close existing tabs or require a fresh context.

Provider `runtimeState`, capture/restore hooks, deferred initialization, acquisition
policy, reader cleanup aggregation and optional `contextOptions: {}` normalization
are preserved. Valid existing contexts remain supported within the combined limit.

## TDD verification

September 19, 2026, Node.js `v22.22.0`:

1. Red against the untouched matching source snapshot: the initial 33 direct-source
   and lifecycle tests exited 1 with **15 failures and 18 passes**. Five checkpoint
   assertions reproduced foreign/stale selection, premature storage read, and
   provider-capture tab growth. Seven encoder assertions reproduced serialization
   before invalid-limit/known-tab admission and UTF-8 allocation before byte-limit
   rejection. Three restore assertions reproduced combined-tab/fallback overflow
   and the missing rejection/retirement path.
2. Exact failures included `Missing expected rejection`, runtime-state serialization
   count **1 instead of 0**, storage read count **1 instead of 0**, and UTF-8 encoder
   call count **1 instead of 0**. Existing metadata, JSON semantics, cancellation,
   lease-error aggregation and complete reader-cleanup draining controls passed.
3. Green after targeted source edits: **33/33** tests passed. Two additional cleanup
   preservation controls bring the final focused suite to **35/35**, with zero
   failures, skipped cases or cancellations.
4. Adjacent reader/configuration verification: the combined three-file source run
   passed **80/80** tests, including nested reader cases, with zero skipped cases.
5. Scoped TypeScript checking of the changed source/test dependency closure using
   safe-bash's maintained compiler options reports **zero diagnostics**. One test
   assertion initially narrowed an event array to `never[]`; checking its length
   instead fixes the test type error without changing product code.
6. Source and new-file whitespace checks pass. Maintained build/typecheck, root
   lint and publication validation remain with the integration owner; these local
   source checks do not certify a release or live Cloudflare behavior.

Focused source test command:

```sh
node --import tsx --test packages/safe-bash/tests/plugins/playwright-profile-admission.test.ts
```

Adjacent source checks:

```sh
node --import tsx --test --test-concurrency=1 \
  packages/safe-bash/tests/plugins/playwright-profile-admission.test.ts \
  packages/safe-bash/tests/plugins/playwright-open-options.test.ts \
  packages/safe-bash/tests/plugins/playwright-native-storage-replacement.test.ts
```

The admission regressions import current source directly and use memory-only
contexts. Cleanup-registration controls additionally bundle that same source with
an in-memory reader substitute using esbuild `write: false`; no product injection
API is added. Tests perform no browser acquisition, network access or fixture-file
writes. Verification output stays on stdout with no temporary evidence files.

## Integration handoff

- Integrate only the three owned paths; preserve the existing public exports.
- Register the exact new test path through the root-owned maintained inventory.
- Run maintained build/typecheck and lint with the required workspace prerequisites.
- Verify public package smoke, remote-main delivery and release separately.

## Maintained integration checks

September 19, 2026, the integration owner verified the exact candidate in its
HOME worktree:

- Selected safe-bash workspace build closure with `--no-cache`: exit 0,
  15 declared dependency builds across the derived 83-workspace inventory.
- Adjacent source suites: 80 passes, zero failures or skipped cases.
- Maintained integration input tests: 120 passes, zero failures or skipped cases.
- Maintained package `typecheck` and `typecheck:all`: exit 78 before consumer
  compilation because 18 browser export artifacts are absent. The scoped package
  publisher generates these bundles separately; the source build does not.
  This is an incomplete maintained typecheck, not a passing gate.
- Scoped compiler verification uses the maintained strict compiler options and
  the changed source/test dependency closure: 291 source files, zero diagnostics.
  It does not replace the full package consumer gate.
- Maintained root ESLint with `--no-cache`: exit 0, 16,127 configured subjects
  linted, zero errors, four preserved warnings, and zero cache hits.

The previous scoped SDK publication at source
`fb9380580142475b4d2dfd840f82899f1f7603a5`, version `0.1.697`, passed
independent archive integrity/provenance, fresh registry installation and profile
import smoke. This authenticates the preceding release only, not this patch.
