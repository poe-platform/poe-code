# Resource budgets and owned cleanup QA

Task: resource-budgets-and-cleanup. Implementation is TypeScript ESM in packages/ssconvert, exposed as the explicit ssconvert virtual command in safe-bash. The command uses runCommand and the SDK engine; no native product process or fallback was added. README files, parent environment, unrelated edits, Git delivery and publication remain untouched.

## Reference identity

On 2026-09-21, SHA-256 verification of the already acquired primary archive at out/ssconvert-lifecycle/gnumeric-1.12.61.tar.xz produced 2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12. Primary source remains under out. The existing captured reference dependency/plugin/locale profile is docs/ssconvert/calculation-current-native-profile.json (Gnumeric 1.12.61, Linux aarch64, C/UTC, dependency versions, plugin file hashes and binary identity). This task does not recapture or execute a native oracle. Host budget refusals and capability denial are intentional divergences, not native format errors. These checks do not establish complete native parity.

## TDD and independent review

Original in-memory regressions demonstrated unbounded configured argument, inflated/compressed gzip, XML depth and split-output admission before implementation. Additional regressions demonstrated BIFF payload-view allocation before record admission and SpreadsheetML depth/entity diagnostic gaps. Fixtures use original bytes and memfs or the in-memory VFS; no unit test spawns a native utility, writes a host fixture or queries an LLM.

A different agent independently reproduced and repaired cooperative cleanup deadlocks, cancellation through pending reads, resource-wrapper return forwarding, gzip declared-size admission, terminal/listing output admission and empty-argument amplification. Its evidence and remaining unmeasured cases are in ssconvert-resource-budgets-independent-qa.md.

## Limits and ownership

SDK RuntimeLimits adds argumentBytes, commandOutputBytes, compressedBytes, inflatedBytes, zipEntries, zipRatio, xmlDepth and splitOutputs. Argument and command-output defaults are 1 MiB, independent of workbook byte limits. No user CLI switches were added. Existing inputBytes/outputBytes, cells/sheets/operations and workbookNodes/workbookTextBytes/workbookWork remain responsible for workbook storage and computation. ZIP/gzip bounds retain existing input-byte ceilings when their separate limits are omitted. ZIP ratio defaults to 1000. XML depth defaults to 128. Split sheet output defaults to the sheet bound; graph outputs default to operations.

Safe-bash admits argument count and raw owned-value byte lengths before copying argv bytes. It consumes supplied readStream/writeStream with signals when available and keeps the maintained buffered fallback for hosts without streaming methods. The actual filesystem contract names are readStream/writeStream; readBytes/writeBytes helpers are stream utilities rather than FileSystem methods. Memfs mock hosts whose buffered methods target memfs now explicitly omit inherited streams targeting their empty MemoryFileSystem backing store. All existing result/diagnostic/namespace assertions remain intact.

Retained producer chunks are copied before producer advancement/finalization. Writes are awaited and keep borrowed-byte lifetimes through settlement. Invocation cleanup is registered before work, closes admission and starts cooperative retirement before waiting for admitted execution. Engine/resource wrapper iterator return is idempotent and directly delegated, and cooperative cleanup is awaited. Publication continues using exclusive VFS temporary creation and the existing namespace protocol; no host temporary paths or ambient resources were added.

## Verification procedure and coverage

Run the selected maintained build closure without cache:

- npm run build:workspaces -- --workspace=@poe-code/ssconvert --no-cache
- npm run build:workspaces -- --workspace=@poe-platform/safe-bash --no-cache
- npm run test --workspace=@poe-code/ssconvert
- npm run lint --workspace=@poe-code/ssconvert
- node --import tsx --test 'packages/safe-bash/tests/commands/ssconvert*.test.ts'
- npx eslint packages/safe-bash/src/commands/ssconvert/index.ts packages/safe-bash/tests/commands/ssconvert*.test.ts

Vitest and direct Node tests above execute fresh; neither route uses the machine task cache. The safe-bash full test runner has no maintained command-family filter; the direct Node route selects the complete ssconvert family. Build closure membership comes from maintained workspace declarations. Test files for existing binary offsets/chains/records, sparse workbook ownership/styles/names/objects, formula depth/evaluation/ranges, numerical solvers and raster/font admission are included in the complete ssconvert unit task. Their passing assertions cover their particular cases, not all inputs or allocation paths.

The new actual Shell cases verify streaming-only content reads/writes with reused chunks, preserved parent environment, input refusal before importer/publication with producer return, exact root-cancellation reason identity after cooperative cleanup settlement, and refusal before argv-copy allocation. The SDK stress cases verify early budget refusal, pending producer reads, delayed cleanup settlement, codec cleanup, ZIP ratio precedence, XML policy and terminal/listing allocation admission. Existing listing-review, graph-publication and authority-cleanup cases also exercise cancellation after the listing header, output acquisition before rendering, authorization before requests, early consumer stop, and opaque early sink failures. Existing lifecycle/solver tests cover cancellation identity during formatting and goal seeking. These assertions are specific lifecycle cases, not an exhaustive phase cross-product.

Adhoc visual QA uses the shared screenshot renderer on a built Shell invocation that refuses --help under argumentBytes:5. Inspect the screenshot for the exact single-line host refusal diagnostic and normal spacing. The screenshot was generated and inspected: it showed the exact single-line ssconvert argument bytes limit exceeded diagnostic with normal spacing and no stack trace or extra output. Generated evidence and temporary logs live in out and are purged after inspection.

## Remaining mismatches and unmeasured cases

This is not an RSS or JavaScript allocator bound. Gzip ISIZE is an unauthenticated modulo trailer and emitted stream chunks may be allocated inside the decompressor before consumer byte admission. Forged/concatenated gzip trailers require runtime admission; arbitrary internal decompressor allocation is unmeasured. Opaque host work and borrowed descriptor resources cannot be forcibly retired, and completed writes cannot be rolled back by cancellation. A provider source factory acquiring resources before iterator acquisition must honor the supplied signal and its provider ownership contract.

Complete abort-at-every-phase cross-products for every registered importer/exporter, malicious font internals, every numerical function's internal loop, all legacy binary formats, replay/realm combinations and format-specific preallocation are unmeasured by this cohort. Existing bounded guards and unit cases do not count unmeasured cases as passes. Refusal diagnostics themselves remain deliverable outside denied normal command-output bytes. The broader root suite and repository-wide lint are not asserted by this focused task. No new native differential run, remote-main verification, release or publication occurred.

## Recorded outcomes

The uncached maintained safe-bash workspace closure passed (18 build stages reported by the declaration-driven runner, including dependencies and native postbuild scripts). After the final ssconvert cleanup repair, its selected uncached closure passed again (4 stages). The full ssconvert lint route passed, including source, test and public-consumer TypeScript checks. ESLint for the integration source and complete ssconvert command-test family passed. The complete safe-bash ssconvert family passed 117/117 cases with no skips or cancellations. Independent final focused verification passed 9 files/125 tests, including 21 independent stress cases; these counts overlap the package suite and must not be added together.

Interim package runs exposed budget-default and cleanup/entity diagnostic repairs described above. One interim full run under concurrent build/typecheck work timed out at the existing 5-second default for the pathological logarithmic Tukey quantile. Its existing targeted cases passed on inspection without any timeout increase, assertion removal or numerical source change. Another in-progress package run combined the newly added reentrant-promise assertion with an engine module loaded before its repair; final verification therefore starts a fresh process after source stabilization. These interim failures are not passes.

Final fresh complete ssconvert package outcome: all 311 files and 6235 tests passed, with no skipped cases, in 51.68 seconds. The pathological Tukey case passed under the unchanged default timeout. The result was captured after source stabilization on main in the authorized dirty worktree; this is local verification, not committed/archive or remote verification.

Visual QA passed after screenshot inspection. Temporary output/evidence is purged after result recording. Local commits: none; the existing package and integration work was already untracked/user-edited at task start, and no user work was staged. Remote-main delivery and successful release: neither attempted; push/publication were explicitly prohibited.
