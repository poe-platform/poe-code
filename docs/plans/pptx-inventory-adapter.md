# PPTX inventory adapter verification

The adapter owner adds original in-memory CLI regressions and their exact
discovery registration in `scripts/integration-inputs.test.mjs`. Domain inventory
logic and SDK cases belong to the separately assigned package owner. No production
adapter logic, README, downloaded fixture, Git staging, push or release is included.

## Procedure

1. Establish a failing real Shell case for the missing JSON `data.inventory`.
2. Construct an original two-slide/two-master/two-layout/two-theme ZIP in memory,
   store it with memfs, and read it through the explicit adapter filesystem.
3. Independently assert presentation order, canonical graph paths, explicit/default
   visibility and exact counts. Notes, master and layout shapes do not contribute
   to slide-local counts. Repeat with reversed package entry order.
4. Assert the full input inventory accompanies a selected slide, unknown parts
   remain visible, media SHA-256 matches the independent Node test oracle, and the
   versioned JSON/status contract remains intact.
5. Run focused maintained adapter tests after the package owner builds the SDK;
   run applicable source/type checks. Review actual command output visually using
   the existing terminal screenshot workflow if available.

The existing test/API research inventories inform graph and collection semantics;
these adapter cases do not claim complete public model or source-test coverage.
The corpus manifest remains the authority for disposable QA; unit fixtures are
original inline bytes with no downloads or native product I/O.

## Evidence

- Red: `node --import tsx --test packages/safe-bash/tests/commands/pptx/inventory.test.ts`
  failed both original/shuffled variants specifically because successful JSON
  inspection omitted `data.inventory`. Existing input admission and selection
  succeeded before the failing assertion.
- Green after the maintained PPTX build closure refreshed the public SDK:
  `node --import tsx --test packages/safe-bash/tests/commands/pptx/*.test.ts`
  passed all 40 cases in about 1.4 seconds. Both independently declared inventories
  have two slides, two masters, two layouts, two themes, three slide-local shapes,
  twelve OPC parts and one media part.
- `npx eslint packages/safe-bash/tests/commands/pptx/inventory.test.ts` passed.
- An attempted package test invocation with `SAFE_BASH_TEST_RG` showed that the
  package runner does not honor that selector and discovered 1,074 files. The
  accidental broad run was immediately terminated; no complete-suite success is
  claimed. The exact focused Node route above is the adapter verification.
- Opened and inspected `/tmp/pptx-inventory-adapter.png`, generated with the existing
  terminal PNG renderer from actual Shell human output and a labeled pretty-printed
  JSON inventory excerpt. Ordered IDs, graph paths, counts and visibility are
  readable without clipping. The root screenshot command cannot register this
  explicitly injected optional plugin; no screenshot or fixture is staged.
- Maintained `npm run typecheck --workspace=virtual-bash` passed source/tests,
  historical and source consumers, and 26 current public consumer groups. Expected
  negative consumer cases rejected correctly. Its final status was
  `typecheck-passed-not-runtime-acceptance`, with zero runtime executions and
  temporary inputs cleaned.
- The scoped exact-path registration requirement applies to the new integration
  regression. Added its literal path beside the existing selector regression in
  `packages/safe-bash/scripts/integration-inputs.test.mjs`, preserving all other
  membership assertions. The focused command
  `node --test --test-name-pattern='default normal runner passes every discovered active file to serial Node execution' packages/safe-bash/scripts/integration-inputs.test.mjs`
  passed its one selected registration case; all 1,074 discovered active paths,
  including the new inventory path, were admitted by the normal runner assertion.
  `npx eslint packages/safe-bash/scripts/integration-inputs.test.mjs` and the
  changed-path whitespace check passed.
