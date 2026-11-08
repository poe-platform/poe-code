# WebDAV constructor comparison checkpoint

August 27, 2026. Owned changes only: src/fs/webdav and tests/fs/webdav.
No contracts/core/wrapper/other-adapter/independent-review edits. No new runtime
dependency, identity scope, global trust flag or public authority registry.

## Implemented API and agreed composition

WebDavFileSystemOptions.compareEntry derives parameters and return type directly
from the existing FileSystem.compareEntry contract, with compatible explicit
this: FileSystem. The public method remains the negotiation entrypoint. The
terminal dispatcher calls the selected callback with the actual backend receiver,
followed paths, resolved peer and signal. A late explicit method override selects
instead of that backend's constructor callback; each distinct operand runs once.

Complete scoped IDs retain the shared fast path without callbacks. Otherwise
callbacks run first: errors/cancellation propagate, invalid literals and mutually
conflicting explicit answers fail EIO. Built-in SAME + explicit distinct fails
EIO; built-in SAME + same/unknown returns same. If the built-in result is not
same, a supplied explicit aggregate wins, including unknown; without a supplied
callback the built-in result wins. Explicit unknown never revives fallback
distinctness. Built-in query errors and provider/protocol contradictions remain
observable. No content acquisition/mutation is added to comparison.

The reviewer correctly identified a source compatibility bug: the initial
candidate symmetrically rejected explicit same against fallback distinct. The
final source fixes this. Both original tests named "explicit WebDAV comparison
override remains authoritative subclass-before/instance-after" retain their
original same assertions, not EIO rebaselines. A new constructor same-vs-distinct
control proves the corresponding option path. Reviewer reports are preserved.

The ONLY remaining old assertion delta is the forwarding request count: four
normal metadata requests become six, adding two post-callback resource-ID queries
needed to retain built-in alias proof. The test still requires unknown, only
PROPFIND requests, exactly two resource-ID queries and no recursive negotiation.

## Isolated results and historical failures

| Phase | Owned compliant WebDAV | Original WebDAV subset | Conformance | Built public consumer | Build / scoped types / consumer types |
| --- | --- | --- | --- | --- | --- |
| baseline | 543/543 | 15/15 | 52/52 | Not present | Not run / 0 / not run |
| candidate | 552/555 | 15/15 | 52/52 | 11/12 | 0 / 0 / 0 |
| corrected (historical, NOT accepted) | 556/556 | 15/15 | 52/52 | 12/12 | 0 / 2 / 2 |
| final | 557/557 | 15/15 | 52/52 | 13/13 | 0 / 0 / 0 |

The candidate's three owned failures are the two legitimate same assertions and
the forwarding request-count assertion. Its built consumer failure was exact
stderr preservation on mv-to-remote: the new bounded HTTP fixture lacked the
adapter's timestamp PROPPATCH property. The corrected phase added that fixture
support, but improperly revised the two same assertions and called optional
utimes without a type guard. It is NOT acceptance, despite its runtime passes.
Final restores the original same assertions, fixes source composition, guards
the optional fixture method and adds constructor/public-built-resolution checks.
Every raw output and exact source overlay is retained; nothing is overwritten.

Separate noncompliant host-binding characterizations are 3/3 in each phase.
They deliberately reproduce contract-violating routing/source damage, NOT three
compliant preservation passes. Historical source-loss, original31/38 and
qualified38/38 evidence remains unchanged in prior directories/commits.

The unchanged original fixture subset is 14 WebDAV positives plus one alias
guard, not the full original43/positive38 gate. Its SHA-256 remains
9d11741fd9b37757046c1278fdaa00c734633bfd9a1fc58ae479415c2f5a6734.
No full-repository/all-filesystem suite or independent-review suite ran here.

## Built public consumer and limits

The typed example imports only public virtual-bash exports. Its application
resolver truthfully maps the HTTP gateway and recognized local view to their
actual backing filesystem/path and compares genuine scoped stat identities.
It does not import private Map/authority helpers. Unknown mappings stay unknown.
The fixture exposes the same actual Memory store via serialized loopback HTTP;
responses carry no private mock markers. Plain Node runs the emitted consumer
against isolated dist and checks import resolution points to dist/index.js.

Thirteen checks cover that resolution, four existing-target cp/mv transfers
(both directions), two overlapping alias controls, two absent-authority refusals,
EACCES/abort, builtin-alias contradiction, and complete-ID callback bypass.
Transfers assert exact binary output, namespace/source-removal effects and clean
stdout/stderr/status. Refusals assert typed boundary errors where applicable,
unchanged bytes, nonzero shell status and no GET/PUT/DELETE.

This is real serialized HTTP integration, not a commercial SDK/provider
certification. A host must genuinely know the mapping; URLs, clients, ETags and
protocol UUIDs alone do not prove separation from local stores. Generic providers
without a truthful resolver remain unknown. The fixture is bounded and lacks
LOCK/COPY/MOVE, persistence and ABA guarantees. No new backend breadth, rmdir
fallback, transaction, lease, atomic rename or snapshot guarantee is claimed.

## Reproduction and hashes

run.mjs records each pin, exact argv, status, timestamps, source/test manifests
before/after, and uses an isolated git archive plus ONLY the owned live overlay.
All phases include core0bee8e7. Final pin is
8cb42b8a68236b99417fbdc350d8fbdb13b0d215; concurrent unrelated commits are not
silently treated as that tested snapshot. Per-phase input.patch reproduces each
owned overlay against its recorded pin. Baseline originals are copied separately.
Use phase commands.json in a similarly isolated checkout; never shared dist.
Built artifact and source-tree digests are in checkpoint.json. SHA256SUMS covers
every sealed file except itself. Binary/non-newline originals, if any, are kept
losslessly base64-encoded with encoding recorded in encoded-files.json.

Final resource-id.ts SHA-256:
ee5720f77a352503368d672caaf5237e45863bde88cf69b947d14178fcda49f2
Final webdav.ts SHA-256:
36e9b5eb6f012df25bd5bb529d29716400f53a6ffa593d75b78f19f77c791b22
