# Issue 669: narrow default preset wiring

## Approved API and scope

- Make `PortableAgentCommandsOptions.provider` optional and default
  `portableAgentCommands(options = {})` to one existing
  `createBoundedRegexProvider()` per factory call only when provider is omitted.
- Reuse the selected provider for the existing general and optional separate
  search executors. Keep composition, the independently asserted 79-command
  inventory, collision preflight, replacement and execute fallback unchanged.
- Preserve family options and limits. General grep, aliases and expr keep their
  existing shared portable executor; an explicit search regex policy gets its
  own executor, not a new provider. Provider limits remain a separate bound.
- Own only the preset source, the new focused default-preset test, this plan,
  and the approved optional-provider and browser-output-graph assertion updates
  in the existing portable test. Root owns test registration, public aliases and compatibility/versioning;
  other workers own bounded-provider review and shared bundle identity.

## Ownership and semantics

- Executors own and close their acquired endpoints. Disposal remains idempotent
  per preset, covers both executors, and blocks subsequent setup.
- Providers are borrowed capabilities, including when shared across presets.
  Never call a provider-level disposal method or close caller-owned endpoints.
  The default provider exposes no provider-level disposal requirement.
- Existing bounded ERE/literal profiles are unchanged. Unsupported modes retain
  explicit errors; no native RegExp or host-worker fallback is introduced.
  Cooperative limits do not establish native isolation, RSS bounds or full
  Bash/GNU regex parity. Injected-provider guarantees remain the caller's.
- The future root `agentCommands` alias is a separately versioned compatibility
  change, not a claim that this factory already has unrestricted Node behavior.

## TDD and validation

1. Add focused in-memory workflow, unsupported-mode, admission-limit, routing,
   sharing, cancellation and disposal tests; intentionally replace only the old
   explicit-provider-required assertion with the optional-default contract.
2. Run RED with Node 22 selected by `/tmp/kamilio-toolchain.path` and the maintained
   `scripts/test-reporting.mjs` runner before changing product code.
3. Apply the minimal factory wiring and rerun focused GREEN plus adjacent portable
   and provider tests. Keep exact RED/GREEN results here; no disk unit fixtures.
4. Hand off root manifest/public compatibility work without commits or pushes.

## Evidence: September 8, 2026

Toolchain: `/tmp/kamilio-toolchain.path` selected Node `v22.22.0`. All unit
fixtures use the in-memory filesystem or in-memory endpoints. No Git operations,
README edits, host-file fixtures, public export changes or manifest edits.

The maintained reporter command prefix, from repository root, is:

```sh
TOOLCHAIN=$(cat /tmp/kamilio-toolchain.path)
PATH="$TOOLCHAIN/bin:$PATH" node packages/safe-bash/scripts/test-reporting.mjs \
  --import tsx --experimental-test-isolation=none
```

Append one exact test path listed below for per-file diagnostics. The explicit
no-isolation diagnostic mode exposes individual cases in this environment.
Normal maintained isolation is authoritative: omit that flag and use
`--test-concurrency=1`. Root requested no further combined-file no-isolation
runs because of possible cross-file global prototype interference.

- First reporter RED: one failed file summary, without individual diagnostics.
  Direct diagnostic execution exposed five intended optional-default failures
  plus one incorrect test assumption about regex request counts: consumers send
  validation requests too. Corrected that assertion to check every request's
  per-command routing, without changing product code.
- Meaningful pre-product RED through the maintained reporter: **9 cases, 4 pass,
  5 fail**. Omitted options threw while reading `options.provider`; empty options
  and omitted providers threw `a bounded regex provider is required`.
- Initial product wiring reached 8/9; the remaining fixture assertion compared
  a registry-owned command with its pre-registration input object. Corrected it
  to preserve the actual pre-replacement registry identity. Then **9/9 GREEN**.
- Added independent structured/search family-limit coverage; the new suite now
  has **10 cases**. An earlier combined diagnostic run with the existing portable
  preset and endpoint provider suites reported **56/56**, zero skipped/cancelled/
  TODO; this is diagnostic only, not the authoritative isolation result. Normal
  isolated reporter mode passed all three file summaries and was rerun for final
  handoff. The new suite also passed all ten cases in a per-file diagnostic run.

Exact passing cohort:

- `packages/safe-bash/tests/plugins/portable-default-agent.test.ts`
- `packages/safe-bash/tests/plugins/portable-agent.test.ts`
- `packages/safe-bash/tests/commands/regex-execution/provider.test.ts`

Additional approved assertion migration: the bundler worker changed the browser
build to joint browser/portable splitting. The old all-input scan reproduced
RED on `node:crypto` from the portable-only graph. The browser test now requires
exactly one emitted `browser.js` entry and follows every internal output import,
including shared chunks, rejecting any reachable Node builtin. The complete
existing portable test is in the passing cohort; all other existing cases stay
unchanged except the separately approved optional-provider contract assertion.

Broader checks and handoff, not claimed as passing gates:

- Adding `packages/safe-bash/tests/commands/regex-execution/portable.test.ts`
  produced **66/67 pass**. Its Node-global-free VM test transforms only emitted
  `browser.js`, then rejects a newly split shared chunk at runtime. Root was
  notified to coordinate its in-memory bundling migration with the bundle owner;
  this worker does not own that test.
- `node packages/safe-bash/scripts/historical-type-models.mjs --noEmit`
  completed with only two TS18048 diagnostics in
  `tests/commands/regex-execution/node-provider.test.ts:20` and `:21`
  (`worker.resourceLimits` possibly undefined), reported to root. No diagnostics
  named this worker's files. This is not a clean overall typecheck claim.
- Root has registered the new test literal. Root still owns public alias,
  compatibility/version decisions and integrated lint/build/release validation.
  After the earlier source-check result, root requested no further broad worker
  typechecks and will run maintained build and workspace typecheck on the frozen
  candidate. The VM migration is also root integration work.
  No CLI visual presentation changed; no screenshot qualification is claimed.
