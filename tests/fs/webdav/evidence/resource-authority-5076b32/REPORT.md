# WebDAV resource authority: safe owned checkpoint

August 27, 2026. Scope: WebDAV source and backend tests only. No independent
compatibility assertions, contracts, mount, core, other backends or historic
evidence changed. This is partial positive acceptance, not FS/alias closure.

## Actual result

| Cohort | Baseline | Candidate pinned |
| --- | --- | --- |
| Existing WebDAV tests | 324/324 | 324/324 (within all357) |
| New resource-authority regressions | absent | 33/33 |
| All WebDAV tests | 324/324 | 357/357 |
| Original unchanged WebDAV selection | 10/15 | 13/15 |
| Selected WebDAV conformance | not run | 52/52 (50 backend + 2 provenance) |
| Strict scoped TypeScript | not run | exit0 |

Original selection contains 14 required positives and one alias-rejection control:
positive acceptance improves 9/14 to12/14; alias control remains1/1. Three newly
passing cases: one-mount existing-target WebDAV copy, separate-client existing
copy, separate-client existing-target cross-mount mv. The remaining two required
reds are memory-to-WebDAV and WebDAV-to-memory existing-target copies. They remain
unknown before content/mutation; no expectation relaxation or skip. Denominators
are separate and overlapping; do not sum33+357. All executed tests have zero
skips/cancellations/TODOs. Full original38/43/53 acceptance was not rerun here.

## Fixed inputs and immutable history

Baseline: committed2cacd04614baaa6e95f8663b73ded023eafd2c19. Final pinned candidate:
committed3cf57d3c0f9642475c811249f34f6968f9dd5f4a plus ONLY owned WebDAV source and
backend-test overlay. No unowned working edits enter the pinned candidate.
Earlier inspection/candidate/final phases were explicitly moving source snapshots;
their provenance and replay deltas are preserved, not mislabeled committed runs.
Concurrent root changes mean baseline-to-candidate is a checkpoint comparison,
not an isolated attribution of the mv improvement to this leaf alone.

Each phase retains exact argv/status/stdout/stderr, before/after source hashes,
pin, runtime and input delta. Manifests stayed identical throughout all five
isolated runs. Existing tooling only (Node22.22.2, repository node_modules);
no runtime dependency added. Runner output and temporary work stayed in owned/tmp.

Original independent compatibility fixture SHA256:
`9d11741fd9b37757046c1278fdaa00c734633bfd9a1fc58ae479415c2f5a6734`.
Old MockDav SHA256:
`f46b18da28ed03b8096dc2b8a10fc0aba768947b9af5ebf0ebae602b289d8ce0`.
Candidate MockDav SHA256:
`e4f8a6806c1dd6f0622cce9f3b487f530011c39b7ca95cc2543002ce4da95266`.
Exact old mock, WebDAV source and compatibility fixture are retained under
original/. New inputs are recoverable from each recorded pin plus input.patch.
Historic4fa/59/9982 independent evidence remains in its original directories;
this baseline is a new capture, not a replacement for those observations.
The immutable ebe36d2 four-stress-red evidence is unchanged and outside this task.

## Intentional provider capability delta

The OWNED original MockDav provider now explicitly implements DAV:resource-id.
Actual private resource records survive PUT/MOVE and existing-target COPY;
creation/new-target COPY allocate identity, deletion retires it. Full protocol
IDs are UUID URIs, not ETags, client tokens or fabricated native inode/scopes.
Its public files collection remains an ordinary Map: no subclass representation
change. Nonenumerable configurable/writable lifecycle methods preserve prior
byte/namespace tests; all324 preexisting tests pass unchanged. The earlier reported
eight helper failures were external observations of an abandoned Map-subclass
draft, not silently altered expectations or claimed passing historical results.

Original compatibility inputs/assertions remain untouched and automatically gain
the actual provider property. This enables original WebDAV-only successes, not
just a newly capable standalone fixture. New loopback HTTP tests separately
exercise real serialized metadata without private Response provenance.

## Safety boundary and remaining root decision

RFC5842 is negotiated metadata authority for compliant WebDAV resources, not
proof of disjoint local storage. Resource UUID versus Memory/native inode is
never sufficient. Genuine PROPFIND Response provenance alone is also insufficient:
a custom transport may route GET/PUT into a local source alias. The preliminary
response-only draft was removed before this captured validation/commit following
the reviewer alert. No passing historical safety result is invented for it.

Private getOwnedWebDavEntry requires a validated stat bound to its filesystem/path,
the exact provider-owned full fetch mapping, actual storage/resource records,
unchanged Map operation references and unchanged adapter data methods. Exact
MockDav.fetch and MockDav.createFetch() qualify; arbitrary opaque wrappers do not.
The factory captures a qualified complete function, not one genuine response.
Registration is internal, not a public registry/trust flag/security sandbox for
malicious in-process code. Protocol identity remains separate from closed-store
proof. No reflection, client/protocol whitelist or generic different-store rule.

Two actual mixed-routing adversarial regressions forward genuine mock metadata
but map GET/PUT onto the Memory source. Both directions remain unknown, mounted
copy returns typed ENOTSUP, data-call count stays zero and exact original bytes
and namespace survive. Other controls cover aliases, denied/missing metadata,
invalid/conflicting properties, case bindings, exclusive creation, concurrent
target creation, cancellation including an ENOENT-shaped reason, and budgets.

ROOT decision needed: the original two mixed positive inputs use arbitrary
manual fetch forwarders. Approve an explicit input capability delta to the owned
provider's createFetch() factory (historical raw/hash retained, expectations
unchanged), and have the Memory owner recognize its actual closed backing store
against this qualified descriptor. Without both, required mixed reds remain.
This leaf neither edits that independent fixture nor adds the Memory callback.
Full helper/API handoff is retained alongside this report and in
/tmp/safe-bash-webdav-authority-handoff.txt.

## Protocol and limits

Primary basis: RFC5842 sections2.7/3.1, RFC4918 propstat/status processing. Explicit
Depth0 PROPFIND requests one DAV:resource-id; strict requested-href binding,
namespace/duplicate/conflict/status/URI validation uses existing bounded XML and
rooted transport handling. Missing property is unknown; missing resource,
authorization, malformed metadata, I/O and cancellation errors propagate. No
content GET, destination open, COPY/MOVE/PUT/DELETE, LOCK-null creation or arbitrary
resource-ID URL fetch occurs during comparison. One shared terminal callback
queries each recognized operand once without recursive negotiation.

Official sources: https://www.rfc-editor.org/rfc/rfc5842.html and
https://www.rfc-editor.org/rfc/rfc4918.html. This is an Experimental extension,
not automatic base WebDAV identity, generic live-provider certification, remote
authentication, transaction, ABA defense or snapshot. Safe empty-only remote
rmdir remains an honest gap; destructive recursive deletion is not a fallback.

## Replay

For each phase, archive its provenance pin using run.mjs's paths; apply that
phase's input.patch from the archive root (baseline has no delta), link existing
tooling, and execute exact phase.commands.json argv with strict rejections and
fresh TMPDIR. Verify manifest-before.json against the reconstructed inputs.
Original runner refuses an already-existing output directory. Raw runs and replay
patches are immutable evidence, not scripts that overwrite historical reports.
