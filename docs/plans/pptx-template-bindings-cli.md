# PPTX template bindings: CLI acceptance

Ownership: this leaf owns only `packages/safe-bash/tests/commands/pptx/template-bindings.test.ts` and this plan. Root owns command integration, registration, validation and commits. The existing safe-bash adapter delegates literal byte arguments and scoped VFS I/O to the package engine; no adapter logic is needed.

## Contract

Use `template apply` with exactly one of `--data-json` or `--data-file`. JSON carries typed non-executable bindings with explicit scope and cardinality. Exercise the same domain function through the SDK and the registered virtual-shell command. Inputs, scripts and outputs use memfs; no unit fixture downloads or native process execution.

## Acceptance procedure

1. Establish failing CLI cases before command implementation.
2. Run a virtual script with quoted Unicode filenames, repeated binding names and literal braces; assert expected text independently and compare SDK bytes. Bind a structured table and an original in-memory GIF, independently inspect resulting XML/cell strings/geometry/media bytes, and compare SDK output.
3. Validate missing/unknown/structured values and binding declarations before publication. Assert unchanged input and preexisting destination bytes.
4. Exercise JSON file input, dry-run and common publication options. Reject simultaneous JSON input routes and malformed JSON without publication.
5. Run focused maintained checks and inspect command help/errors visually through the root owner. Register the test by exact literal path in `packages/safe-bash/scripts/integration-inputs.test.mjs`.

## Research boundary

Consulted `docs/specs/pptx.md`, shared office CLI/SDK contracts, upstream test/API audits and inventories, and corpus manifest. Typed bindings are a new F57 operation rather than an existing object-model method; package-domain evidence owns relevant text/table/image behavior mappings. No source cases or assets are copied into this test, and this acceptance suite does not claim whole API or corpus coverage.

## Evidence

RED: `node --import tsx --test packages/safe-bash/tests/commands/pptx/template-bindings.test.ts` initially produced two expected failures because `template apply` was unsupported (exit 2); failure/publication protection case passed. Adding the structured table/image case reproduced the same unsupported-operation failure; four cases are authored. Runtime was under one second. GREEN after root's maintained selected pptx closure build: the same focused command passed all four tests, with individual runtimes of 62–156 ms and total runner duration 1.18 seconds. Exact validation statuses/codes are asserted, not accepted as a range.

Strict focused TypeScript check passed after explicitly typing the authored ZIP member byte array:

```sh
node node_modules/typescript/bin/tsc --noEmit --target ES2023 --module NodeNext --moduleResolution NodeNext --strict --noUncheckedIndexedAccess --exactOptionalPropertyTypes --skipLibCheck --types node packages/safe-bash/tests/commands/pptx/template-bindings.test.ts
```

The safe-bash maintained test runner always appends every discovered test path to user arguments (`scripts/test.mjs`), so passing this filename to `npm test` does not select only this case. The focused runtime check uses the same Node/tsx test engine directly. Root owns maintained package build/lint and registry checks. Final security rebuild recheck passed all four cases (1.41 seconds total). No fixture files were written to the host by tests; no adapter changes or commits were made by this leaf.
