# ExifTool resource and failure boundary QA

Execute against the current candidate; historical receipts are not current passes.
Native controls remain opt-in in the compatibility QA. Use memory VFS for all
product fixtures. Temporary captures belong in task-owned `out` and are purged.

1. Run the command workspace unit, lint and selected build routes. Independently
   exercise oversized buffered VFS results, producer-reused chunks, invalid UTF-8,
   quotas, cancellation checkpoints and cooperative output cleanup. Confirm
   escaped cleanup failures and no staging residue after publication refusal.
2. Replace a source between read and conditional publication; retain the concurrent
   replacement. Test exclusive output against normalized same-file, hardlink and
   symlink destinations. Compare source bytes and directory entries after refusal.
3. Execute actual Shell stdin pipelines, output/input redirects and a VFS `.sh`
   script. Compare typed SDK and CLI JSONQ, ordinary lexical JSON and write results.
   Dispose twice. Streamed text can precede a later failure; buffered JSON/CSV do
   not establish sink atomicity. Multi-file writes and backups are not transactional.
4. Build the selected safe-bash closure, generate and pack its public artifact,
   and execute an isolated consumer with only declared public dependencies.
   Deny imports outside the consumer, host I/O, executable and network capabilities.
   Inspect JS/declaration references for private workspace dependencies. Check
   strict NodeNext declaration resolution without skipLibCheck.
5. Run an in-memory command bundle in a separate realm with process, require,
   fetch, WebSocket and dynamic code generation denied. Use a realm-local branded
   carrier and a foreign carrier negative control. Record this bounded execution
   control separately from browser/workerd certification or a general sandbox claim.
6. Capture and inspect the visible command output through the maintained screenshot
   route. Record all passes, failures, setup corrections and unavailable cells
   separately. PDF, Office, compressed metadata, full catalogs and execute/stay-open
   remain unsupported; original/checkpoint/replay and unavailable runtime matrix
   cells cannot be inferred from successful memory tests.

No push, release or private-package publication is authorized by this QA plan.

## Executed candidate qualification

Executed 2026-09-18 on base HEAD
`052940a62255aa620236474575b4003a2df76549`, with existing working-tree changes
preserved. Production command/config SHA256:
`beaa1a33479b9a9768d578270f9bc2034889c4cfc640a2b38d63b3ff0b362527`.
Reproduce by sorting `package.json` and `src/*.ts` excluding tests/fixtures,
then SHA256 each relative filename + NUL + bytes + NUL (14 files). This identifies
the command candidate, not a clean Git revision or the entire integration graph.

Validated finding: buffered image/argument-file VFS reads trusted `maxBytes`
without checking returned extent. A memory-adapter negative control returned one
extra byte; the image reached PNG parsing instead of size refusal. Both fallback
paths now check cancellation and actual extent immediately after the awaited read,
before parser/decoder admission. The adapter still owns its internal allocations
and must honor the supplied maximum; this check cannot undo an adapter allocation.

Fresh passes:

- Command workspace unit route: 99 tests, zero skips/failures; maintained lint
  includes source and test typechecks. Selected command build closure: 3 tasks.
- Selected safe-bash build closure: 12 tasks, including native npm postbuild.
  The existing actual Shell pipeline/stdin/script integration test passes.
- Added controls cover buffered overrun, concurrent source replacement, exclusive
  same-file/hardlink/symlink output refusal, rebound directory symlink, partial text
  versus un-emitted buffered JSON on quota failure, and escaped cleanup failure.
  Both directories retain their files and no owned stages survive refusal.
- Interior parser resource-checkpoint cancellation is deterministic with a real
  controller and an observed signal proxy. This proves polling, not timer-based
  preemption of synchronous JS. Memory producer reuse, hostile PNG/UTF-8, CSV
  retention and output cancellation controls also pass in the workspace suite.
- Separate-realm browser-platform bundle: 65 first-party input modules, no
  node_modules input, no process/require/Buffer/fetch/WebSocket access; string and
  WASM code generation disabled. Realm-local carrier succeeds, independently
  branded foreign carrier fails. No browser/workerd certification is inferred.
- Generated artifacts were freshly packed with scripts disabled, extracted into
  an isolated consumer and supplied only the declared public dependency closure.
  An ESM loader refused imports outside the consumer. Error constructor identity,
  stdin pipelines, both redirect directions, VFS `.sh`, typed SDK/CLI JSONQ bytes,
  lexical `1e999`, byte-identical backup and repeated cleanup/disposal pass.
  Host fs methods, child-process methods and fetch were denied during execution;
  this execution control is separate from import-time or general isolation claims.
- Actual Shell cancellation and disposal each finalize a cooperatively blocked
  VFS producer. Strict NodeNext consumer declarations compile without skipLibCheck.
  AST inspection of 3,494 JS/declaration references finds no private bare imports.
- Maintained generic screenshot capture was inspected: aligned Title, lexical
  JSON, write status and explicit native-expression refusal are legible.

Failures and corrections: the initial regression failed as expected before the
fix. The partial-output test initially expected only the command budget message;
JSON SourceFile correctly failed its scalar output bound first, so the assertion
now admits both independently bounded failure paths. The first realm fixture had
an invalid supplied IDAT CRC; the parser refused it. Repairing that checksum with
independent Node zlib CRC32 produced the successful control, without changing the
parser. Consumer setup initially tried resolving the type-only @types/node runtime
entry; package metadata resolution supplied it and its declared undici-types
dependency. No product failure or timeout remains in the completed focused gates.

Not executed: broad root `npm test`, repository-wide lint/build, upstream native
format matrix, native identity/publication/PDF QA, original/checkpoint/replay,
browser/workerd runtime cells and performance measurements. Shared integration
files were inspected and built but not changed by this task; focused gates are
not reported as broad-gate completion.

Unsupported/incomplete: PDF parsing/incremental restore, EXIF/JPEG/TIFF/XMP/Office
readers, compressed PNG metadata, import, scan/catalog scope and execute/stay-open
remain explicitly unsupported. Resource failure diagnostic parity between direct
SDK throws and Shell mapping remains open. No full ExifTool compatibility or
universal resource-isolation gate is closed. No local commit, push, remote-main
delivery, release or publication was performed. Task-owned generated artifacts,
tarballs, consumer fixtures and screenshot are purged after inspection.
