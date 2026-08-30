# Independent remote identity-authority review

Review date: August 27, 2026 UTC (August 26 in America/Chicago).
Owner scope: this new directory only. **Proposal, not an approved contract or
production implementation.** Route decisions and changes through root Curie.

## Decision for root

Recommend **one optional pairwise `compareEntry` method**, not a broad
`guardedCopy` capability and not both seams. It can recover ordinary existing-key
copies within one remote adapter and across recognized views of the same remote
storage without inventing numeric inodes. Unrecognized overlapping storage stays
unknown. A qualified operation guard is a valid narrower alternative if only
same-backend native copies are wanted, but that does not meet this assignment's
cross-adapter requirement.

The smallest proposed public addition is exactly:

```ts
export type EntryComparison = "same" | "distinct" | "unknown";

interface FileSystem {
  compareEntry?(
    path: string,
    peer: FileSystem,
    peerPath: string,
    options?: FsOptions,
  ): Promise<EntryComparison>;
}
```

`proposal.ts` typechecks this addition as an extension, without touching the
contract. Its registry and copy/move receipt are **test-only implementation
scaffolding**, not additional requested public APIs. The receipt is local control
flow evidence, not a transferable capability or a filesystem incarnation lease.

**Evidence:** 29/29 bounded tests and scoped typechecking pass on both frozen
`4fa4ba9502dac843bd13aa5031d128a3171f597d` and the captured moving worktree.
These include negative controls and three deliberate limitation
characterizations, not 29 successful product workflows. No all-FS or 43-case
positive-suite rerun occurred. The independently recorded `d799cbb` result stays
**18/38 successful required workflows**, with 20 failures; the full cohort was
23/43 including five rejection controls. This prototype does not turn that gate
green and does not establish full product compatibility or superiority.

## Normative meaning proposed for the seam

1. The comparison MUST describe the actual followed backing entries observed for
   this pair, not their contents, spelling, credentials, classes, or client
   instances. `same` and `distinct` are affirmative observations; absent method,
   unrecognized peer, incomplete authority or unavailable identity is `unknown`.
   A missing path is not a distinct existing entry; normal missing-path handling
   remains with the consumer. Real metadata/authorization/cancellation errors
   propagate rather than being rewritten as missing or successful distinctness.
2. The method MUST be metadata-only. It MUST NOT acquire a content source,
   truncate/open a destination, copy up, create a lock-null resource, publish a
   copy, or remove an entry. It MUST forward the signal and reject cancellation.
   No guarantee is made that an uncooperative host request can be interrupted.
3. Peer recognition MUST use a provider-owned shared authority/registration or
   negotiated protocol identity. A registry entry establishes what backing
   namespace and mapping the provider actually controls; it is not a user-facing
   "trust this client" switch. Two different authority objects mean **unknown
   overlap**, not disjointness. Only independently established disjoint storage
   or an authority capable of comparing both operands can return `distinct`.
4. Different endpoints, DNS aliases, base URLs, S3 access-point/bucket aliases,
   prefixes, authentication sessions, wrappers and transport objects MUST NOT
   imply disjointness. An authority canonicalizes mappings it actually knows;
   string normalization alone cannot establish the mapping. A peer that happens
   to implement the same class is not thereby enrolled.
5. Equal content, ETags, hashes, lengths, times, URL strings and unscoped inode
   numbers MUST NOT replace entry identity. No remote tuple is manufactured.
   The approved `identityScope` contract is unchanged. Native memory/real tuples
   remain sufficient when complete and truthful.
6. The consumer MUST reject known aliases before effects. It MAY obtain a
   pairwise answer from either recognized side, at most once per side, with no
   recursive negotiation. For ordinary resolved entry views the relation is
   symmetric. If answers conflict with each other or a complete tuple, fail
   closed (`EIO` in the prototype). Known alias rejection need not call another
   authority. Runtime values outside the union MUST fail closed.
7. Results are not cached pathname leases. Reobserve for each operation and after
   wrapper selection changes. There is no atomic snapshot across two metadata
   requests, no protection against post-observation rebinding, and no ABA or
   conditional-delete guarantee. Providers must disclose cache/freshness limits.

## Algorithms remote owners can implement

### Shared negotiation without a second public filesystem seam

An owner-built factory can maintain a private `WeakMap<FileSystem, resolver>`.
The factory enrolls only views whose mapping it controls, including explicit
transport forwarders and endpoint aliases. Each resolver obtains the current
entry address under that owner's authority. `compareEntry` looks up both
operands; an unrecognized one returns unknown. Matching authority plus matching
entry is same; matching authority plus different entry is distinct. Different
authorities require an explicit, justified disjoint relation or a bridging
authority able to compare them. **Absence of a bridge never means disjoint.**

`FixtureAuthority` executes that algorithm. Its `certifyDisjoint` is exercised
only for independently allocated in-memory stores, including overlay upper and
lower. It is not proposed as a generic consumer permission to assert remote
disjointness. The remote tests use one owner per actual backing mock, shared by
separate transport/client views; they never allocate a disjoint token per client.

This is extensible without class checks: another backend implements the same
pairwise method and negotiates actual authority with the peers it recognizes.
A mixed S3/WebDAV gateway must supply a shared mapping when both expose the same
storage. Different protocols alone are not a disjointness proof. Unknown
third-party providers do not gain safety by being wrapped or cast.

### S3

For a **known S3 namespace**, compare provider-resolved bucket identity and the
effective full key (including the adapter prefix). The uniqueness of keys is a
property of that S3 namespace [P1], not a fabricated inode. Preserve exact key
bytes according to the adapter's actual mapping. Bucket/access-point/endpoint
aliases must be resolved by the provider authority, not compared as strings.
Different deployments or opaque injected clients do not automatically share this
knowledge. A forwarding factory must retain authority, not allocate another one.

The shipped `MockS3Client` really owns independent bucket maps. Its owner can
automatically enroll all adapters/forwarders built over that store. The proof
uses the actual mock and `createS3Transport` wrappers; two client objects over
one store compare same keys as aliases and distinct keys as distinct. A separate
test covers overlapping `root` and `root/nested` prefixes with different local
path spellings. This is a concrete automatic-registration path, not a runtime
boolean and not a claim that arbitrary injected S3-compatible clients share an
authority. Generic transport owners need to supply their own verified mapping.

After proof, the owner can retain server-side `copyFile` for two paths in a
single operation namespace. Otherwise use the existing bounded byte transfer.
Native destination exclusivity is still required for absent/exclusive targets.
`conditionalCopy` is a transport-specific promise, not implied by comparison.
The actual mock race test observes `IfNoneMatch: "*"` and an untouched raced
destination. AWS currently documents destination conditional CopyObject headers
too [P2]; this does not prove support by every S3-compatible server.

### WebDAV

Do not equate distinct hrefs with distinct resources. RFC 4918 explicitly allows
URI aliases and case-folded segment mappings [P3]. A useful protocol path is
RFC 5842 `DAV:resource-id`: request it explicitly using metadata-only Depth-0
PROPFIND; accept only the requested resource's successful property response.
Under the extension's identity semantics, the same resource keeps the same ID
across bindings and new resources receive new IDs [P4]. Compare full IDs, not
numeric hashes. This extension is Experimental and is **not guaranteed by base
WebDAV or COPY/LOCK support**. Missing, malformed, conflicting, inaccessible or
untrusted resource-id data must not be promoted to distinctness.

Recognized compliant views can negotiate this protocol identity authority even
through different endpoint spellings. Other views require provider-owned
canonical backing-resource resolution. A server-specific resolver must account
for bindings and case/alias rules; a generic href comparator is not one.

The protocol proof enriches the actual repository `MockDav` responses with
explicit resource-id properties through a small trusted fixture, then uses the
repository XML parser. It proves same-adapter and separate-endpoint overwrites,
rejects a shared-source alias, and refuses an absent property before GET/PUT.
Equal source/target ETags remain distinct because their resource IDs differ.
The fixture is not a deployed-server test or a production-ready protocol parser;
it accepts one controlled UUID form and does not establish arbitrary multistatus,
binding, proxy-cache, authentication or malformed-XML interoperability.

Owners can make this path automatic for supporting servers and owner-built
mocks. Existing base-only `MockDav` has no such property, and current production
PROPFIND does not request it. Do not silently bless those deployments by class,
URL or a broad flag merely to clear the existing acceptance suite.

## Copy consumer and wrapper ordering

1. Resolve namespace and permissions, including read-only policy; reject invalid
   roots/directories. For exclusive copies, use entry/no-follow existence
   semantics so an existing final symlink cannot become an absent target.
2. Observe the source and existing destination before acquiring even a potentially
   eager stream. Keep all original alias and complete-tuple guards. If incomplete,
   use the optional comparison; unknown existing targets fail `ENOTSUP` before
   content or mutation. Never move same-mount delegation ahead of these guards.
3. A missing destination may use actual `wx`/native exclusive creation. A
   check-then-ordinary-open is forbidden; a raced target stays untouched. Never
   retry a failed exclusive operation as truncating overwrite. `ENOENT`-shaped
   caller cancellation is still cancellation. Existing exclusive targets fail
   `EEXIST` before content acquisition.
4. Once distinctness is proven, perform the selected copy, await all writes and
   completion/cleanup, and propagate failure. Destination partial effects may
   remain; do not claim rollback. Cancellation after publication is not rollback.
   The bounded prototype uses at most 1 MiB buffered reads; it is not a new
   production streaming implementation or streaming lifecycle validation.

The executable copy prototype covers supplied regular-file views. It is not a
replacement for the production resolver's complete final-symlink, mount-root,
copy-up or recursive-copy rules; those remain mandatory integration checks.

Mount must resolve **both** operands to real views without confusing synthetic
mount metadata with backing identity. A repeated mount of one backend can use
one native operation after proof; same object routes an operation, not disjoint
storage. Read-only source forwarding can preserve comparison while destination
read-only policy still rejects. No private reflection or identity relabeling.

Overlay needs an additional consumer obligation, **not another public seam**:
compare the visible source/target as well as the actual selected mutation target
when these differ. A comparison of the lower read view does not authorize a
future upper write. Resolve and guard the mutation plan before copy-up; recheck
when selection changes. If the wrapper cannot expose/resolve that plan faithfully,
return unknown rather than forwarding a lower identity as future-write authority.
The overlay test demonstrates fresh selected identity after completed copy-up;
it deliberately does not certify a general future-write-plan algorithm.

## Why `guardedCopy?: boolean` is insufficient here

The historical flag promises alias rejection before source acquisition and
mutation, exclusive creation, source preservation on destination failure and
signal propagation for every delegated pair. Method presence or protocol name
proves none of those combined obligations. With a genuine implementation it
could permit same-operation-backend delegation, including one backend mounted
twice. It still says nothing about a streaming copy between two backend objects,
even if they share storage. Adding it as well as pairwise comparison is unnecessary
for the tested workflows, and increases the authority surface.

Actual observations, not assumed native guarantees:

- S3 direct same-path `copyFile` returns success without CopyObject. It does not
  satisfy the proposed `EINVAL` guard; that success is dangerous as a move receipt.
- Direct S3 and WebDAV native missing-target copies preserve raced targets in the
  bounded mocks. S3 rejects a CopyObject authorization failure without deleting
  either file. These are qualified controls, not universal native alias proofs.
- The alias-routing WebDAV mock rewrites request, Destination and tagged If URLs
  to the same real key while preserving the caller's PROPFIND href. Its existing
  COPY implementation deletes the target before enumerating the source. A
  successful response therefore loses the source despite source and destination
  ETag checks. Pairwise authority rejects before content/mutation. **This is a
  deliberately alias-unsafe mock/gateway counterexample, not evidence that a
  conforming real server must or commonly does lose sources.**

RFC 4918 describes COPY overwrite and a possible same-resource 403; it does not
give the client this stronger local pre-acquisition ordering contract [P3].
Server COPY support and destination locks/ETags cannot certify arbitrary client
alias relationships. A COPY response is not pairwise identity negotiation.

## Core `mv` requirements for Curie

Keep native same-authority rename distinct from an EXDEV copy/delete fallback.
For any fallback, source removal MUST be unreachable on alias/no-op, unknown
existing identity, incomplete/failed/partial copy, or cancellation. Only a
completed copy between known distinct entries, or successful true exclusive
creation of an absent destination, may produce a local success receipt permitting
the later remove. A bare `copyFile(): Promise<void>` returning successfully on
self-copy is not that receipt. `mv -n` skips must not produce one either.

Order: validate/resolve -> prove -> finish copy -> check cancellation -> remove.
Do not delete/retry/force away the destination to manufacture success. Preserve
source on copy failure; surface partial destination state honestly. If remove
fails, report failure with the completed destination and surviving source; do
not roll back a destination that might already have changed independently.

Generic `FsOptions`/`rm` has no incarnation condition. The bounded ABA test
replaces the source after successful copy: later pathname `rm` deletes the
replacement. A second stat narrows a window but cannot close it. ETags and equal
bytes do not repair incarnation identity. A genuine conditional delete/native
transaction would need provider-specific support; do not imply it is supplied
by this seam. The test characterizes the limit, not acceptable race-safe move.

## Supported workflows and remaining unknowns

| Default behavior after proposed owner integration | Result |
| --- | --- |
| Complete truthful native tuples | Existing copy guards retained; distinct copies work |
| Owner-built S3 mock/factory views with shared mapping | Same-view and cross-view existing distinct-key copies work |
| Recognized WebDAV resource-id/provider-authority views | Same-view and cross-view existing distinct-resource copies work |
| Repeated mounts/transparent source wrappers | Resolve actual views and retain authority/policy |
| Unrecognized peer, unknown existing target | No overwrite; `ENOTSUP` before body IO |
| Unknown but missing target, true exclusive primitive available | Create-only copy works; raced target rejected |
| Unknown missing target without exclusive support | Unsupported; no unsafe overwrite fallback |
| Different authority objects without disjoint evidence | Unknown, including different protocols/providers |

Qualified factories/protocol discovery should install comparison automatically,
not require users to set a safety boolean. The universal claim "arbitrary opaque
providers with possibly overlapping storage always support existing-target copy"
is not implementable from the current information. That limitation does not
justify withholding the concrete qualified positive workflows above.

## Provenance, reproduction and acceptance boundaries

- Authoritative Markdown: `fa539de:src/contracts/filesystem.md`, SHA-256
  `13d82a1a15d9b86370cd54c904608e8eed37da63e5ce05e754dc6e53f0ff821e`.
  The runner verifies this against each captured source tree.
- Frozen source: `4fa4ba9502dac843bd13aa5031d128a3171f597d`; source-set SHA-256
  `f6e964730116858bbcbd7ce6f92949bf2657492095689d95fc81934c998f3759`.
- Final proof source SHA-256: `proposal.ts`
  `6ad8f0c2ac374b8111e75f0ba3a4af25bca171ef0938cac05f5c34d29733f386`;
  `authority.test.ts`
  `057d277547da6733b49ee82148fadf39c5b3c986256c6c54bec04c326bec8882`.
- `evidence/pinned-reviewed`: capture at `2026-08-27T00:20:24.001Z`, 29/29,
  scoped typecheck exit 0. Source archive SHA-256
  `2cb5b02d9d2fa802fba6b20ff3986b7a76f1026d29528c5781bb3c81cb96f87b`.
- `evidence/worktree-reviewed`: capture at `2026-08-27T00:20:28.332Z`, observed
  HEAD `7d0fe7b45578cfc3836e9a8d6a5fd4a4d5e9edd3`, 29/29, scoped typecheck exit 0.
  Source-set SHA-256
  `fa5a096cf04f48420c0d1aa0d1fe88ba5ba0a4cd35224bf613b2a696c4945923`.
  S3/WebDAV, identity helper and contracts match frozen source; mount index and
  README differ, as do concurrent command/shell/root files. Every difference is
  enumerated in the manifest. Tests call remote backends/prototype directly;
  they do **not** validate the concurrent mount traversal or core cp/mv changes.
  This is not clean committed-HEAD validation or a claim about later worktree state.
- Initial interactive development: 23/25 passed; two harness errors were fixed
  (tagged If alias URL not rewritten; assuming memory scope was object rather
  than symbol). `evidence/preliminary` then records 25/25, but its runner failed
  parsing TAP-escaped JSON before typechecking/manifest completion. The runner now
  uses base64 observations. `pinned-final` and `worktree-final` retain earlier
  29/29 captures; `*-reviewed` additionally use the explicit cancellation check
  between peer queries. No iterations are added together as unique coverage.
- `evidence/integrity.json` hashes immutable prior proposal, positive-verifier,
  fixed-identity evidence and the original copy-guard test files, checking them
  against `d799cbb`. Active positive-review runner/report/test files are recorded
  separately with their observed deltas, not asserted immutable. The first audit
  stopped when that reviewer's runner had changed from SHA-256
  `eb01a17f938571a92460d4d60ada5af679755c67c8036985a2ff2621a5fb9790` to
  `080c13191455093bf5b4907c9f0b9ecfc39fe4a6acdcbb0e28fc8e2f02970893`.
  No other worker's changes were reverted or edited. The revised audit checks
  frozen raw evidence independently. It also hashes this review's generated evidence. No historical
  expectation was edited or reclassified. Original3 + required38 safety remains
  a mandatory **separate integration gate**, not claimed rerun/passed here.

Run from repository root, with installed development tooling:

```sh
node tests/fs/mount/identity-authority-review/run.mjs pinned NEW-LABEL
node tests/fs/mount/identity-authority-review/run.mjs worktree OTHER-NEW-LABEL
node tests/fs/mount/identity-authority-review/audit.mjs
```

Use lowercase labels; existing evidence directories cannot be overwritten. The
runner freezes source and mock inputs inside this owned tree, records raw TAP,
decoded observations, hashes, typecheck output and source archives. It compares
the current capture with 4fa and checks for changes during capture; an instant
atomic worktree snapshot is not claimed. Final runs remove their own scratch
tree. To replay an archive, extract it under a new owned `.runs/` directory and
copy the adjacent frozen `proposal.ts.txt`/`authority.test.ts.txt` back to their
original relative names, then run the recorded node command from that root.

## Primary protocol references

Browsed only to settle protocol facts; no source-repository facts were inferred
from the web. Consulted August 27, 2026 UTC. Summaries, not long quotations:

- **[P1]** AWS, *Naming Amazon S3 objects*: key uniqueness within a bucket and
  effective prefixes. `https://docs.aws.amazon.com/AmazonS3/latest/userguide/object-keys.html`
- **[P2]** AWS, *CopyObject*, request syntax / If-Match / If-None-Match / response:
  destination conditions exist in the current API; successful HTTP status alone
  is not proof the copy completed. Transport implementations still need their
  documented capability and completion validation.
  `https://docs.aws.amazon.com/AmazonS3/latest/API/API_CopyObject.html`
- **[P3]** RFC 4918 sections 5.1, 9.8.1, 9.8.4, 9.8.5: aliases, COPY semantics,
  Overwrite F and possible same-resource 403.
  `https://www.rfc-editor.org/rfc/rfc4918.html`
- **[P4]** RFC 5842 sections 2.7, 3 and 3.1: binding identity, permanent unique
  resource-id values and explicit property discovery; Experimental extension.
  `https://www.rfc-editor.org/rfc/rfc5842.html`
