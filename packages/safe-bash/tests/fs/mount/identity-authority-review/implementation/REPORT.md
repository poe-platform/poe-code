# Independent implementation authority verification

Date: August 27, 2026 UTC. Scope: this new `implementation/` subtree only.
Authoritative API: actual `src/contracts/filesystem.ts` and
`src/contracts/filesystem.md`, approved contract `5076b32`; core consumer
checkpoint `f291156`. Proposal `29fe1bf` and its 29 tests are immutable history,
not the implementation or an acceptance oracle for this review.

## Checkpoint verdict

**Current authority gate is RED: WebDAV pre-construction overrides permit source loss.**
The suite has 47 independent focused tests: 20 public wrapper/native-authority
tests and 27 remote/protocol/operation-authority tests. It imports and exercises
actual product classes and their public methods. It never imports the historical
`proposal.ts`, `FixtureAuthority`, `proofCopy`, or `proofMove` scaffolding.

Two real source-loss failures were found and reported immediately to root. The S3
owner repaired the observed unsafe response-provenance-only rule by also binding
authority to registered, unchanged provider operations. The subsequent captured
working-tree tests reject the split metadata/data transport as unknown before
content or writes. See `FINDINGS.md` for the exact failing source hashes and repro.
The later WebDAV pre-construction override finding is still pending source-owner
remediation and committed-source verification. No source fix was made by this verifier.

The old independent positive suite's 38 required successes plus five controls,
the original/required 53 guards, full filesystem suites, S3 policy cohort and
core cp/mv suites were **not replayed here**. Qualified positives here do not
replace or waive original opaque-client inputs or their mandatory success gate.
No full compatibility, live-provider, race-safety or product-superiority claim.

## Actual authority design reviewed

### Common helper and wrappers

- The module-private wrapper resolver map and terminal authority map are separate.
  Wrappers resolve both operands to selected backing views; readonly policy is
  retained. The common helper does not invent a storage namespace per wrapper.
- Complete scoped native identity wins without invoking an optional callback.
  Known aliases cannot be overridden. Unknown tuple comparison can query each
  terminal authority once, validate literals and reject conflicting answers EIO.
- Opaque forwarders of negotiating methods do not create a second recursive
  negotiation. The later helper returns unknown before nested metadata/query
  work, not a recursive error mistaken for a successful distinctness result.
- Actual followed paths are resolved using realpath plus final lstat. The helper
  does not fuse a scoped identity from one stat with another observation's fields.
  Missing, inaccessible and IO-failing entries remain real failures. Cancellation
  is checked between metadata and peer queries, including ENOENT-shaped reasons.
- Memory and real need no new optional method to publish complete native identity.
  Their backing entries are tested through actual public readonly/mount comparison.
  This is not a demand to expand the approved optional API surface.

### S3

The unsafe intermediate implementation accepted private mock HEAD provenance as
whole-provider mapping authority. Two custom clients could return those genuine
metadata objects while directing GET/PUT to one shared memory file. Comparing
the two private metadata stores then falsely returned distinct and allowed source
truncation on a failed destination write. The raw failure is frozen, not rewritten.

The repaired working-tree implementation combines fresh observed metadata with
recognized full-operation transport ownership. Built-in MockS3 providers and
the existing `createS3Transport` forwarders qualify; changed operations and
unrecognized custom transports do not. Different keys are compared only inside
the actual known storage mapping, including overlapping adapter prefixes.
Independent private mock stores can establish actual disjointness. No ETag,
bucket label, protocol name, class name or per-client token is used as an inode.

This deliberately does not authorize arbitrary manually assembled clients merely
because their HEAD returns a mock-owned object. Such a client may route content
or mutations elsewhere. Passing new qualified factories is not evidence that the
unchanged original opaque-client positive rows passed.

### WebDAV

The implemented protocol comparison requests resource-id metadata and validates
the requested response and successful, correctly namespaced property. The tests
exercise actual parser/request code with cloned Responses, so private mock
provenance cannot bypass the protocol branch. They cover missing/foreign
properties, property404, resource404, denial, invalid URI, duplicate property or
response, and another resource's href. No href, ETag or content hash is promoted
to identity. Both the actual mock's resource IDs and native namespace/byte effects
are checked across PUT, MOVE, COPY creation/overwrite and delete/recreation.

Private closed-store descriptors additionally require recognized transport
operation binding. Genuine MockDav Responses from an arbitrary split fetch do
not establish that its GET/PUT use the same store. The parallel split-fetch test
stayed unknown and source-preserving in all captured implementation runs.
However, a different case installs data-method overrides before the base
constructor snapshots method references. That subclass is falsely accepted as
the base resource authority, and the actual mount copy damages its aliased
source. This is a reproduced WebDAV source-loss finding, not merely a protocol
limitation. See `webdav-operation-override`. Full resource-id semantics still
assume an honest supporting provider; this is not provider authentication.

Actual source owners changed the original MockDav provider to supply the extension.
This verifier did not change that helper. Old and current mock source bytes and
hashes are retained in separate source archives, not silently mixed into the
old proposal/positive-review evidence. Cross-protocol disjointness is not inferred.

## Executable coverage and limits

| Scope | Evidence exercised |
| --- | --- |
| Shared native storage | Memory hardlink/symlink aliases; independent memory stores; native-real roots sharing a hardlink |
| Both wrapper operands | Nested readonly/mount chains, actual selected overlay view, readonly destination refusal |
| Future overlay write | A controlled upper hardlink insertion after lower observation is caught before copy effects |
| No comparison effects | Instrumented unknown views reject readFile/readStream/write/truncate/copy/rename/remove/mkdir; remote traces contain only metadata requests |
| Peer negotiation | Complete-alias precedence, invalid/conflicting answers, one callback for repeated backend, two distinct callbacks once each, no recursive metadata |
| Errors/cancellation | Source and peer ENOENT/EACCES/EIO, caller ENOENT-shaped abort between callbacks, abort after first WebDAV identity query |
| Exclusivity | A target inserted at the actual destination writer remains unchanged; source remains unchanged |
| Qualified S3 | Shared-store distinct clients and overlapping prefixes, ordinary existing-target copy, independent stores, alias refusal |
| S3 faults | Real mock authorization source/target failure and cancellation after successful distinctness proof, unchanged source/target, no delete |
| Unrecognized S3 | Split metadata/content routing, changed forwarder operations and subclass content override remain unknown |
| Unrecognized WebDAV | Split fetch is safely unknown; pre-construction adapter overrides currently fail source preservation |
| Qualified WebDAV | Different endpoints and roots, nested readonly/mount copies, equal ETags but distinct resources, alias refusal |
| Protocol parsing | Actual full multistatus/property/status parsing, error propagation and no content/mutation during comparison |
| Mock truthfulness | Resource ID stable on PUT/MOVE/COPY overwrite, fresh on COPY creation/recreation; corresponding bytes and missing path checked |

The overlay insertion is one controlled interleaving, not a lease or proof against
all upper-owner violations. There is no inode-reuse/ABA defense, source-incarnation
conditional delete or atomic cross-backend move in these tests. Core `mv` ordering
and the exact original integration gate remain with their assigned verifiers.
Only bounded mock/local IO was used; no live S3/WebDAV endpoint was contacted.

## Preserved run history

Each row has its own immutable source archive, raw TAP, frozen test files,
typecheck stdout/stderr, captured handoffs and SHA-256 manifest. No red run was
overwritten. Rows have different test revisions where indicated; do not sum them
or present early missing implementation as a newly introduced regression.

| Capture | Source | Pass / total | Meaning |
| --- | --- | --- | --- |
| `baseline-local` | `0c4709f` | 1 / 19 | Approved signature, methods not implemented; early native-method assumption also present |
| `early-design` | moving worktree | 16 / 19 | Wrapper methods present; native method assumption still too strong |
| `early-remote` | moving worktree | 34 / 39 | Includes early overstrict transparent-subclass expectation |
| `split-authority-repro` | moving worktree | 34 / 40 | Genuine S3 false-distinct/source-loss repro plus recorded harness limitations |
| `safety-recheck` | moving worktree | 41 / 41 | Operation binding and corrected optional-surface tests |
| `baseline-final-cases` | `0c4709f` | 2 / 43 | Then-current test version against pre-implementation source |
| `complete-safety-recheck` | moving worktree | 43 / 43 | Adds bounded reentry and resource-lifecycle checks |
| `qualified-failure-recheck` | moving worktree | 46 / 46 | Adds three qualified S3 failure/cancel checks |
| `baseline-46` | `0c4709f` | 2 / 46 | Final root-view assertions against pre-implementation source |
| `roots-46` | moving worktree | 45 / 46 | Product mock corrected COPY overwrite; this leaf's old identity expectation was wrong |
| `corrected-protocol-46` | moving worktree | 46 / 46 | Correct overwrite/creation identity expectations; all focused checks pass |
| `webdav-operation-override` | moving worktree | 46 / 47 | Newly added holdout exposes WebDAV false authority and source loss |

All listed scoped typechecks exit 0; none is a whole-repository typecheck. Every
listed run has zero skips, todos and cancellations. Test-reported failures are
retained as failures, with exact reasons in TAP. `FINDINGS.md` documents the early
test-design corrections; they are not silent source-failure waivers.

The COPY overwrite expectation is corrected using RFC 5842 section 2.7, checked
August 27, 2026: updates to an existing resource retain its resource ID; creation
of a new resource allocates a fresh ID. The amended lifecycle test checks both.
Earlier green lifecycle runs are not correct protocol evidence on that point.
Reference: `https://www.rfc-editor.org/rfc/rfc5842.html#section-2.7`.
Final source-leaf commits and pinned after-checkpoint results are still pending
at this report checkpoint.

## Reproduction and integrity

From the repository root, with the existing development tools installed:

```sh
node tests/fs/mount/identity-authority-review/implementation/capture.mjs REVISION new-label
node tests/fs/mount/identity-authority-review/implementation/capture.mjs worktree another-label
```

The runner refuses existing labels. For a Git revision, it uses `git archive`,
not the moving worktree, and runs only the owned implementation tests against
that archive. For worktree runs, the copied archive identifies the actual bytes;
the observed HEAD is not a claim that those bytes were committed or atomically
captured. Source includes the author-owned actual MockDav, never a rewritten
fixture. Per-file source/test hashes and source archive hash are in `manifest.json`.
The exact current contract TypeScript is checked against `5076b32`.

All 57 tracked files in historical proposal commit `29fe1bf`, including its raw
evidence, are checked byte-for-byte against that commit on every capture. New
artifacts stay in this `implementation/` subtree. Scripts and reports are authored
with apply_patch; raw artifacts are generated by the checked-in runner. No root
exports, production source, contracts, existing fixtures, or other reviewers'
reports are changed by this leaf.
