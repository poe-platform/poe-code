# Independent public SDK stress procedure and results

Independent agent review for `portable-sdk-and-pandoc-contract`, 2026-09-21.
Root owns exports, integration, Git and final delivery. This review changes only
the independent test file and this procedure. No README, Pandoc gate or runtime
source changes; no native utility execution and no disk writes in unit tests.

## Procedure

1. Import operations exclusively through `packages/ssconvert/src/index.ts` in
   `src/public-sdk-independent.test.ts`; exercise both public XLSX editions with
   an original two-cell in-memory workbook.
2. Check probe recognition and malformed-package rejection. Independently force
   reader cells, sheets, XML nodes, XML text and work limits; force writer cells,
   sheets, output bytes and work limits. Require `resource-limit`, never a pass
   obtained by ignoring a failure.
3. Mutate a reopened consumer workbook through an explicit mutable test view.
   Confirm the original caller workbook and a subsequent read remain unchanged.
4. Abort with falsey reason `0` inside an awaited unsupported-record diagnostic.
   Require rejection with the exact reason and one `xlsx-write-loss` diagnostic.
5. Use an injected memfs filesystem and original codec to compare public SDK
   conversion and command conversion. Verify statuses, repeated exporter-key
   order, last scalar `-O` selection, exact bytes, absence of stdout/stderr and
   exact namespace contents. Dispose the engine in `finally`.

## Verified results

- `npx vitest run packages/ssconvert/src/public-sdk-independent.test.ts`:
  four tests passed, uncached direct execution, 2.45 seconds total.
- `npx eslint packages/ssconvert/src/public-sdk-independent.test.ts`: passed.
- `npx tsc -p packages/ssconvert/tsconfig.test.json --noEmit`: passed.

An initial assertion assumed repeated CLI `-O` accumulated strings. It failed:
the command passed only the last string while SDK accepted its supplied array.
Primary source `out/ssconvert-lifecycle/gnumeric-1.12.61/src/ssconvert.c:151`
declares `G_OPTION_ARG_STRING`. The revised case explicitly tests that scalar
mapping, including repeated keys inside the retained string. This is a validated
test premise correction, not a runtime fix or weakened native contract.

## Limits and remaining coverage

These tests verify the new public codec surface and one concrete shared
CLI-to-SDK operation. They do not independently establish all analysis, solver,
clipboard, graph, plugin, encoding or locale behavior. The full feature mapping
and compiled published-consumer validation remain integration-owner evidence.
No browser bundle was executed here. Host isolation follows injected in-memory
I/O in the measured cases; this does not prove arbitrary host capability safety.
No reference-native differential was run in this independent pass. Pandoc's
separately blocked gate remains unchanged and unmeasured. No validated runtime
defect was found in the measured public codecs and engine paths.
