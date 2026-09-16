# pptx bounded ZIP reader

Scope: only the `zip-reader` milestone, under root AGENTS.md and the format,
shared CLI and shared SDK specifications. No whole-pipeline execution, README
edits, native product runtime, fixture downloads, push or release.

## Ownership

Root owns shared workspace metadata, dependency wiring, pptx admission/tests and
this plan/research receipt. The assigned codec leaf owns the shared engine
extraction, ZIP64 extension, safe-bash adapters and associated tests. Existing
unrelated modifications, including the pipeline plan, are preserved.

## Procedure

1. Inspect the existing ZIP/deflate code and recorded audits. Extract one engine
   into `packages/office-package`, retaining the classic shell profile and
   explicitly opting the presentation reader into bounded ZIP64.
2. Write original independent byte cases first. Observe failures for unsupported
   wide records and caller mutation before implementing those changes. Keep
   raw payload/CRC expectations independent of the production writer.
3. Admit input through existing explicit byte capabilities. Fully decode and
   verify every entry before returning any package part. Keep the internal byte
   reader distinct from the still-unimplemented public presentation/OPC model.
4. Cover stored/deflate, descriptors, wide fields, truncated records, CRC and
   size disagreement, duplicates, encryption, multi-disk, expansion ceilings,
   input ownership and malformed part names. Use memfs for capability I/O.
5. Reconcile every applicable physical/package reader case with original tests;
   preserve deferred graph/writer/directory/API/BDD obligations. Inspect corpus
   manifest entries only; any disposable QA uses original immutable inputs and
   records hashes and limitations here. Never commit corpus assets.
6. Run maintained focused tests/types/lint, then the required broader shared
   dependency checks. Review actual exports and shell diagnostics. Commit only
   named owned files on main after checks pass; report local hashes separately.

## Evidence

The bounded byte-reader implementation and required checks are complete.
Delivery is local only; no push or release is performed. Public Presentation, graph views, CLI command
registration and schema/capabilities remain separate milestones, not private APIs
or completed behavior. No reference implementation code/assets are copied;
existing repository engine code retains the project MIT license.

## Implemented boundary and regression findings

The shared extraction is one ZIP/compression engine. The shell adapters inject
existing scheduling and public diagnostics, keep classic ZIP admission and local
DOS date handling, and consume the same factories as the presentation reader.
The new shared dependency is admitted by the shell build guard only with its
exact identity, version, exports and pako-only dependency declaration.

The internal `pptx` reader eagerly validates every member before returning an
immutable byte index. Its names follow the acquired ECMA-376 Part 2 (2021)
6.2.2.2–6.2.2.3 and 7.3.3–7.3.5 boundary: ASCII-insensitive identity, no part that
is another part's ancestor, non-ASCII percent-decoding, no encoded separators or
unreserved ASCII aliases. Unicode scalar admission follows RFC 3987 `ucschar`.
It does not parse XML, content types or relationship graphs. Source/lookup bytes
are owned, and explicit byte ceilings are checked before capability reads.

Observed red-to-green regressions include ZIP64 rejection; a caller-buffer CRC
race; UTC writer drift; duplicate writer admission; supplementary Unicode lookup;
encoded non-IRI characters; native errors for missing byte context; and a UTF-8
BOM filename regression introduced during extraction. The last was caught by
comparison with the existing decoder's `ignoreBOM: true`, then reproduced by an
original byte/name assertion before correction. A memfs test fixture initially
used an unsupported raw Uint8Array JSON value; it now creates the file with
`writeFileSync`, without changing product behavior to accommodate the fixture.

Full-check integration failures identified the exact guarded shared dependency
and missing root test dependencies. Those have passing focused checks. The
packaging assertion now distinguishes bundled private code from external runtime
dependencies and requires the shared declarations and standalone project license
in root package files. It does not add an unpublished runtime registry dependency.

## Case and API accounting

[The scoped receipt](../pptx/zip-reader-evidence.json) retains all 29 serialized
source rows, the six open/save BDD scenarios and 41 counterpart reader rows.
Twelve source byte-reader rows have original passing TypeScript assertions; none
of those source cases is parameterized. Many-to-one equivalence is explicit:
authored bytes replace fixture-specific hashes, and eager admission plus one
capability invocation replaces private mock/lazy-reader topology.

Directory acquisition, OPC graph/content-type behavior, complete presentation
open/save and image access remain visible pending obligations. Counterpart
semantics are not automatically counted as equivalent. All 2,407 public API
identities and 17 additive bounded-view obligations remain intact; no public
model/API coverage is claimed. The internal reader is not an implementation of
the documented mutable PackageView. Historical audit statements describe the
preimplementation baseline; this scoped receipt records the subsequent work.

No substantial source-project code, comments, asset or test wording was copied.
Original repository engine code retains the project MIT license. Existing
research notices and unrelated untracked audit inputs remain untouched.

## Disposable QA observations

Agent-executed read-only QA selected the three smallest downloaded manifest
entries, verified the manifest byte length and SHA-256 before admission, decoded
every entry, and verified the original file hash again afterward. Profile:
64 MiB archive/entry, 256 MiB aggregate expanded bytes, 10,000 entries, 4,096 path
bytes, 128 path segments, 1 MiB extra/comment fields and 65,536-byte chunks.

| Manifest cache file             |     Bytes | Parts | SHA-256                                                            |
| ------------------------------- | --------: | ----: | ------------------------------------------------------------------ |
| CERN-job-opp-250925.pptx        |    43,231 |    29 | `85cc7b338a11b9d1a9dfcaaaa504bf21ab643e4c30004a478152f390ee9f5f1d` |
| WWL-template-1slide.pptx        |   213,136 |    43 | `0c728ea3fd2ab76906247931fcb5c966074d21e804187893d954cc913cc89689` |
| IXPE-Presentation-Template.pptx | 1,202,514 |    38 | `885e923f148cdf4680372abe54496c824ab3a2a2d8a59fd9703d66e0aeb1164c` |

All CRC/size reads passed. No corpus asset was changed, downloaded, removed or
committed. This is not XML/schema/graph/visual fidelity evidence.

The existing shell was exercised through its built public exports with an
in-memory original `Seed library` file: `zip`, `unzip -l`, `unzip -p`. All three
commands returned zero and extraction preserved the exact text. The maintained
screenshot utility produced `/tmp/pptx-zip-cli-supported.png`; visual inspection
confirmed aligned listing columns and readable progress/extracted text. An
initial QA invocation of `unzip -t` was refused by the existing documented
argument grammar; the QA was corrected to supported flags, with the failed
capture preserved at `/tmp/pptx-zip-cli.png`. No `-t` support is claimed or added.

An offline packed shared-package consumer imported and read an independent empty
ZIP. Browser/workerd-conditioned bundles executed in an isolated JavaScript
context with no `process`/`Buffer`, including independent raw-deflate bytes with
expected output 49–57. This checks the portable closure, not a deployed browser
or workerd runtime. Temporary archives, screenshots and installed consumers stay
outside the repository. No QA automation script is shipped.

## Root package runtime closure

The shared workspace remains private. Root packaging derives its exact runtime
routes from the workspace exports and parses JavaScript module specifiers to
point the shell adapters at the shipped sibling codec. A memfs regression checks
imports/re-exports, unchanged ordinary strings and unrelated dependencies; the
root bundle fixture also asserts the final relative import. Focused root bundle,
standalone packaging and metadata checks passed 194 tests.

An actual offline root tarball was extracted outside the repository. Its shell
ZIP adapter imported successfully without an office workspace package link,
read an independently authored empty ZIP and returned the independently known
CRC32 for `123456789`. Only the already installed pinned pako dependency was
made available. An initial QA profile with chunkSize 64 was correctly rejected;
the supported 512-byte profile passed. The tarball and consumer are disposable
QA artifacts, not committed fixtures.

## Authenticated archive integration

The maintained archive verifier previously admitted only two pinned registry
dependencies. The shared workspace now has a distinct captured-source artifact:
its exact manifest, license, root/package TypeScript configuration and four
production source files are read from the same selected Git tree, compiled in a
bounded virtual compiler host and packed without lifecycle execution. Current
writer-isolation checks use the same builder from an explicit source capture.
Ambient shared `dist` is never an input. The existing pinned registry integrity
checks and sealed historical fixtures remain intact.

The artifact binds source hashes, emitted bytes, export entries and tarball hash.
Only its authenticated declarations enter the type-check snapshot; its only
cross-package runtime edge is compression to the pinned pako entry. Original
controls cover missing source, manifest/export/lock drift, forged bindings,
mutated output bytes and dependency shadows. Review found office-local registry
and ancestor shared-package shadow gaps; failing assertions reproduced these
before the lock checks were tightened. Existing synthetic two-dependency
fixtures retain their explicit historical profile.

## Committed-source qualification

The first full test run against ordinary `HEAD` reached 23,485 passing shared
Vitest tests, 499 passing shell runner tests, and 37,637 passing shell cases
(823 skipped). Its 21 failures had two causes: the committed-export verifier
correctly refused the pre-change committed build guard, and 20 cleanup cases
shared a setup that had not yet captured the new workspace sources. The latter
was corrected by reusing the authenticated source builder, staging and checking
its generated declarations, and admitting only the exact compression-to-pako
runtime edge. Original redirect controls preserve rejection of other edges.

For the cleanup harness's version-1 explicit committed expectation, `rootInputs`
is now required when the shared dependency is present. It binds the captured
root package/lock/guard and exact shared source/configuration/license hashes
before compilation. Missing, changed, extra and omitted hashes fail. Historical
expectations without the shared dependency retain their prior contract.

Pre-main archive qualification follows the repository precedent at
`packages/safe-bash/docs/PROJECT_LEDGER.md:2100`: a temporary private Git index
starts from HEAD and adds only explicitly owned paths. `git commit-tree` creates
an unattached, nonempty QA object; neither main nor the real index changes.
The documented `S3_HTTP_EXPORTS_REVISION` selector tests that immutable object,
and the maintained root test runner scopes it to the actual virtual-bash task.
This is a QA snapshot, not a main commit, push or release.

Initial QA revision `7eeb25da6620a92b303501d1c9fc661b39c56ee4` passed the direct
packed-export verifier, including the runtime and strict public type checks.
Final QA revision `1a8b9677e433da9aa387ff115cf517a7445791b3` includes the corrected
cleanup harness and passed the full maintained root test route. Intermediate
object `4e2e8b5f97e0af1becac6047c1b23f69aa18bb59` was superseded by test-only type
annotations before qualification; no delivery or passing-test claim uses it.

## Final verification and delivery

`S3_HTTP_EXPORTS_REVISION=1a8b9677e433da9aa387ff115cf517a7445791b3 npm test`
passed with uncached maintained discovery, no excluded workspaces and native
pre/event/post stages. Results: shared Vitest 23,485 passed / 2 skipped; Python
29 passed; shell runner 499 passed; shell suites 37,662 passed / 823 skipped;
SafeJS 28,932 passed / 47 skipped; terminal-pilot 288 passed; posttest lint stress
2 passed. Missing declared test tasks are reported as unavailable, never passes.
The selector was scoped by the maintained runner to the virtual-bash unit task.
All 43 owned input files matched the immutable revision after execution; only
this plan and the scoped receipt receive final result updates afterward.

`npm run build` passed all declared workspace builds and root suffix stages.
`npm run lint` passed repository ESLint, types and workflow checks. Subsequent
cleanup edits passed their exact scoped ESLint route and maintained virtual-bash
source/test and all 26 consumer type checks. The final bundle suffix restores
root packaging outputs after test prerequisites rebuild workspace outputs.
Original focused reader/codec checks, immutable packed exports, browser-conditioned
execution, corpus byte checks and CLI screenshot QA are recorded above.

Only the 43 explicitly owned source/test/config/research/plan paths are staged.
Unrelated work, the preexisting pipeline plan and research inputs, README files,
ignored corpus fixtures and temporary QA artifacts are excluded. The normal
Conventional Commit is made on main after verification, with hooks enabled; its
hash is reported separately from push/release status. No whole feature pipeline,
push or release is executed.
