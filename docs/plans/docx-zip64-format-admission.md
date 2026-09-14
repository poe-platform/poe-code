# Bounded DOCX ZIP64 and format admission

Task: `zip64-and-format-admission`, 2026-09-14. This execution record supplements
`docx-typescript-safe-bash.md`, whose unrelated working-tree edits remain intact. At completion, only this
task's status will be updated and staged separately from that rewrite. Later
tasks, including `opc-package-graph`, remain pending.

## Owned changes

- Shared codec: `packages/office-package/src/zip.ts` and `zip.test.ts`.
- Document admission: `packages/docx/src/admission.ts`, `admission.test.ts`,
  `index.ts`, `packages/docx/package.json`, and its package-lock entry.
- Minimal root workspace wiring: `package.json` and its package-lock entry.
- This execution record and only the current task status in the pipeline plan.
  No README edits, downloaded fixtures, native reference
  build, ambient product I/O, product networking, command registration or root
  public exports are part of this task.

## Validated findings and red evidence

The existing shared codec and DOCX raw reader already enabled ZIP64. Original
codec tests already covered stored/deflated entries, signed/unsigned descriptors,
local/central agreement, extras, CRCs, truncations, counts and encryption.
Those tests are retained rather than replaced.

1. `distinguishes ZIP64 resource ceilings from malformed offsets` failed with
   `resource-limit` instead of `invalid-package` for a local offset beyond the
   available bytes. Locator and central offsets are covered by the same case.
2. `admits wide entry metadata without allocating its declared expansion` failed
   at the residual ZIP32 read ceiling. The original tiny deflated payload has a
   declared 2^32-byte size in both headers; admission retains only its actual
   compressed bytes. This is metadata admission evidence, not a claim that the
   deliberately inconsistent payload expands to that size. ZIP32 writing rejects
   it with a resource error.
3. `reports an extended nonzero disk number as unsupported structure` failed
   because a ZIP64 disk-start field was classified as a resource ceiling.
4. The first 18 document-admission cases failed because `readDocumentArchive`
   was absent. Subsequent failing regressions established stable cancellation,
   distinct XML/package errors and preservation of an inert custom content type
   whose spelling merely contains a macro marker. A subsequent original case
   reproduced rejection of a valid percent-encoded main part name and now passes.
5. The full shared test phase produced 30,407 passes and one failure: the existing
   workspace dependency completeness test found docx absent from root
   devDependencies. Minimal root/lock wiring fixes it; the exact existing test
   then passed. No product logic was added at root.

All fixtures are original in-memory bytes. Existing mutation tests continue to
use memfs. No downloaded asset or external test identity is in product tests.
An offline npm metadata refresh failed with ENOTCACHED; the already-installed
saxes 6.0.0 dependency was moved from devDependencies to dependencies by parsing
and updating the package manifest and its existing lock entry, without a new
version or download.

## Implementation and limits

Checked 64-bit values stay BigInt until validated against safe integer and
configured ceilings. Structural offsets/spans are checked against the actual
archive, not a host ceiling. Multi-disk fields reject as structure. The ZIP64
read profile no longer inherits ZIP32 entry-size limits. Writer preparation and
serialization still enforce ZIP32 sizes/counts before output allocation.

`readDocumentArchive(input: Uint8Array, context: ArchiveContext)` is always async
and returns `Promise<AdmittedDocumentArchive>` with owned archive members,
`kind: "docx" | "dotx"`, `dialect: "strict" | "transitional"`, and the original
`mainPart` name. Raw `readArchive`/`writeArchive` retain their existing names and
contracts. Admission uses the same shared codec, not a second ZIP implementation.

Admission examines compound-container magic and parsed OPC content types/root
relationships/main XML, without a filename argument. Macro document/template
and VBA content types reject. It checks part-name collisions, content-type
coverage, duplicate declarations, required parts, root relationship IDs,
internal root targets and the main document root/dialect. External targets stay
data and are never fetched. XML uses a namespace-aware parser, fatal decoding,
DTD rejection and bounded incremental decoding; it retains no XML tree.

The existing explicit archive ceilings apply. Document admission additionally
reserves `4 * inputBytes + 16 * expandedBytes + 1024 * memberCount + 65536`
against maxRetainedBytes before XML parsing and lookup tables. This is
conservative admission accounting, not process RSS isolation. XML traversal is
bounded by admitted bytes. Full XML node/depth options and semantic relationship
graph validation belong to the following tasks; this is not full OPC/schema
conformance or a document editor.

## JS/security mapping and documentation reconciliation

Reviewed `docs/specs/docx.md`, `office-cli.md`, `office-sdk.md`, the API audit,
inventory and existing reconciliation/API map. Historical inventory statements
about unimplemented model APIs remain historical evidence. This task adds archive
infrastructure, not `Document`, package-view/model members or whole-API parity.
The proposed model signatures, neutral snake_case spellings, inherited members,
underscore-prefixed documented public types, enum/collection coverage and the
resolved `comment_id`/`timestamp` documentation corrections remain unchanged.

For this implemented boundary, bytes are Uint8Array, context explicitly supplies
limits and AbortSignal, admission is Promise-based, metadata access after return
is synchronous, offsets use checked BigInt-to-number conversion, and no path,
clock, identity, font or network authority is inferred. Errors retain stable
`usage`, `cancelled`, `limit-exceeded`, `invalid-container`, `invalid-package`,
`invalid-xml` and `unsupported-profile` categories. The shared CLI contract maps
those to 2, 130, 4, 1, 1, 1 and 1 respectively when the later adapter is added.
No shell exit status or CLI support is claimed now. Future CLI/model loading
must call this admission boundary; no alternate grammar or SDK-only document
operation has been introduced.

## Verification and delivery

Focused maintained checks pass: 94 DOCX tests, 46 shared codec tests, both
package lint/type routes, and `npm run build:workspaces -- --workspace=docx`.
A built `docx` package import smoke check verifies the new exported function and
public error classes. Repository-wide `npm run lint` passes, including types and
workflow checks. No visual CLI surface changed; screenshot validation does not
apply to this task.

The full default test run after the wiring fix passed the shared phase (30,408
passes, two skips). Its safe-bash phase reported 38,052 passes, 823 skips and one
failure: the packed-export verifier deliberately requires the selected commit's
root manifest and lock bytes to equal the checkout. Uncommitted intended lock
changes cannot pass that binding against old HEAD. The original failing record
is retained at `/tmp/docx-zip64-tests-verified.log`; no assertion was weakened.

A leaf investigation reproduced the exact pre-build lock assertion. To qualify
current intended bytes before normal commits, an isolated temporary Git index
captured HEAD plus only the owned files listed above (excluding the pipeline
status update, which remains pending). Review-only commit object
`de4d0e74786bdaf0082327f11e87e69a69f3458e`, tree
`5819598823aa385c88dfb9dfc1e51126a00822e7`, has no branch/ref and did not change
main or the normal index. This is QA evidence, not main delivery or an old
revision substituted for current code. The unchanged verifier passed that exact
candidate: zero HTTP requests, no type source fallback, expected negative
consumer diagnostics 2322/2345/2741. Report:
`/tmp/docx-zip64-packed-candidate.json`.

Final precommit verification passed (exit 0) through the maintained `npm test` with
`S3_HTTP_EXPORTS_REVISION` set to that candidate and
`SAFE_BASH_TEST_CONCURRENCY=2`. The orchestrator scopes those inputs to the actual
virtual-bash unit task. Its maintained scheduler derives all membership and
serial/parallel phases from its authenticated declarations and review, without
omitting cases. Skipped/unavailable cases do not count as passes. The report is
`/tmp/docx-zip64-final-gate.log`.

The full gate passed all declared workspace unit phases and the native posttest
lint-stress check. Safe-bash reported 38,053 passes and 823 skips; SafeJS reported
28,932 passes and 47 skips. The shared phase reported 30,408 passes and two
skips. The orchestrator completed all 44 declared workspace test tasks, with
no exclusions; workspaces without declared tests were not counted as passes.

Delivery uses separate normal hook-running codec and admission commits on main,
staging only owned paths/status edits. The committed export verifier will also
be checked at final HEAD. No push or release is authorized.
