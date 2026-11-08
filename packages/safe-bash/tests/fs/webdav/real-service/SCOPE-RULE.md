# Contradictory recognized lock scope: bounded author fix

August 27, 2026. Requested baseline `9c85c63d2797e8c8686037ccc8c1a2802bfe32d7`.
Its WebDAV source is byte-identical to Curie's `e8acecc3a843642ca83127d43d8c65ea46c2c0e4`.
The independent subtree at `6e0ff0b` is read-only and unchanged. `scope-replay.mjs`
invokes its original runner with an explicit source revision and a fresh outside
output; only captured evidence is copied into this author's subtree.

## First red evidence, before editing source

`evidence/scope-before/capture/apache/independent.json` reproduces all three
original mutations unchanged: exclusive+shared and shared+exclusive COPY reach
204 and replace OLD; mixed-scope MOVE reaches 204, replaces OLD and removes its
source. Apache is 28/31 and WsgiDAV 29/31. These are mutations of genuine acquired
grants with correct Content-Length and real token/status/URL retained, **not**
Apache-emitted malformed scopes or proof its actual lock was shared.

`lock-scope.test.ts` reduces the same three failures using a captured real Apache
grant. Before the source edit it is 25/28, with exactly those three failing.
After the one-line guard it is 28/28. The other 25 cases already passed before:
recognized shared-only/missing-write refusal; duplicate activelock, discovery,
scope, exclusive, type, write, depth, token, href and timeout rejection; and
valid default COPY/MOVE with unfamiliar extension children. Each rejected valid
token grant is checked for typed failure, unchanged bytes/names, no transfer and
exactly one finally-UNLOCK. Original unit inputs and source hashes are preserved
under `scope-unit-before`; the candidate records are separate.

## Normative rule and exact change

RFC4918 14.13 and RFC2518 12.7 define DAV:lockscope as the alternative exclusive
or shared, not both. Existing `davChild(scope, "exclusive")` already enforces
unique recognized exclusive cardinality but ignored a recognized shared sibling.
The new check rejects presence of that direct DAV:shared child, using the same
namespace-aware unique-child helper. Both mixed orders fail ENOTSUP before the
transfer and the original finally block releases the acquired token.

RFC4918 14.15 and RFC2518 12.8 define the recognized write lock type. Existing
write-presence/unique-child validation stays unchanged. RFC4918 section17 requires
unknown extensions to be ignored, including unexpected children in a familiar
element. DAV:read is not a defined opposing type. A write+read response, foreign
shared sibling, unknown scope child or shared descendant inside an unfamiliar
extension must not be rejected merely because of that extension. The new positive
tests preserve these distinctions. No strict whole-child whitelist is added.
Fresh official RFC text hashes and schema/extension excerpts are retained in
`evidence/scope-primary/sources.json`; `scope-primary.mjs` reproduces that capture.

No other product change is justified by the neighboring regressions: all already
reject duplicate/multiple recognized grants, fields and tokens. There is no
change to legacy absent-only lockroot, protected write semantics, URL/origin/root,
status/token/depth/finite timeout checks, callback precedence, timestamp checking,
late cancellation or cleanup. No contract, exports, permissions, rmdir, directory
marker, other filesystem or dependency changes.

Candidate validation retains the unchanged 564 WebDAV, 23 legacy LOCK, 23 direct
authority, five timestamp, 49 historical alias and separately repeated 14
constructor fixtures; all pass, as do scoped strict types and isolated build.
Fresh committed-source real replay and independent handoff are recorded separately
in the scope checkpoint report. This is source-author evidence, not final Curie
acceptance or a new WsgiDAV support claim.
