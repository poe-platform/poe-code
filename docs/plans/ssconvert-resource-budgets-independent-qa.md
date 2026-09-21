# Independent resource-budget stress review

A different agent reviewed the implemented resource limits on 2026-09-21. Scope: ssconvert engine, command adapter, resource-I/O wrapper, Gnumeric gzip/XML and XLSX/ODF ZIP admission. Root retains safe-bash integration, exports and Git ownership. No native utility, LLM, host-file fixture or repository README was used or changed by this review.

## Concrete regressions and repairs

Original small in-memory cases in `packages/ssconvert/src/resource-budgets-stress.test.ts` established these failures before repairs:

- Delayed typed VFS read errors escaped as raw host exceptions; after awaited cleanup they now share buffered read diagnostics, while opaque errors preserve object identity and cancellation retains priority. Raw terminal parser diagnostics now share command-output byte admission.
- Resource-I/O `next()` failures now automatically retire the owned iterator; existing cancellation coverage reproduced a missing producer-finally effect before repair.
- Iterator cleanup rethrowing the exact original source failure was falsely reported as a new cleanup failure; identity is preserved now. Distinct source and cleanup failures remain visible in aggregate errors with assertions on both original objects.
- Synchronous registered-cleanup reentrancy invoked one owned callback three times; ResourceIO iterator reentrancy also returned a different completion promise. Cleanup callbacks now run after shared promise assignment, admission closes synchronously, and registered cleanup memoizes its public completion barrier. Concrete failing regressions now assert one callback invocation and shared promise identity.
- Registered invocation cleanup waited for execution before starting owned cleanup; a cooperative codec blocked on its own cleanup could not settle. Cleanup now starts first, closes acquisition admission and awaits both cleanup and already admitted execution.
- Aborting a pending cooperative producer `next()` did not call its iterator `return()`. Iterator cleanup is now enrolled before iterator acquisition, invoked on abort and awaited from the read's `finally` block.
- Codec work blocked on its cleanup remained pending after cancellation. The invocation signal now starts the shared cooperative cleanup immediately.
- `createResourceIO.read` wrapped producers in an async generator, whose queued `return()` could not reach a pending cooperative producer. It now delegates `return()` directly with shared idempotent completion. The separate borrowed descriptor cursor retains its prior ownership semantics.
- Excessive empty arguments bypassed byte counting, and listing padding was allocated before refusal. Argument count is now bounded by `argumentBytes`; listings preflight descriptor widths, text and total output before concatenation/padding.
- Help reached its sink despite a deliberately tiny command-output limit. SDK `commandOutputBytes` now bounds help/listing output before encoding/writing; its default is 1 MiB and is separate from workbook output. Argument admission defaults to 1 MiB independently of conversion input limits, preserving existing tiny-input cases.
- Forbidden XML DTD/entity declarations were reported as native-looking format errors. Gnumeric, XLSX and ODF now report explicit `capability-denied` host policy diagnostics.
- A gzip trailer declaring inflated size above budget still acquired its decompressor. Oversized ISIZE declarations are now refused before acquisition. Runtime chunk admission remains necessary for forged trailers, modulo sizes and concatenated members.

## Verified coverage

The independent suite contains 21 passing cases: cleanup-before-execution settlement, pending-source abort, mutable producer chunk reuse, terminal-output refusal, DTD/entity capability diagnostic, gzip declared-size pre-admission, corrupt-deflate ratio precedence for both XLSX and ODF, codec abort cleanup, resource-wrapper pending-return forwarding, delayed cooperative source-cleanup settlement, empty-argument count admission, exact BIFF record count, SpreadsheetML declaration-looking comment/predefined-entity acceptance, listing padding preallocation admission, original source-failure identity when cleanup repeats it, preservation of distinct source/cleanup failures, delayed typed VFS read diagnostics after cleanup, raw terminal diagnostic admission, synchronous registered-cleanup reentrancy, and iterator-return shared completion under synchronous reentrancy.

Corrupt-deflate ratio cases confirm that ZIP ratio admission happens before payload decoding, rather than masking a corrupt payload after inflation. No ZIP runtime repair was necessary for those two cases.

Uncached focused execution:

`npx vitest run packages/ssconvert/src/resource-budgets-stress.test.ts packages/ssconvert/src/resource-budgets.test.ts packages/ssconvert/src/cli/inherited-stress.test.ts packages/ssconvert/src/codecs/text-export.test.ts packages/ssconvert/src/codecs/biff-budget-admission.test.ts packages/ssconvert/src/stress.test.ts packages/ssconvert/src/io/independent.test.ts packages/ssconvert/src/codecs/gnumeric-independent.test.ts packages/ssconvert/src/codecs/gnumeric-followup-independent.test.ts`

Result: 9 files, 125 tests passed. This includes the existing 6 initial budget tests, 5 inherited CLI tests and 24 text-export tests, 2 BIFF admission tests, 15 existing stress tests, 8 resource-I/O independent tests, 29 Gnumeric independent tests and 15 Gnumeric follow-up independent tests; these denominators are separate from the 21 independent stress cases.

`npx eslint packages/ssconvert/src/{cli,engine,contracts,resource-budgets-stress.test}.ts packages/ssconvert/src/io/index.ts packages/ssconvert/src/codecs/{gnumeric,xlsx,odf}.ts`

Result: passed. `npx tsc --noEmit -p packages/ssconvert/tsconfig.test.json` passed. Root performs maintained workspace build/test/lint and safe-bash integration checks; their outcomes are recorded separately.

## Remaining limits and unmeasured cases

These passes do not establish native Gnumeric parity or comprehensive resource accounting. This reviewer did not execute the Gnumeric 1.12.61 QA oracle. No assertion is made for a native dependency/plugin/locale profile by this review.

- Opaque/uncooperative pending producers and borrowed descriptor reads cannot be forcibly cancelled. Cleanup cannot undo completed writes.
- The gzip trailer is not an authenticated total. Stream decompressor internals may allocate an emitted chunk before consumer admission; emitted bytes are refused before retained copies/concatenation. This is not a measured RSS or allocator bound.
- The XML policy diagnostic is currently translated from the shared parser's exact DTD/entity-denial SyntaxError text. The shared parser was not modified.
- The independent DTD diagnostic test directly exercises Gnumeric; XLSX/ODF translation paths were changed consistently but a DTD document in each package was not independently tested here.
- Binary offset/chains/records, sparse metadata/styles/names/objects, formula/range budgets, solver numerical iterations, raster/font budgets and all export-format-specific preallocation are outside this independent stress cohort. Their unsupported/unmeasured cases are not passes.
- CLI refusal diagnostics remain deliverable when normal command output is denied, so the small explicit host-refusal diagnostic is outside `commandOutputBytes`. Listing descriptors, header/padding and total output are now admitted before line concatenation or padding allocation; descriptor strings are supplied by the trusted SDK host.
- Invocation and resource-wrapper synchronous cleanup reentrancy now have passing regression coverage. Gnumeric gzip stream cleanup reentrancy was not separately mocked or measured.
- Cross-workspace public Shell cleanup, namespace effects and release status are root-owned checks. No push or publication occurred.

## Integration follow-up diagnosis

A root-requested `node --import tsx --test packages/safe-bash/tests/commands/ssconvert-encoding.test.ts` run initially passed 1/5 and failed 4/5. Nested error inspection with a temporary driver in `out` identified `DeviceFileSystem.readStream` rejecting `ENOTSUP` because it exposes a stream method above a buffered-only fixture. Its scoped return repeated that same source error, which also motivated the two independent source/cleanup identity cases above. The temporary driver was removed. Root owns the effective-provider stream selection repair and integration reruns; the initial failures are not recorded as passes here.

The existing cleanup-order test was strengthened to require early cleanup start while explicitly asserting public closure stays pending until admitted execution drains, ownership admission is closed and output remains absent. Existing Gnumeric entity-policy assertions now require the exact host refusal code/message; the corrupt-gzip assertions remain unchanged. These changes implement the user-requested host divergence rather than relaxing assertions.

## Numerical follow-up (read-only)

Root reported a full-suite timeout for `=R.QTUKEY(-1000,3,10,1,TRUE,TRUE)` during concurrent build/typecheck work. A targeted rerun of the existing `statistics-independent-review.test.ts` with `-t 'R.QTUKEY'` passed 3 selected cases; 49 skipped cases are not passes. The logarithmic case took 4012 ms under the observed machine load, compared with an earlier root-reported focused approximately 1.8 seconds. This timing does not establish an isolated throughput baseline.

Inspection confirmed the source inverter has a 100-iteration outer cap, Tukey integration caps its two interval loops at 20 and 150, and quadrature uses 16 nodes per interval. The adaptive range-probability loop checks `host.tick()` every iteration and node; evaluator ticks enforce the supplied signal and SDK `workbookWork` budget. Existing warmed-quadrature-node tests check retained work/cancellation guards even when cached nodes are reused. No numeric runtime source was changed: the targeted rerun did not independently reproduce a timeout, wrong numeric result or unbounded iteration-budget escape. Full-suite fresh verification remains root-owned.
