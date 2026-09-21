# ssconvert final independent QA

Independent reviewer: delegated agent, 2026-09-21. This is an audit procedure and results, not a parity certification. Root owns integration, builds, exports, Git and delivery. No runtime, README or integration edits were made by this reviewer.

## Procedure

1. Read root requirements and `packages/safe-bash/AGENTS.md`; preserve the existing working tree. Inspect command wiring and unit fixtures without executing native utilities.
2. Search the domain runtime and virtual-command runtime for process spawning, host filesystem imports and ambient environment access, excluding unit test files. Inspect the compiled public SDK and compiled virtual command.
3. Execute a Node ESM inline probe using `packages/ssconvert/dist/index.js`, `packages/safe-bash/dist/shell/index.js`, `packages/safe-bash/dist/fs/memory/index.js`, and `packages/safe-bash/dist/commands/ssconvert/index.js`. Inject locale C, timezone UTC, empty environment, explicit limits and original input bytes `1,2\n3,4\n`. Use an in-memory filesystem and owned output chunks; no product fixture file is written to disk.
4. Assert direct SDK CSV conversion and virtual-command CSV conversion have status 0, no diagnostics/stderr and identical bytes. Convert the same input to Gnumeric XML in the VFS, replay it to CSV, and compare exact bytes. Invoke an invalid option against an existing `/keep` target and verify status, diagnostic and preservation. Pre-abort SDK conversion and verify rejection retains the actual cancellation reason and writes no output.
5. Inspect census and function-register dispositions separately from executed product behavior. Root must run maintained fresh build/unit/consumer/lint gates; this independent probe does not replace them.

## Executed results

The inline compiled probe exited 0. Direct SDK and virtual command returned CSV bytes exactly `1,2\n3,4\n`, both status 0. XML checkpoint/replay returned the same bytes, status 0. Invalid option returned status 1, empty stdout and exact stderr:

```text
Unknown option --no-such-option
Run 'ssconvert --help' to see a full list of available command line options.
```

The existing `/keep` bytes remained `keep`. Pre-cancelled SDK conversion rejected with the identical injected Error object and did not call its output sink. These original fixtures establish only these boundaries. They do not establish deferred cancellation, graph/print fidelity, every format record or numerical accuracy.

The command runtime imports the same `createEngine`, `createResourceIO`, `createVfsOutput` and `runCommand` from `poe-code/ssconvert`; it does not implement an alternate conversion engine. Text inspection found no `child_process`, `execSync`, native `spawn`, or `node:fs` import in these runtime trees, and no ambient `process.env` use (the only match is a comment explicitly rejecting it). This is bounded inspection, not a transitive dependency or hostile host-JavaScript isolation proof. No native oracle was run by this reviewer.

## Coverage and remaining gates

The census correctly declares `productParityEstablished: false` and `semanticAuditComplete: false`. Its counts include 4,811 lexical dispatch cases, 2,130 XML dispatch nodes, 1,685 source diagnostics, 193 source enumerations and 6,203 source function locators. Lexical membership and source locator validation are not executed semantic cases. The census explicitly retains macro-expanded dispatch, setter/writer effects and full legacy specification closure as blockers. Each needs concrete product evidence or a retained open blocker.

Some census descriptions are stale relative to the actual compiled product: the Gnumeric XML format version entries still say `productStatus: unimplemented`, the CLI feature says `source-reviewed-product-unimplemented`, and CLI option descriptors say `declaration-validated-not-product-implemented`. The compiled probe proves bounded XML/CSV/parser operation exists. These historical statuses must not be counted as a current complete implementation matrix; nor may a small probe upgrade all related source records to implemented parity.

The function register has 658 entries with statuses: 127 `implemented-and-independently-reviewed`, 190 `implemented-parity-incomplete`, 118 `implemented-source-tested`, 212 `implemented-with-recorded-parity-limits`, 9 `outside-task`, and 2 `disabled-in-captured-stable-profile`. These are labels, not passed/failed/unmeasured/unsupported semantic-case totals. For example EASTERSUNDAY has two original measured cases and explicitly says helper paths/full domain matrix are not exhaustively measured. A function-name implementation must not become a full numeric-domain pass.

All 14 optional runtime capability rows retain an unmeasured matching activated-profile oracle. PERL_ADDER/PY_BITAND ports and a trusted JS provider contract do not establish Perl/Python loader behavior. EXECSQL/READDBTABLE, ATL_LAST, GOffice extensions, glossary loader behavior and disabled/external language services retain qualification blockers. A mocked capability verifies injection behavior only; it is not real-service qualification.

The safe-bash maintained source fixtures use memfs and compare command/SDK bytes and checkpoint replay. Some analysis tests use an original custom codec to isolate protocol behavior. Those are useful contract tests but are not proof of real format import/export fidelity. The independent compiled probe uses the actual shipped CSV/XML providers without a custom codec.

No full-parity claim is supported. Root must report current gate outcomes and category-specific implemented/failed/unmeasured/unsupported totals with their counting units, evidence bounds and blockers. Any lint/build/consumer failure remains a delivery blocker. No commit, push, remote-main verification or release was performed by this reviewer.

## Fresh compiled consumer and usage follow-up

After root reported the maintained uncached build completed with exit 0, this reviewer ran `node --import tsx packages/ssconvert/tests/public-consumer.mts`: exit 0, no output. The maintained consumer exercises compiled direct/root exports, XLSX codec roundtrip, metadata and the shared engine. It is bounded public-consumer evidence, not full format conformance.

An independent usage check exposed the draft's original `Gnumeric_stf:stf` import ID as absent from `engine.listServices("read")`; the actual installed ID is `Gnumeric_stf:stf_csvtab`. Root corrected the documentation. Both corrected current TypeScript code fences were subsequently extracted and executed as Node ESM stdin, erasing only the `Uint8Array[]` annotation. SDK output was `0 []`; virtual-command output was status 0, exact `a,b\n1,2\n` stdout and empty stderr. A separate asserted compiled-import probe confirmed actual service ID membership, empty SDK diagnostics and identical SDK/virtual bytes. The examples contain literal `\n` escapes in their source text, producing the intended newline bytes.

The execution used workspace package exports `poe-code/ssconvert`, `@poe-platform/safe-bash` and `@poe-platform/safe-bash/commands/ssconvert`, not internal source substitution. Only Node development execution was used; no native utility, native fallback, LLM or disk fixture was invoked. A discarded data-URL runner attempt could not resolve bare package specifiers because data URLs lack a hierarchical package-resolution base; rerunning the same snippets with normal stdin resolution passed. This runner limitation was not a product defect.
