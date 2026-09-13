# Live table and gradient collection evidence

Read against upstream-api-audit.md, upstream-api-inventory.json (`collection_protocols` and inherited protocol records), upstream-test-audit.md, upstream-test-inventory.json and api-language-mappings.md. This receipt records a bounded implementation, not whole-public-API completion.

## Exact JS mappings

| Live type | Lookup and traversal | Mutation and inherited protocols |
| --- | --- | --- |
| TableRows | `[index]`, `at(index)`, existing `get(index)`, length, iteration in row order | Negative/fractional/nonfinite/out-of-range positions throw IndexError (`index-out-of-range`); no slicing; indexed membership replacement, deletion and property definition rejected; returned row height remains editable |
| TableColumns | Same checked positional protocol in column order | Same bounds and membership rules; returned column width remains editable |
| TableCells | Same checked positional protocol in column order | Same bounds and membership rules; returned cells remain live and text remains editable |
| GradientStops | `[index]`, `at(index)`, length, iteration in source order; negative indices count from end | IndexError for invalid bounds; no slicing; membership replacement/deletion/property definition rejected; stop position/color remain editable; includes/count/reversed retained; index(value, start=0, stop=length) searches normalized clamped bounds and raises invalid-value when missing |

Table `get` remains an alias of the implemented `at` function to preserve existing callers without a forwarding wrapper. Iteration does not renumber document IDs. No filesystem, network, native runtime or document-loading capability is added. Original small tests use generated in-memory XML bytes and never write files; memfs is unnecessary for these pure in-memory inputs.

The previous GradientStops.slice implementation contradicted J03's explicit no-slice mapping and was removed. An existing invalid-value bounds expectation now expects the documented index-out-of-range category. The inherited bounded index method has an original test even though the reconciled inherited-member records are not evidence of an upstream unit test.

## Verification

- Failing-first: `npx vitest run packages/pptx/src/public-collections.test.ts` failed 2/2 tests: table collections lacked `at`, and gradient numeric lookup returned undefined.
- Passing: same new tests pass; focused maintained tests for public-collections, tables-model, table-public-surface, drawing-model-preservation, shapes and shape-public-surface pass 64/64 across six files.
- `npm run lint --workspace=pptx` reached TypeScript checks but concurrent enum work reported constructor-call diagnostics in ole-enum.ts. Final maintained package verification is pending parent coordination.

## Remaining surface

No live SlidePlaceholders, Slides, shape collections, adjustment collection, chart-model collections or freeform builder collection is currently declared in packages/pptx/src. Sparse placeholder IDs must retain keyed rather than positional semantics when their live owners are implemented; this receipt does not claim that absent graph. Table inherited part views also remain outside these protocol changes. Supported slice families are absent from this bounded scope and are not approximated with another editor. No publisher decks, binaries or reference tests were copied, committed or deleted.

## Final integration validation

`npm test --workspace=pptx`: 201 files, 5,903 tests passed.
`npm run lint --workspace=pptx`: ESLint, source and test TypeScript passed.
`npm run build:workspaces -- --workspace=pptx`: selected dependency closure passed.
These checks ran on the working tree, including preserved unrelated changes;
they do not claim whole-public-API completion.
