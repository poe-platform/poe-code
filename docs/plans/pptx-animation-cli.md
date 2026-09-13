# Animation inventory command integration

Scope: implement `animations list|get` over the bounded package SDK inventory;
keep the safe-bash adapter generic. Get cardinality is one slide graph. A shape
filter retains its containing graph when the shape is targeted. Resource records
follow XML order and retain parent IDs, children, effect and trigger metadata,
targets, timing references, media interactions and motion paths. Closed ordered
typed fields include diagnostic tuples on the first node and standalone XML on
root nodes only. Reads never execute timelines or publish package writes.

Implementation and validation completed September 13, 2026:

- TDD: the original command test first failed with exit 2, unsupported operation.
  `npx vitest run packages/pptx/src/command-animations.test.ts` now passes four
  cases, including populated graph SDK parity, independent ordering assertions,
  closed schema tampering rejection, stale tokens, ambiguous shape names,
  unsupported flags before reads, empty inventories and lowered budget exit 4.
- `node --import tsx --test tests/commands/pptx/animation-inventory.test.ts` from
  packages/safe-bash passes one original memfs test. An authored nested seven-node
  graph passes through a virtual script with a quoted filename. Public SDK node
  IDs agree; literal expected names independently check graph structure. The
  script also checks ambiguity status, limits, retained bytes and absence of
  filesystem writes. Internal package/XML utilities only author fixture bytes;
  the assertions import the public `pptx` SDK and command engine.
- The exact discovery test `default normal runner passes every discovered active
  file to serial Node execution` passes after registration of the new adapter
  test in scripts/integration-inputs.test.mjs.
- Focused `tsc --project /tmp/pptx-animation-typecheck.json` passes. The disposable
  config extends the maintained safe-bash tsconfig, selects exactly the new
  adapter test, sets noEmit and resolves the repository's node type declarations.
- An attempted `SAFE_BASH_TEST_RG=... npm run test:unit --workspace=virtual-bash`
  passed all 499 runner tests, but inspection showed the current test runner does
  not consume that filter. Its subsequent whole discovery execution was stopped;
  this is not a full safe-bash unit-suite pass. Exact focused checks above provide
  the adapter evidence. No whole pipeline, push or release was performed.

Root owns package-wide maintained checks, screenshot QA, public exports,
provenance accounting and atomic Git delivery. The shared command-engine file
contains unrelated changes: stage only its thirteen animation hunks, not the
whole file. The discovery assertion is likewise one owned line in a shared file.
