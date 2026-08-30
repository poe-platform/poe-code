# Independent directory access freeze Specification v1

Status: Proposed acceptance cases; PRECODE freeze only.

Implemented Through: Not applicable

Purpose: Freeze independent, bounded expectations under ROOT's approved policy;
this is not a competing policy or a claim that the feature is implemented.

## Problem Statement

Await ROOT-routed candidate. No source approval,
provider execution, author-profile replay, native oracle, network, service, Shell
execution or cd-runtime approval belongs to this freeze. All future protocol cases
here use an **injected mock**, not an actual WebDAV service. Actual service is
unavailable/not run. A future source review and moved-fixture execution need a
separately routed immutable candidate; later cd-runtime review is separate.

## Goals and Non-Goals

Freeze exact public inputs, outcomes, request order and mock resource accounting.
Do not implement, approve source, generalize to actual services, or change cd.

## Normative Language

MUST and MUST NOT denote conformance-critical requirements in this bounded
freeze. The candidate MUST satisfy the resolved decision table and exact cases;
it MUST NOT reinterpret success as a remote authorization guarantee. Requirements
are future expectations, not implementation observations.

## Authority and identity

ROOT approved directory modes 1/5 for logical-cwd navigation, permissions:false,
no new capability, preserved write/file refusals, mode/cancellation ordering,
and private raw-input limits. This does not reopen that meaning.

The request calls `603ba337` the policy commit. Authenticated full identity
`603ba3371736373316e419c2327bc68c4d96dba9` actually introduces the author's preseal,
API/profile harness and baseline expectations; POLICY-PROPOSAL.md is absent there.
Its authenticated direct child `6bd3a0d98d3043c14ed0fa80dedb36b72b65d9e5` introduces
POLICY-PROPOSAL.md and original observations. The policy was read from that child
first, before accepted provider-body inspection. These are not interchangeable
proposal versions. Original bytes are protected by MANIFEST.json, not rewritten.

The first static seal attempt correctly rejected additional author-directory
membership: ROOT-ACCEPTANCE.md. That document was already committed in initial
HEAD `0a7e062806537c1bcca3bdeece47e357a302e4b0`, not newly created by this reviewer
or evidence of a concurrent provider change. It records unchanged D1–D4 approval
and the implementation hold. Its full commit and bytes are separately bound;
the original proposal tree is not relabeled as containing it. The preliminary
membership failure is preserved in VALIDATION.json, not called a product failure.

The author's FREEZE.json explicitly names accepted baseline
`5137a74ec855a32d8a8860eb66b62eb44d11e290`; no short-prefix inference is used.
All seven declared baseline input hashes were checked against that commit, live
files and index **before** inspecting accepted provider bodies. Inspection then
covered accepted webdav.ts request/stat/readdir/access and normalization/parser
boundaries, accepted readonly access, public types, docs and existing author
fixture constructors. No prospective implementation was searched for or read.
Hashing xml.ts and shell/runtime.ts is not a claim to have inspected their bodies.

Chronology is relative to the inspected baseline and any future ROOT-routed
candidate: declared provider inputs remain baseline at this freeze's checks.
This cannot prove that no author has private/unrouted edits elsewhere. UTC
timestamps and exposed/protected-input hashes are in MANIFEST.json and
VALIDATION.json. The directory's 20260828 date does not change local August 27
chronology when the UTC capture falls before midnight America/Chicago.

## Normative decision table

1. Validate integer mode 0..7 FIRST. Reject invalid mode as FsError EINVAL,
   including when caller is aborted; zero transport work.
2. Direct provider: a valid already-aborted real AbortSignal selects typed
   ECANCELED before write/type/path checks; zero transport work. For the unchanged
   readonly wrapper, invalid mode still wins, but valid W_OK selects EROFS before
   delegation even if aborted. This intentional exception is not a contradiction.
3. Direct provider modes 2/3/6/7 select ENOTSUP without stat, path-cap scanning or
   transport. Modes 1/5 delegate normally through readonly, retaining its flags.
4. For modes 1/5 only, scan the original string incrementally before normalization,
   splitting or requests: at most 65,536 UTF-8 bytes and 256 nonempty slash-separated
   input components, inclusive. Slashes contribute bytes. Repeated slashes do not
   contribute components; `.` and `..` DO count even if later removed. UTF-8, not
   UTF-16 length or URL-encoded length; no Unicode normalization. Exceeding either
   limit gives ENAMETOOLONG and zero requests. Existing path validation remains:
   small NUL/backslash/unpaired-surrogate inputs EINVAL; root escape EACCES.
   Mixed malformed-and-oversized strings are deliberately not acceptance cases.
5. Obtain a fresh existing stat of the requested path on each 1/5 invocation.
   Successful supported directory metadata permits logical navigation NOW only.
   Successful file metadata gives ENOTSUP; a directory-required suffix on a file
   gives existing ENOTDIR first. No GET for file X_OK and no advisory-mode inference.
6. For 5, only after supported directory stat, perform existing depth-one readdir.
   Require successful self/directory/member parsing. Denied listing EACCES,
   replacement self-file ENOTDIR, unknown child/pagination ENOTSUP remain failures.
   Do not impose inode/resource-id equality or an unprovided transaction: two
   successful collection observations can concern a replaced collection. No
   guarantee about the resource between or after these observations follows.
7. Check caller after awaited phases and before success; do not admit a later
   phase after cancellation. Preserve typed active ECANCELED, request ETIMEDOUT,
   EIO for unrelated transport failure, and existing specific FsErrors. Do not
   compare thrown value to raw abort reason or promise arbitrary preemption.

Modes 0/4 keep existence/read semantics and existing limits; no new path cap is
authorized for them. Constructor capabilities and root exports remain unchanged.
`permissions:false` explicitly disclaims generic POSIX permission introspection.
Directory specialization must be documented as such, not advertised as remote
search, ACL traverse, listing, child, GET/PUT, future permission or secure storage.

## What fresh namespace evidence means

The configured transport and namespace are trusted host bindings, not a proof
against malicious injected JavaScript. HTTP207 alone is insufficient. Use the
existing named-property Depth0 operation, response path confinement, unique self,
supported DAV:resourcetype and existing parsing/status rules. Separate denied
optional properties do not negate a successful required collection type. Unknown
extension types remain ENOTSUP. No authentication is inferred from a header;
anonymous explicitly configured metadata success can suffice.

Existing href binding compares decoded normalized namespace paths: `/dav/docs`
and `/dav/%64ocs/` can identify the same self and therefore duplicate together.
This is NOT permission to follow an alternate-encoding redirect. Only the exact
requested URL plus one slash may be followed once; method/body/headers/deadline
stay the same and the first body is cancelled. A changed final resource URL is
EACCES; cross-root/origin/ambiguous separator hrefs never establish self identity.
Scope here is lexical/protocol identity, not an ACL/ABA/cryptographic assertion.

Mode1 ordinarily issues one Depth0 request (two with permitted slash retry).
Mode5 then adds one Depth1 request, normally two/three total. ENOENT stat may probe
ancestors from shallowest to deepest, retaining ENOTDIR and denial precedence;
it never retries the target just because it appeared during those probes.
At 256 input components: target plus at most 255 ancestors, each allowing one
slash retry, gives at most 512 requests on that failure path. Successful mode5
does not also take that path; 513 is only a loose non-tight bound, not an allowance
to add an unexplained request. Q-maximal-lookup fixes the 512-request trace.
XML/entries/request deadlines remain per-response/per-request, not shared totals.
Caller cancellation is the full-operation bound; synchronous parsing is not
arbitrarily preemptible. No new lock, mutation, cache or comparison lookup occurs.

## Resolved clarifications and exclusions

- Readonly write-vs-abort precedence is intentionally different from direct
  provider precedence; both are frozen explicitly, including invalid modes.
- Href equivalence and exact redirect target policy are distinct, not contradictory.
- Successful metadata may coexist with denied listing, later child or revoked
  metadata. Cases assert those limits rather than relabeling them permissions.
- Public FsOptions.signal is optional AbortSignal, but with exact optional types
  explicitly undefined is NOT a typed member value. Omission is supported.
  Malformed signal objects, null paths and non-string paths are type-negative
  inputs, not invented runtime FsError promises. Invalid numeric modes remain
  type-valid number inputs and require runtime EINVAL; string/null modes are
  explicitly JavaScript-only runtime validation controls.
- No unresolved contradiction blocks this resolved subset. Mixed invalid-path/
  overflow ordering, malformed-signal runtime behavior and unsupported host
  response counterfeits are outside acceptance here, not silently approved.
  Author must route a contract question before relying on different semantics
  for the covered cases. No pending abstract case is counted as frozen acceptance.

## cd regression boundary

G-logical-cwd-plain/readonly are provider-contract fixtures: logical directory X_OK
can succeed while a child stat is denied; there is no Shell instantiation. Future
integration must preserve existing plain/readonly `cd /docs; pwd` success on
truthful collection metadata, without requiring listing or claiming remote search.
Any future runtime using X_OK must preserve state on denial/cancel, and maintain
its own root-caller/control-error precedence. These are future integration
invariants only. No cd change, runnable cd test or source authorization is implied.

## Evidence boundaries

The author's 30 baseline profiles, 41 outcomes and 35 injected requests remain
author-reported baseline observations, NOT implementation passes. They are not
summed into, replayed, rescored or replaced by this independent case inventory.
This freeze's static validation is not a provider test or service acceptance.
After the explicit owned-path commit, stop and await ROOT's candidate route.

## Test and Validation Matrix

| Requirement | Independent fixture IDs | Evidence state |
| --- | --- | --- |
| Fresh logical metadata, no permission extrapolation | N01–N05 | Frozen, not run |
| Namespace, required/optional type, malformed/denial mapping | M-*, T-* | Frozen, not run |
| Mode/abort/write/readonly precedence | O-* | Frozen, not run |
| Mode5 listing and replacement races | R-* | Frozen, not run |
| Raw input and response bounds | P-*, B-*, L-* | Frozen, not run |
| Ancestor ordering and maximal work | Q-* | Frozen, not run |
| Await checkpoints, typed failure and controlled cleanup | C-* | Frozen, not run |
| Read regression and provider logical-cwd compatibility | G-* | Frozen, not run |
| Public API types, case schema and input integrity | validate.mjs | Static only |

## Conformance Criteria

A later routed candidate needs independent source review and execution of the
resolved frozen cases, with exact mock qualification and resource evidence.
Static freeze validation alone MUST NOT be treated as candidate conformance.
Actual-service and cd-runtime acceptance remain separate, unavailable/held here.
