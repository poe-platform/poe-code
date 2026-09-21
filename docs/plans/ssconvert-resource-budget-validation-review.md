# Independent resource budget and cleanup review

Review scope: current TypeScript ESM SDK engine and shared command engine after
the implementing agent's command-output configuration validation repair. No
native process, LLM, host fixture writes, README edits, Git changes or publication
were performed. All fixtures are original small in-memory byte sources; they
require no filesystem writes and therefore no memfs adapter.

## Manual procedure

1. Read root and safe-bash AGENTS.md, inspect current engine/CLI contracts and
   existing cleanup regressions. Preserve unrelated edits.
2. Submit five empty producer chunks under an explicit four-unit workbookWork
   allowance; require a host resource-limit refusal, no importer dispatch and
   exactly one producer return/finally settlement.
3. Reproduce the case before repair. Repair admission before retained chunk
   allocation, omit empty chunks from retained storage, and count yielded chunks
   independently of input byte count. Keep EOF outside the yielded-chunk budget.
4. Check negative controls: immediate EOF, one empty yielded chunk, exact two
   one-byte chunks, zero budget EOF versus zero budget empty yield. Hold the
   producer's return promise and verify public rejection cannot settle early.
5. Capture command help bytes with an injected sink, then rerun at that exact
   output budget and one byte below it. Require identical bytes/status at the
   boundary and no stdout publication below it, with the explicit host diagnostic.
6. Inject a stream sink refusal after codec-owned cleanup registration. Require
   exact failure identity and await cleanup exactly once before rejection.
7. Run the focused review and existing resource suites plus focused source lint.
   Root separately owns fresh workspace gates and safe-bash integration review.

## Executed results

The pre-repair empty-producer test resolved successfully instead of refusing,
concretely demonstrating unlimited chunk bookkeeping/computation despite a
bounded byte count. The repair limits yielded chunks to explicit workbookWork,
or max(1, remaining inputBytes) when unspecified. It emits
`ssconvert input chunks limit exceeded` as a resource-limit refusal. This is an
explicit host divergence and never a native format validity claim.

`npx vitest run packages/ssconvert/src/resource-budget-validation-review.test.ts packages/ssconvert/src/resource-budgets.test.ts packages/ssconvert/src/resource-budgets-stress.test.ts`
passed all 40 tests in three files on September 21, 2026. Eight tests are the new
independent review cases. This run also covers the existing reused producer,
cooperative abort/read cleanup, gzip declared-size, ZIP ratio, XML host denial,
command output and other resource regressions. The deterministic case seed is
the explicit five-empty-chunk producer; no generated random findings occurred.

`npx eslint packages/ssconvert/src/resource-budget-validation-review.test.ts packages/ssconvert/src/engine.ts packages/ssconvert/src/contracts.ts`
passed without findings. Initial fixture mistakes (Codec.write argument order,
Vitest array case unpacking) failed during review and were corrected; the final
40-test run covers those corrected fixtures. No timeouts or incomplete focused
runs remain.

## Limits of this review

This is deterministic SDK/command semantic verification, not bounded wall-time,
RSS, native oracle or deployed-provider qualification. Exact remote/native
Gnumeric profile compatibility, realm/host authority isolation, original/
checkpoint/replay runtime cells, every parser/format limit, numerical/raster/font
limits and all provider abort phases were not independently qualified here.
There are no skips within the final focused test run; those matrix cells remain
unmeasured rather than passes. No visible CLI presentation changes were made;
CLI screenshot execution remains with the root integration owner. Fresh full
workspace build/test/lint and safe-bash namespace/authority checks are separate
root-owned gates, not established by this focused run.
