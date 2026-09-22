# Dependency manifest protocol

The `@poe-code/remote-execution/protocol` export defines the
`dependency-manifest-v1` profile in [protocol.ts](src/protocol.ts).
The package-owned [wire schema](schemas/v1/dependency-manifest.schema.json)
and the requirements below define this profile.
MUST and MUST NOT below express requirements, not claims that an installed
namespace driver has been qualified.

## Wire records

| Record | Required binding |
| --- | --- |
| `DependencyManifest` | Version, authenticated session/epoch/namespace, immutable manifest revision, absolute logical root/cwd, selected source authority, ordered entries. |
| `DependencySource` | Authority, absolute source byte path, freshness, observed backend version and retained identity (explicit null when unknown), snapshot or callback grant. |
| `DependencyMaterializeRequest` | Session/epoch, manifest ID/revision, host-issued binding ID, expected directory revision (null initially), operation key. No physical destination field. |
| `DependencyMaterialization` | Operation and manifest identity, directory revision, operation state, indexed entry outcomes/revisions, retained callback grants and structured failure. |
| `ManifestInvocation` | Manifest ID/revision, ready directory revision, logical cwd, separately preserved original argument octets. |

`validateDependencyManifest` and `validateManifestInvocation` perform portable,
nonmutating structural admission for both direct SDK values and REST JSON records.
Invocation admission requires `maxArguments`, `maxArgvBytes` and `maxPathBytes`.
The argv byte budget counts original octets plus one native NUL terminator per
argument; it excludes pointer storage, environment bytes and launcher overhead.
Empty argv and empty arguments are structurally valid. Sparse arrays, NUL octets,
invalid octets and unknown fields are rejected. Invalid UTF-8 is preserved.
The native launcher MUST separately admit its actual byte/argument limits and
support before launch. This validator grants no authority and does not establish
that the supplied directory revision is ready or that cwd matches the manifest.
Authenticated host admission MUST verify those bindings and canonical cwd access.

IDs are opaque correlations whose authority MUST be verified against authenticated
host state. Source authority MUST identify explicitly admitted paths and rights;
it MUST NOT grant recursive reading merely because a directory is present.
Blob IDs/digests, backend versions, manifest revisions, directory revisions and
retained identities MUST remain separate domains. A retained identity is neither
a handle nor a snapshot. Safe-fs process-local identity tokens MUST NOT be serialized.

## Paths and entries

Paths are dense JSON octet arrays; filesystem paths are nonempty and NUL-free.
Entry paths are root-relative arrays of nonempty components, rejecting slash,
dot and dotdot components. Invalid UTF-8 remains valid wire data. No decoding,
normalization, case folding, URL expansion or rewriting establishes identity.
Entries MUST be strictly ordered by unsigned bytes joined with slash. Exact
duplicates MUST fail; target-specific aliases/collisions MUST fail during host
admission. Unsupported byte names MUST fail rather than receive replacement names.

Every intermediate parent MUST be an explicit preceding directory. The logical
root is supplied by the binding. An empty directory MUST survive materialization.
Canonical resolution, including symlinks, mounts and symlink-sensitive dotdot,
MUST establish containment and cwd accessibility; lexical prefixes are insufficient.

Entry paths MUST remain relative to `logicalRoot`, even when `cwd` is below that
root. `source.path` names the separately authorized canonical source; it is not
the materialized destination or an instruction to change argv. For example, with
root `/work` and cwd `/work/project`, entry components
`[project, edit, lists, cut.ffconcat]` appear at
`/work/project/edit/lists/cut.ffconcat`. Original argv still contains
`edit/lists/cut.ffconcat`; its nested `../../clips/part one.mp4` still resolves
from the list's parent to `/work/project/clips/part one.mp4`. A source binding
may identify `/canonical/project/edit/lists/cut.ffconcat` without exposing that
source pathname or any private server destination to native execution.

| Kind | Contract |
| --- | --- |
| Directory | Observed source directory; no implied descendant enumeration authority. |
| File | Authorized committed blob ID, exact nonnegative decimal byte size and lowercase SHA-256; verify bytes before declaring usable. |
| Symlink | Preserve literal target octets, including relative, absolute and dangling targets. Resolve and authorize at access; never flatten or rewrite. |
| Hardlink | Reference a preceding file's explicit identity group; require qualified source identity equality and backend support. Equal hashes do not imply links. No copy fallback. |
| Output intent | Exact path and nonempty, dense, unique create/truncate/append/replace operations; registration only, no immutable source or mutation metadata. |

Optional modes are 0–07777. Optional atime/mtime are signed-64-bit decimal
nanoseconds; byte sizes are nonnegative signed-64-bit-range decimal strings.
Unknown metadata MUST remain absent. Unsupported requested metadata MUST fail
before mutation, without rounding. Restore directory timestamps after children
where supported; symlink metadata requires no-follow support and hardlink aliases
require consistent metadata. Advisory modes do not establish POSIX permissions.

Output intent MUST NOT create/truncate a canonical user file, create a missing
canonical parent, reserve a placeholder or acquire an eager writer. A missing-parent
intent stays in the access plan, with failure deferred to native access; it cannot
become a materializable child by synthesizing a directory. Sequence patterns stay
in argv; exact output intents/effects are identified when native accesses occur.

## Capture, preparation and native access

### Exact tree and source binding

The prepared tree MUST contain each admitted entry at exactly
`logicalRoot + entry.path`, with the original component bytes and entry kind.
Preparation MUST NOT install unlisted source descendants, expose staging helpers,
or add a source-path prefix to that tree. The root itself is the host binding;
when cwd is below it, cwd's prepared directory ancestors MUST be explicit entries.
Host admission MUST verify cwd resolves to an accessible directory in that binding,
not merely that cwd starts with the root's bytes.

An exact prepared tree describes private preparation at its directory revision.
It does not promise a frozen canonical listing for live dependencies. Later
authorized canonical additions, removals and replacements remain observable through
the live bridge under backend consistency. Directory entries MUST NOT convert
that bridge into recursive read authority, and preparation MUST NOT enumerate
unspecified children to complete the tree.

`source.path` identifies the selected canonical source independently of the
destination components. For a symlink it identifies the link entry, whose literal
target is preserved; permission to observe the link MUST NOT authorize its target.
For hardlinks the broker MUST establish qualified identity equality for both
selected sources in the same admitted identity domain. Client-supplied equal
`retainedIdentity` strings or blob hashes alone are insufficient. Pathname opens
after replacement MUST acquire the replacement under current authority; already
retained reads continue to address their original object.

For output intent, the required source record correlates the selected canonical
output path and later callback scope. It MUST NOT trigger an input read, existence
probe, writer acquisition or assertion that the output exists. Null version and
identity observations remain valid. A registered create/truncate/append/replace
intent MUST still obtain independently authorized native-time acquisition and
mutation receipts, including safe-fs create disposition where available.

| Freshness | Required native behavior |
| --- | --- |
| Immutable | Explicit independent upload or qualified stable snapshot/content lease, bound by host-issued snapshot ID. An immutable blob alone cannot freeze a mutable source. |
| Revalidate on open | Retain callback grant; atomically bind the actual acquired source to a current qualified version at every native open. Changed/unknown versions invalidate prefetched bytes; use canonical reads when version binding is unavailable. |
| Live | Retain callback grant; canonical open/stat/list/reload and retained-object reads remain live under the backend's consistency semantics. |

Uploads MUST verify length and whole digest before publishing an authorized blob.
Mutation during capture MUST remain unstable unless the bytes are explicitly
accepted as an independent upload. Traversal alone is not a directory snapshot.
Optional/late prefetch failures MUST NOT suppress earlier native effects.

Materialization MUST acquire the authorized committed blob identified by each file
entry and retain that exact immutable byte object through installation. Its settled
length and whole SHA-256 MUST match the entry's `size` and `sha256`; checking a
receipt and then reopening a replaceable storage pathname is insufficient.
Blob eviction or loss before acquisition is `missing-blob`, not permission to read
the source path or substitute another blob. Integrity verification and installation
MUST address the same bytes, including when storage deduplicates content. This blob
retention freezes only the uploaded bytes; it MUST NOT replace mutable-source
callbacks, extend a snapshot lease or confer canonical read authority.

Preparation MUST authenticate every binding/blob, admit metadata/link/namespace
capabilities and collisions, and compare revisions under shared serialization for
overlapping or alias roots. It changes owned private state only. The server MUST
own logical-to-physical mapping. Original argv (including empty arguments) and
nested file bytes MUST remain unchanged. Mapping MUST preserve nested relative
references and logical absolute paths for native processes and delegates.
Native diagnostics MUST NOT expose scratch paths; arbitrary stderr substitution
is not a namespace implementation. Reject an unqualified driver before launch.

| Outcome | Required observation/recovery |
| --- | --- |
| Missing blob | Failed preparation, or partial if work was already applied; identify the affected entry. No implicit server-path fetch. |
| Wrong length/hash | Distinct wrong-length/wrong-hash failure; bytes MUST NOT become usable. |
| Stale manifest/directory revision | Conflict (HTTP 409), no new entry effects; inspect and explicitly resubmit. |
| Concurrent manifests | Recheck expected revision after acquiring serialization; only one competing request may advance the same revision. Identical keyed requests recover one operation; conflicting bodies fail. |
| Partial application | Preserve applied/failed/pending entry outcomes and revisions; do not launch against an incomplete required tree or blindly replay. |
| Unresolved effect | Unknown, inspect by operation identity; loss of acknowledgement is not proof of no effect. |
| Ready | Required entries and capabilities admitted; intent applied means registered only. Pin the tree for the job. |

A ready directory revision MUST NOT be used as proof of current mutable content
at native open. Job handoff MUST retain scoped canonical access and obtain valid
successor callback grants/leases. Callback loss MUST NOT enable stale-blob fallback.
Concurrent canonical writers are not controlled by preparation serialization.
Cleanup MUST touch only owned staging and report its outcome separately.

### Materialization observation invariants

An inspection record MUST refer to one authenticated admitted operation and its
unchanged manifest ID/revision. Entry indices MUST identify the stored manifest's
entries, appear once in increasing order, and include pending entries; a shortened
success list MUST NOT stand in for a complete status record. Entry revisions are
receipts for observed private application, never source versions or content leases.
An unknown entry MUST retain any known progress without inventing a final revision.

`accepted` means admission was recorded, not that any entry exists. `applying`
means preparation has not settled. `failed` means no private entry application is
known to have succeeded and the failure is known; `partial` means some application
is known to have succeeded and required preparation failed. If an admitted effect
is unresolved, report `unknown` with the known entry outcomes rather than assert
that it failed without effects. None of these states permits native launch.

`ready` MUST have a non-null prepared directory revision and an applied outcome
for every required entry, with no failed, pending or unknown entry. An empty
manifest can be ready only after the bound root/cwd and required namespace
capabilities are admitted; a revision still identifies that prepared namespace.
An applied output intent records registration and supplies no existence receipt.
Retained callbacks MUST cover every mutable dependency at handoff, with explicit
job-scoped successor grants before native access. A ready record cannot extend a
grant's lifetime or turn an observed version into a snapshot.

Reject malformed or contradictory inspection records. A client MUST NOT repair
them by dropping entries, deriving revisions from hashes or treating a partial
tree as ready. Inspection/recovery, cleanup and native-open freshness remain
separate observations even when they refer to the same logical directory.

For initial preparation, `failed` MUST NOT describe applied or unresolved entry
effects. `partial` requires applied work and a known entry or operation-level
failure. A later namespace or capability failure may leave every entry applied
while preparation remains partial. Unresolved effects require `unknown`, preserving
known progress. A stale-revision rejection MUST NOT claim new application, even
when an earlier operation has applied entries in the same namespace.

Historical application receipts MUST survive later readiness revocation; they
MUST NOT be rewritten as pending or erased to suggest no effects. Such revocation
is a separate observation from initial preparation failure and never permits
launch against the formerly ready revision. The current service also uses
`failed` for revoked readiness, and `partial` for some stream-settlement failures;
the portable validator does not enforce the initial-preparation distinctions
above. Structural acceptance of those records is not protocol conformance or
evidence of known effect settlement. Qualification MUST distinguish preparation,
revocation and unresolved effects before advertising these status guarantees.

## API lifecycle and admission boundaries

REST and SDK callers MAY upload and materialize dependencies without selecting a
tool. The lifecycle is: begin/chunk/commit each identified blob, put the manifest,
materialize its stored ID/revision against a host-issued binding, inspect the
operation, then optionally submit a separate invocation. Upload receipts MUST be
authorized in the same authenticated source/session domain before use. Manifest
admission MUST NOT discover extra files, enumerate a whole source root, or infer
read authority from an argv operand.

| Boundary | Evidence required before advancing |
| --- | --- |
| Blob commit | Exact settled length and whole SHA-256; uncommitted or unauthorized blobs are unavailable. |
| Manifest admission | Raw-byte tree structure, immutable document revision, authenticated selected source paths and freshness bindings. |
| Materialization | Expected directory revision checked under overlapping-root serialization; exact required tree and indexed entry outcomes. |
| Native submission | Matching ready manifest/directory revision and logical cwd, preserved original argv, namespace/delegate support and job-scoped successor grants. |
| Native open/reload | Current canonical access or qualified atomic version/object acquisition; ready revision alone is insufficient. |

An output-intent outcome of `applied` means registration only. It MUST NOT imply
that a file exists, its parent was created, or write access was granted. A later
native create/truncate/append/replace has its own authorization and effect receipt.
Failed required preparation MUST prevent launch, while speculative dependencies
remain late canonical accesses rather than invented early errors.

For this profile, these requirements take precedence over the earlier generic
text-path/import description in remote-media contracts. No physical destination,
overwrite option or blanket read grant is admitted as an alternate field.

## Independent conformance evidence

The following requirements are independently
testable through `/protocol`, without a media parser or CLI:

| Requirement | Definition and portable evidence |
| --- | --- |
| Session/revision/root/cwd and selected source authority | `DependencyManifest`, `DependencySource`; [REST/SDK admission](src/manifest-contract-conformance.test.ts). |
| Original argv separate from tree paths | `ManifestInvocation`; [invocation admission](src/manifest-invocation-admission.test.ts) and [nested cwd](src/manifest-cwd-conformance.test.ts). |
| Raw bytes, ordering, duplicates, explicit empty directories, metadata and links | [Path and entry rules](#paths-and-entries); [protocol cases](src/protocol.test.ts) and [byte admission](src/manifest-byte-admission.test.ts). |
| Inert output intent and no missing canonical parent creation | [Output-intent rules](#paths-and-entries); [REST/SDK admission](src/manifest-contract-conformance.test.ts) and [materialization cases](src/materializations.test.ts). |
| Missing blobs, wrong length/hash, stale revisions, concurrent preparation and partial/unknown progress | [Preparation outcomes](#capture-preparation-and-native-access); [materialization cases](src/materializations.test.ts) and [progress admission](src/manifest-progress-conformance.test.ts). |
| Immutable, revalidate-on-open and live sources, with callbacks retained after ready | [Freshness and handoff rules](#capture-preparation-and-native-access); [source admission](src/manifest-contract-conformance.test.ts) and [injected live workspace](src/live-materialization.test.ts). |
| Original nested concat, filter/font, ICC and image-sequence trees | [Original examples and independent memfs oracle](src/manifest-original-examples.test.ts). |

No tool parser or CLI is needed to submit these records. The existing
[protocol cases](src/protocol.test.ts), [byte admission cases](src/manifest-byte-admission.test.ts)
and [REST/SDK cases](src/manifest-contract-conformance.test.ts) check structural
admission independently. The [original example cases](src/manifest-original-examples.test.ts)
verify blobs and exact logical trees in memfs for nested concat, cwd-based
filter/font/reloading text, ICC/caption and identified image-sequence dependencies.
Those cases specify original argv, nested text, cwd `/work` and expected trees.
The [nested cwd cases](src/manifest-cwd-conformance.test.ts) additionally verify
cwd `/work/project`, separate canonical source paths, unchanged nested concat
references and empty/non-UTF8 argv through direct SDK and REST JSON values.

[Materialization cases](src/materializations.test.ts) and
[live workspace cases](src/live-materialization.test.ts) exercise generic APIs,
integrity failures, output nonmutation, revision arbitration and partial status.
Passing structural or injected-service tests MUST NOT be advertised as evidence
of deployed native freshness, delegate confinement or diagnostic isolation.
Those require same-build native qualification against the safe-fs contracts.

Conformance MUST exercise each wire case through both direct SDK values and REST
JSON, with no tool parser, CLI or argv-based authority discovery. Use owned memfs
fixtures for portable tree tests; actual namespace behavior requires separate
native qualification.

| Required case | Expected observation |
| --- | --- |
| Nested concat, filter/font, ICC and identified image sequence | Exact specified cwd/tree, unchanged argv and nested resource bytes; sequence patterns never become manifest filenames. |
| Empty directory, invalid UTF-8 component, literal symlink and qualified hardlink | Preserve entry kind and byte identity, or explicitly refuse unsupported native semantics; never rename or copy a link as fallback. |
| Duplicate component path or target namespace alias | Reject exact duplicates structurally and target-specific collisions under authenticated host admission. |
| Output intent against an existing file or missing canonical parent | Registration has no read/write acquisition, creation, truncation or parent creation; native-time access determines the actual effect/error. |
| Missing blob, length mismatch and digest mismatch | Distinct affected-entry failures; rejected bytes are unusable, and earlier applied entries remain observable. |
| Competing manifests with one expected revision | Serialize overlapping/alias bindings and recheck after acquisition; one advance, one conflict, with no new effects from the rejected request. |
| Partial work or lost settlement acknowledgement | Preserve indexed applied/failed/pending/unknown outcomes and operation identity; no incomplete-tree launch or automatic mutation replay. |
| Mutable source changed after ready, or callback grant lost | Revalidate the actual native-open acquisition or use canonical live reads; never infer freshness from readiness or fall back to stale blobs. |
| Arbitrary physical destination or blanket source read field | Reject the field; server-owned namespace binding and per-access canonical authority remain required. |

[Invocation admission cases](src/manifest-invocation-admission.test.ts) verify the
separate original argv record through direct SDK and REST JSON inputs, including
empty and non-UTF8 arguments, sparse arrays, byte/count budgets, logical cwd and
rejection of caller scratch destinations or blanket read fields.

The [independent preparation observation cases](src/manifest-progress-conformance.test.ts)
exercise direct SDK records and REST JSON without tool parsers or a CLI. They
preserve distinct missing-blob, wrong-length, wrong-hash and stale-revision
failures, applied progress in partial/unknown trees, and retained mutable-source
callbacks after readiness. They reject ready records with unresolved entries,
missing application/directory receipts, repeated callback IDs or inconsistent
entry indices. Completeness against the stored manifest and callback rights remain
authenticated host checks; structural validation cannot prove either.

## Canonical output transfer freshness and receipt admission

Execution callbacks use the caller's canonical retained objects and descriptor
leases. Write, append, truncate and namespace effects settle individually; a
later native failure does not undo them. An effect store reserves both a receipt
slot and the write/append frame's bytes before canonical mutation. Its
`maxFrameBytes` bounds receipts independently of a job's `maxIoBytes`; exceeding
either bound refuses that callback before changing canonical storage. Read bounds
remain independent of receipt bounds. Store configuration is captured on creation.

Capability callbacks query the admitted canonical `capabilitiesFor` method when
available. Its denial or malformed result never falls back to a broader policy.
Without that optional method, callbacks observe the admitted
`FileSystem.capabilities` facet, including live changes to that facet. Replacing
the public facet cannot redirect an issued binding. Both routes narrow advertised
guarantees to executable canonical operations and apply read-only restrictions;
absent policy remains unsupported. A global facet must describe guarantees valid
throughout its protected filesystem, not guessed guarantees for individual mounts.

Descriptor writes combine their caller signal with the borrowed lease's optional
`consumerClosed` signal. Closure refuses subsequent writes and cancels cooperative
inflight writes to that destination without retiring sibling descriptors. A
canonical write that returns settled progress retains its byte-count acknowledgment
even when destination closure arrives before the promise settles. Closure is not
permission to reopen a pathname, bypass shell output accounting, or undo progress.

Native creation requires `FileSystem.objects.create`, including when the request
omits its flag and uses the default `w`. A legacy host `create` hook without the
canonical flag/disposition contract is never a fallback. Unavailable creation
rejects `ENOTSUP` at that callback; no creation or truncation is inferred.

`OutputSource.freshness(identityId, signal)` optionally returns a host-issued
`OutputFreshness` with a qualified local `identity`, a stable `version` string
(1–256 characters), and `assertCurrent(signal)`. The guard must validate current
access to that exact retained object/version under actual backend guarantees.
Size, mtime, pathname hashes and retained identity alone are insufficient. A
`RetainedReadFile` may expose the corresponding optional `freshness(signal)`;
the canonical effect store forwards it without synthesizing a version.

`OutputTransferCursor.sources` retains the qualified identity/version and original
bound guard per relative path, alongside the manifest binding and acknowledged
offsets. Preserve these local capabilities across resume. A serialized cursor
does not establish freshness. Resume revalidates the original guard and compares
the newly admitted source identity/version before opening that destination file.
Replacing a provider guard cannot replace the guard retained with progress.
Guard failures during resumed reads preserve already acknowledged destination
bytes; subsequent resume requires the same valid content binding.

Without qualified freshness, one-pass live retrieval is supported but reusing a
nonzero prefix is refused. This does not freeze execution resources, drawtext or
playlists; native reads still occur at their actual canonical access stages.
Output fragments are owned before awaiting freshness hooks or partial destination
writes. Completed files and native effects are never rolled back on transfer
failure. These APIs add no environment variables or native mount guarantees.

After an output has been produced, settled canonical acquisitions also record
`open` observations. An open can locate a surviving retained output at an alias,
or prove that an untouched replacement displaced its former name. Opens alone
never establish output membership. Acquisitions overlapping observed namespace
changes retain identity without claiming a current path. Mutation reconstruction
skips open observations while preserving their sequence numbers in its cursor.
Tree retrieval uses these observations without reopening old source pathnames
or enumerating shared directories; the CLI continues applying effects live.

The HTTP output metadata and byte endpoints emit a strong `ETag` only when the
retained backend exposes qualified freshness. The validator binds the job, output
identity, server retain identity and backend content version. An `If-Match`
request requires that exact validator; a changed or unqualified representation
returns HTTP 412 independently of the native exit. Metadata and each bounded
read validate the backend guard before and after accessing the retained object.
A change during delivery interrupts the stream without retracting delivered bytes.

`createClient().retrieveJobOutputs` retains that HTTP validator with acknowledged
progress, checks it on metadata requests and submits it with resumed byte ranges.
Inspection rejects an effect manifest whose job identity differs from the
requested invocation. Retrieval also binds cursor progress to the authenticated
endpoint, session, epoch and job through `OutputSource.scope` and
`OutputTransferCursor.sourceScope`. Equal opaque identities and validators in a
different scope cannot authorize a resumed prefix, completed file or directory.
Credential renewal within the same scope preserves resume. Generic adapters that
provide a scope must preserve it together with acknowledged cursor progress.
`readOutputRange` accepts the optional validator as its final `version` argument
and verifies the returned `ETag`. Unqualified endpoints continue to support live
one-pass retrieval and explicit ranges, but cannot authorize automatic prefix
reuse. Retention expiry, session closure and authorization failures remain
transfer failures with their original recovery information.


## Canonical descriptor capture admission

`uploadDescriptor` requires a trusted host-issued `UploadFreshness` bound to the
exact retained `FileReadHandle`, a qualified object/symbol identity, and a nonempty
content version (at most 256 characters). Identity is backend authority, never a
pathname, stat tuple, content digest, or serialized client claim. The validator
must enforce that same retained object's content version under a real backend
guarantee; supplying these fields does not create a snapshot or lease.

Resume progress must retain its original host-local `source: { identity, version }`
binding alongside `uploadId` and acknowledged `offset`. Admission rejects a
mismatched descriptor, identity, or version before remote inspection, canonical
reads, or upload cleanup. A wire cursor alone cannot manufacture this binding.
Capture checks for binding drift before and after each asynchronous freshness
validation and invalidates an admitted upload if its descriptor, identity, or
version changes. The declaration digest verifies transferred content; it does not authorize a read
or reuse by another tenant. Authentication and upload ownership remain separately
required by the upload service.

Capture reads the retained object after rename, unlink, or pathname replacement
when its qualified content version remains valid. It never reopens the old name.
Live playlist/drawtext accesses still use deferred canonical native callbacks;
this capture API does not admit eagerly freezing mutable resources. Completed
canonical mutation callbacks remain visible regardless of later command failure.

The materialization server retains the issued host authorization method and its
receiver alongside the qualified namespace driver. Installation and each launch
check live permissions through that same capability. Replacing a public method
table cannot redirect an installed namespace to another authorizer; revocation
does not corrupt the installed tree or authorize a fallback scratch read.

Canonical acquisition receipts must agree with their native flags: `w` reports
`created` or `truncated`, `a` reports `created` or `opened`, and `wx`/`ax` report
`created`. A contradictory receipt rejects with `EIO` at `create` and retires the
acquired retain. Any reported completed creation/truncation remains in the effect
ledger and canonical storage; failed admission does not roll it back. Capability
queries withdraw ordinary write/append and stream creation claims when canonical
`objects.create` is unavailable, even if legacy pathname methods advertise them.
Queries do not acquire files to probe optional operations or capture content.
