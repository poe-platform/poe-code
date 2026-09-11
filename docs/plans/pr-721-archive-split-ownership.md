# PR 721: preserve archive and split ownership

## Requested result

Integrate reviewed PR head `50dfdb95baa73b28ea20d07e780ee9f4b048392d` into main. Archive and split commands must preserve entry ownership during publication, cleanup, and directory metadata changes. Foreign replacements must survive. Unsupported filesystem adapters must refuse operations requiring guarantees they cannot provide.

The reviewed change introduces conditional SafeFS mutations and owned staging, forwards or refuses these capabilities through filesystem wrappers, and uses them in zip, unzip, and csplit. Preserve existing identity, revision, cancellation, byte-budget, and metadata contracts. Do not infer atomic guarantees from weaker adapters or widen authority through wrappers.

## Integration ownership

The implementation leaf owns the PR's source and test changes, including the exact canonical assertion for `tests/commands/zip-atomic-ownership.test.ts` in `packages/safe-bash/scripts/integration-inputs.test.mjs`. Root owns this plan, Git integration, final qualification, delivery, and release monitoring. Independent review must inspect the integrated result.

Preserve intervening main changes. The known browser-fixture overlap is additive: retain current LLM coverage in `scripts/fixtures/safe-packages-browser.mjs` while adding the PR's csplit filesystem declaration and read-only denial coverage. Preserve PR 719's admitted-output drain behavior. No branch or broad staging is authorized.

## Verification and delivery

Apply the regression tests first and record concrete failing ownership behavior before implementing the reviewed fix. Run focused SafeFS conditional-mutation, staging, and scoped-cleanup tests, then Bash zip, unzip, csplit, and metadata-wrapper tests. Verify canonical discovery and inspect the current browser fixture. Keep original race controls and foreign-entry assertions intact.

The shared filesystem contract requires normal build and type checks, repository lint, the complete maintained `npm test`, and current packed-consumer qualification. Bind archive checks to a committed candidate and keep it unchanged during qualifications. After full unit tests, run the normal build again before packing so browser bundles include the root suffix stages. A passing PR CI subset does not replace current-candidate checks.

Commit specific owned files conventionally, push main only after qualification, verify the remote commit, and then close the PR as integrated. Monitor every triggered release through successful publication. Report local qualification, remote delivery, and release success separately. PR 719's release may run in parallel with this next integration under the root delivery policy.

## Integrated candidate evidence

Tests applied before production changes reproduced all seven ZIP ownership failures. The focused SafeFS selection reported 37 failures and 45 passes, exposing the missing conditional mutation and staging contracts. Applying the reviewed implementation then passed all 82 SafeFS tests.

Independent review confirmed that 32 of the PR's 33 files match the reviewed head byte for byte. The browser fixture retains current main's newer LLM coverage and adds only the reviewed csplit expectations. The exact ZIP test inventory assertion is present, and PR 719's output implementation remains unchanged.

Initial Bash qualification exposed a build prerequisite mismatch: the root `poe-code/safe-fs/core` import resolves a bundle produced by the root suffix, not SafeFS's emitted workspace module. A SafeFS-only build left a stale bundle; the subsequent SafeJS workspace closure removed but did not regenerate that root bundle. Preserve those failed runs as incomplete prerequisite qualifications, not product assertion fixes or passing tests. The normal `npm run build` then passed and restored the public route. A capability probe passed before the unchanged focused Bash selection was retried.

The correctly built candidate passed all 693 focused Bash tests and all 106 canonical inventory checks, alongside the 82 SafeFS tests. No assertions or production code were changed to accommodate the build mismatch. Source remained frozen during qualification. All 26 maintained SafeBash consumer-type groups passed, with the three expected negative diagnostics preserved. Root type checks and workflow lint also passed. Guarded repository ESLint passed all 10,778 configured inputs with zero errors or warnings. These focused and static checks qualify a local candidate commit; committed-candidate full tests and current packed-consumer checks remain pending before push.
