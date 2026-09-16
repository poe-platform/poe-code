# Bounded validated DOCX packing

Task: `validated-docx-packing` only. Later pipeline tasks remain pending.

## Scope and ownership

Implement `packDocumentArchive` and the existing `pack` command in packages/docx.
The safe-bash adapter remains a forwarding layer; its existing registration test
owns actual Shell coverage. Root exports already forward the package SDK.
Preserve unrelated edits, historical inventories and QA captures. No README,
download, native reference runtime, product networking, push or release.

## Admission and publication

The caller supplies a closed version 1 inventory. Each entry declares canonical
part, explicit VFS path, content type, exact byte count and lowercase SHA-256.
Entries use Unicode scalar ordering by part. File-based CLI inventories grant
the inventory file's directory; stdin inventories require absolute VFS paths.
SDK callers explicitly supply inventoryDirectory for relative paths.
Full extraction manifests carry these entry fields and retain optional all
selection, pretty intent and explicit empty directories. Media-only manifests
are not pack inventories. Payload edits require refreshed lengths and hashes.

Admit the whole package and VFS namespaces before payload reads: aliases,
file/directory conflicts, traversal, encoded separators and reserved manifest
members reject. Reject symlinks/unsupported kinds and noncanonical ancestors.
Read only declared payloads, copy streamed chunks before advancing, verify hashes
and bounds, then validate content types, all OPC targets, XML, dialect and existing
core-v1 semantic/protection/signature rules. Binary data has independent byte
limits and does not consume the XML-part ceiling merely because it is packed.
Opaque bytes remain inert. No pretty-whitespace cleanup occurs.

Output must lie outside the input tree. For stdin the input tree is the common
ancestor of the explicitly supplied file parents. If that is root, only binary
stdout is possible. Existing forced output requires proven distinct identity
from every input payload; unknown alias identity refuses. Shared staged publication
writes stored ZIP entries in Unicode scalar member-name order, fixed 1980 UTC
timestamps and no comment. Dry-run performs validation without writes. Staging
and cleanup never delete user trees or guessed resources.

## Failing tests and independent review

The initial SDK/CLI tests failed with absent pack export and unsupported command.
Actual Shell success, missing-graph, conflict, symlink and abort assertions also
failed before implementation. Original memfs regressions cover extract/edit/pack,
Unicode payloads, exact independently reopened unaffected members, pretty text
whitespace, Strict/Transitional and DOCX/DOTX retention, stale hashes, graph targets,
unsafe paths, unsupported kinds, output-tree refusal, dry-run and stdin.

Independent read-only review reproduced an incorrectly shared XML/binary ceiling
and caller-defined array map execution. Both became small original failing
regressions before correction. Additional failing regressions cover namespace
conflicts before reads, inconsistent VFS ancestor spellings, forced aliases of
any input and the supported inventory schema. Final independent review identified
directory depth admission before namespace work; its original regression failed
with five payload reads and now rejects before any VFS calls. Full VFS and archive
name byte/depth bounds precede namespace processing, whose prefix work/retention
is explicitly charged. The reviewer confirmed no remaining blocker. No downloaded fixture is required.

## Exact JS language/security mappings and drift

| Contract                                                | Exact mapping and disposition                                                                                                                                                      |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Inventory/path input                                    | Async explicit VFS admission; inventoryDirectory is a trusted SDK VFS grant, never a host directory discovery. No implied scan.                                                    |
| Bytes/hash                                              | Owned Uint8Array chunks, exact safe integer lengths and lowercase SHA-256. No decoding or execution of opaque data.                                                                |
| Ordering                                                | Unicode scalar part-name inventory order, distinct from archive member names with the special content-types literal. Both producer/consumer ordering is explicit.                  |
| XML                                                     | Parse and validate supplied bytes; character whitespace remains significant. Pretty intent does not authorize reverse formatting.                                                  |
| Metadata                                                | Closed JSON snapshots, arrays and own-data records; customized prototypes, accessors, holes and unknown fields reject without evaluating caller callbacks.                         |
| Kind/dialect                                            | Inventory, actual main content type and namespaces agree; explicit kind conflicts reject. No suffix inference or conversion.                                                       |
| Publication                                             | Awaited explicit capability calls, one shared staged output. Cancellation cannot undo completed publication; stdout transport can be partial under the existing contract.          |
| CLI options/status                                      | Mechanically paired camelCase options and kebab-case flags; affected 1 on success. Ordinary 0/1/2/3/4 and shell cancellation 130 retain the shared contracts.                      |
| Package/OpcPackage                                      | Utility reconstruction does not implement live open/save, creating getters, iterators, lifecycle hooks or relationship setters. Their recorded security mappings remain unchanged. |
| Part/XmlPart                                            | Utility bytes/graph validation do not promote live blob/element/part/package access, inherited hooks, relationships or mutation ownership.                                         |
| Relationships and public underscore-prefixed owners     | Public `_Relationship` and all inherited mapping/collection members retain explicit historical obligations; naming does not make them private.                                     |
| Enums/helpers/collections and APIs without source tests | Historical research dispositions remain unchanged. No whole-model coverage follows from utility tests.                                                                             |

The pinned audit/inventory were read, including every Package/OpcPackage,
Part/XmlPart and relationship/returned-collection entry. Their historical source,
getter/setter/constructor, enum alias and documentation-error records remain
unchanged. Neutral documented model spellings remain primary, with no blanket
aliases. This additive F50 utility is not a full model implementation.

The spec's old packing-pending statement is superseded only for this utility.
The earlier extraction manifest's lack of part/contentType is resolved by
additive sorted full-inventory entries. Optional extraction intent/directories
are now part of the bounded inventory contract. Shared office grammar and method
naming do not change. Full format, public model and later tasks remain pending.

## Maintained verification and visual QA

Completed selected `npm run build:workspaces -- --workspace=docx` and the
normal `npm run build` (all declared workspace stages and root suffix/bundle).
`npm run lint --workspace=docx` passed; its existing operation-types test has one
unused type-only variable warning. Focused final pack/extract checks passed 55
cases. Full final workspace and clean final adapter typecheck results are recorded
below when settled. Actual Shell DOCX command/registration coverage passed all
160 tests after the normal build settled.

`npm run lint:packages -- --quiet` reported three missing README files in the
office-package, docx and pptx packages. Those are documentation violations, not
failing unit tests; README edits are outside this bounded task's authorization.
No package-lint pass or full model conformance is claimed.

Executed `npm run screenshot-poe-code -- bash --command 'docx help pack'`:
the root Bash command has no implicit DOCX plugin and reports command-not-found.
Preserve that capture separately; root registration is not expanded by this task.
A subsequent root screenshot preparation overlapped builds and failed compiler
identity admission. Restoring the complete normal build resolved missing
root-generated filesystem bridge modules; no source fallback was introduced.

Then executed the maintained generic screenshot capture with an explicitly
configured Shell/docxCommands/createDocxInspectionCommandEngine and memory VFS.
Inspected `screenshots/docx-pack-plugin-help-verified.png` and
`screenshots/docx-pack-plugin-usage-verified.png`: complete inventory help/options
are legible without clipping, and inapplicable --in-place produces the bounded
usage diagnostic. Captures are ad hoc QA only, ignored and not unit fixtures.
All earlier unrelated QA captures remain untouched.

Only the current task status will change after final checks pass. Stage its
status hunk separately from preexisting changes in the shared pipeline plan.
One local Conventional Commit owns this atomic utility improvement; no push
or release. Later tasks, whole-model APIs and packed-consumer QA remain pending.

## Verified local integration, 2026-09-15

The teardown request authorizes committing remaining verified task-owned work.
Root integrates only the packing paths described above, its SDK/CLI wiring,
extraction inventory compatibility, packing discovery, original packing tests and
the task 87 status. Existing OMML and unrelated pipeline/specification edits stay
outside the index. Earlier resumption records remain historical blockers; this
integration resolves delivery of their packing prerequisites without relabeling
any earlier live-tree run as a committed result.

Fresh maintained `npm test --workspace=docx -- --reporter=dot` passed 178 files,
3,438 tests with four skipped (130.71 seconds). Skips belong to pending paired
acceptance and are not passes. Fresh `npm run lint --workspace=docx` passed ESLint
and both source/test typechecks with one existing type-only warning. Fresh
`npm run build:workspaces -- --workspace=docx` passed its declared dependency
closure and native postbuild stages. These are scoped gates; no root-wide unit,
full virtual-bash, root build, remote or release gate ran in this teardown.

The supplemental actual Shell registration run passed 16/16 tests, covering
packing success, stdin, Unicode, graph refusal, conflicts, symlinks and abort.
Public barrel SDK packing behavior and typed operation arguments are checked by
pack.test.ts and the maintained test typecheck. No full model/public SDK coverage
follows. Existing verified pack help/usage PNGs were reopened during teardown:
complete help/options and the inapplicable-option diagnostic are legible. These
are ignored ad hoc captures, not committed binaries or new screenshots.

Standalone MIT notices remain unchanged and are explicitly included in the root
package file list. Substantial adapted test material has no implicit legal
exemption. The identity scan covered DOCX source/tests, shared office-package,
root source and DOCX adapter paths with no named reference-project identities.
No corpus acquisition, rerun, new regression or cleanup is claimed by integration.
After explicit index review, this bounded utility receives one atomic local
Conventional Commit; whole-format/API and other task completion remain unverified.
