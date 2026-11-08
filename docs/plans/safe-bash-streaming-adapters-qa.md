# Safe Bash streaming adapter qualification

## Scope and backend contract

Sequential command inputs use the injected safe-fs stream or a retained reader's
bounded `read(position, maximum)` operations. No whole-file read is substituted
when streams are unavailable. A backend implementing only `readFile` is explicitly
unsupported for this path; configure streaming or retained-range reads instead.
The 64 KiB default window is independent of transfer-byte limits. Smaller command
working-memory budgets can select smaller requests. Backends must honor requested
read windows and backpressure; advertising a capability does not implement it.
Native stream chunks remain borrowed until the consumer advances. Retained handles
and source iterators close on completion, early exit, cancellation and failure.

Copy requires retained source identity and streaming writes, or exclusive retained descriptors with bounded writes. Cross-device replacement uses an
injected retained staging writer, seals its stat, rechecks source identity/version
and destination ancestry, then publishes atomically. Failed staging is cleaned
through the retained cleanup receipt. No private filesystem or host temporary
file is introduced. Configure an external payload store for large Worker files;
Memory and the S3 mock inherently store file contents in RAM. See the safe-fs
README for qualified overlay upper and external backend requirements.

## Coverage review

Revalidated against source baseline `a7625be369`, following extracted owners rather
than treating imports of shared helpers as independent reads.

| Audited path/family | Current execution owner and disposition |
| --- | --- |
| generic `commands/internal.ts` | `safe-bash-io-engine/internal`: native stream fast paths preserved; whole-file fallback replaced with retained ranges |
| search | shared search requirements and `safe-bash-command-rg/shared`: sequential payload fallback migrated; compiled patterns and ignore-rule configuration remain parser-owned metadata |
| split/csplit | command `io.ts` adapters migrated; csplit's line/regex algorithm and its own retained-state budgets remain separate |
| cmp | existing retained/stream readers preserved; final whole-file fallback removed; comparison windows do not depend on `maxFallbackBytes` |
| csvcut/csvgrep, fmt/fold | command adapters migrated; existing decoder, record, output, cancellation and CLI/SDK budgets preserved |
| table-text, stream-format, stream-inspection | extracted table/text engines now use stream/range inputs |
| bytes, compression, dd, od | compression uses the shared generic/archive inputs; dd/od file adapters migrated; pure codecs do not acquire a filesystem |
| copy/install/move | retained copy no longer collects; install comparison reads incremental windows; staged move uses retained writer and sealed publication receipt |
| awk getline and shuf | sequential getline fallback migrated; shuf keeps its retained reader and explicit unsupported capability result instead of whole-file fallback |
| archives | generic archive, ZIP source and unzip source adapters migrated; ZIP whole-archive mutation/conditional hardlink publication and archive algorithms remain their owner-specific work |
| HTML, jq, XML, RTF | streaming input fallbacks migrated; document/tree/value retention remains parser/algorithm work, not a claim of bounded document processing |
| network | file upload source migrated; replay/global request bodies, CA/ETag/format configuration remain network-owned operations |
| csvkit | Safe Bash supplies bounded file streams to the injected runtime, including match-file input; explicitly buffered CSV runtime convenience APIs and table algorithms remain separate |
| DOCX | command resource byte sources and packing file streams migrated; document/archive collection APIs remain owner-specific algorithms |
| PDF/PPTX, ssconvert, Pandoc, media/Sips, mmdc, exiftool | cited reads supply whole-document/image/workbook/resource contracts, not fallback implementations of the shared sequential adapters; no algorithm migration or Worker qualification is claimed here |
| safejs/node/python/playwright, op | runtime/module/configuration or injected-engine APIs; shared-import reachability alone does not establish a sequential command payload fallback |
| du file-list, text-program sources, tree metadata, truncate | operation-specific argument/parser/metadata or retained resize paths; not the shared sequential file-input adapter |
| shell script loading, redirection/capture | shell-owned execution and capture contracts; not changed by command-adapter migration |

Tests generate/reuse bounded chunks, forbid whole-payload reads and private spool
writes, await slow sinks, inject errors/cancellation and verify output bytes and
cleanup. Existing package suites include reference byte controls and CLI/SDK
parity. These tests establish adapter behavior, not peak isolate-memory usage.

## Manual workerd and Cloudflare procedure

1. Build the maintained Safe Bash workspace and a Worker consumer using its public
   command exports. Inject the same externally backed safe-fs for every command and
   transitive file operation. Instrument reads, writes, handles and staging; reject
   `readFile` for streaming payloads. Keep metadata distinct from payload traffic.
   Do not replace the backend with Memory, a RAM spool or a payload-wide ByteSource.
2. Generate 1 MiB, 4 MiB, 16 MiB and 64 MiB objects externally with fixed record
   sizes and deterministic hashes. Keep stream windows, record limits and backend
   configuration constant. Use `captureOutput: false` and an awaited throttled sink.
3. Execute representative generic/byte commands, search, CSV, formatting, table,
   split/csplit, comparison, copy/install and cross-device move. Verify bytes and
   exit status against the matching native/reference behavior. Test both native
   streams and retained-range-only input, and selected mount/overlay paths.
4. For each size collect actual workerd isolate memory (including separately
   identified Wasm/native allocations), CPU time, wall time, first-output-byte
   latency, peak outstanding input/output bytes, storage I/O and live handles.
   Repeat warm/cold runs and 1, 4 and 8 concurrent requests. Record runtime version,
   Worker bundle, limits and backend configuration with each result. Node heap
   measurements are not Worker qualification.
5. Abort during acquisition, range read, blocked output, staging write, sealing and
   publication. Inject source/sink/storage failures and rename/hardlink races.
   Verify no duplicate prefix, unchanged destinations before atomic publication,
   preserved primary errors, closed readers and removal of owned staging only.
6. Repeat on deployed Cloudflare infrastructure before making production claims.
   Compare increasing-size curves at fixed concurrency: adapter working memory
   should follow windows and concurrency, not total payload size. Report any
   algorithm-owned retention separately; do not describe this adapter migration
   as qualification of all commands or all transitive engines.

This is an execution plan. No deployed Worker measurements are claimed by the
local deterministic tests.
