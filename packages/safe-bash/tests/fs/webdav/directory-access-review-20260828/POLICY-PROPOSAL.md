# WebDAV directory X_OK: root decision proposal, not implementation

## Recommendation and precise meaning

Approve a **default provider-owned virtual-navigation policy**, not a POSIX
execute/search permission assertion. With `capabilities.permissions === false`,
directory `access(path, X_OK)` means only:

> A fresh, namespace-bound metadata request through this adapter's configured
> transport identified a supported collection, so this virtual filesystem
> permits using that collection as a logical navigation base now.

This does **not** mean the server granted a remote ACL traverse privilege,
parent search permission, listing access, child access, content access, write
permission, or later access. It is not a security check for server-side effects.
The same credentials/request policy still authorize each later operation at
its actual endpoint. No mode inference, host UID check, credential discovery,
OPTIONS capability guess, ACL query, private identity or network-policy change.

Success can be anonymous if the explicitly configured server permits metadata;
presence of an Authorization header does not prove authentication. “Authenticated
stat” must mean only that the configured request passed its actual server policy,
not that a header, 207 status or resourcetype proves broader ACL rights. An injected
transport remains trusted to implement the configured namespace/protocol. No
cryptographic proof against malicious host JavaScript is added or promised.

**No new public capability is needed for this meaning.** The existing filesystem
contract already allows virtual directory X_OK on non-permission backends.
Keep `permissions:false`, all other capabilities, stat metadata, compareEntry,
identity/alias handling and readonly routing unchanged. A new flag saying
“traversal proven” would be misleading unless backed by a different explicit
server/host authorization contract. Such a stronger profile is unnecessary for
logical cd and is not proposed in this patch.

## Normative basis, and what it does not establish

- RFC4918 section9.1: PROPFIND returns requested resource properties and, depending
  on Depth, possibly members. Depth0 does not test listing or each child URL.
  Section9.1.2 gives individual propstat failures; HTTP207 alone is not success.
- RFC4918 section15.9: resourcetype identifies the nature of the resource. It is
  not an ACL grant or a representation of POSIX mode/search authorization.
- RFC3744 section3.1 defines DAV:read, encompassing GET/PROPFIND and finer-grained
  privileges aggregated beneath it. The converse is not established: one
  successful PROPFIND does not demonstrate that the whole DAV:read aggregate
  was granted, much less permissions for members or future operations.
- RFC3744 sections3.7/5.4: current-user-privilege-set is a separately protected
  property. Requiring it would impose an ACL-extension/profile prerequisite and
  can itself be denied. There is no portable POSIX execute/search bit among the
  predefined DAV privileges. Querying that property does not create one.

Primary response hashes and excerpts are preserved in `primary.json` and
`primary-v2.json`: RFC4918 SHA256
`619ad705b4c0e26af2d0652bb48ca1fa9bd080546993d46730d604b9fe2bdf25`,
RFC3744 SHA256
`7b6caed842bce2e2c8278aba5bce6a027dd2b2a0a718301d8c7f7069236f7959`.
The initial nonexistent RFC3744 section3.1.1 selection failure is retained, not
erased. RFC section3.1 is the actual read privilege section.

## Exact root choices before source authorization

| Decision | Recommended policy | Alternative and cost |
| --- | --- | --- |
| D1 default meaning | Fresh supported collection stat suffices **only for logical navigation** under the declared provider policy; no new option/capability. | Require a new explicit host/server authorization capability for genuine ACL traversal. This is a different feature, leaves ordinary stock DAV cd blocked and requires a defined server privilege/binding contract. |
| D2 mode combinations | Modes1 and5 gain directory support; mode5 additionally performs the existing directory R_OK listing probe. Modes containing W_OK remain ENOTSUP; readonly wrapper keeps EROFS precedence for its write modes. Non-directory X_OK remains ENOTSUP, not synthetic success/EACCES. | Limit this change to mode1, preserving5 as ENOTSUP. Smaller surface but incomplete bit-combination support; do not imply R_OK+X_OK works. |
| D3 cancellation | Validate integer mode0..7 first; then for valid modes select already-aborted caller as typed ECANCELED before unsupported-mode/type success. Check caller again after each awaited access phase and before success. Reuse current request cancellation/timeout mapping. | Retain preaborted X_OK ENOTSUP: preserves old observation but violates the intended cancellation-aware new traversal check. Not recommended. |
| D4 private bounds | For newly supported X-bearing modes1/5 only, bound path to64KiB UTF8 and256 nonempty input components, checked incrementally before normalization/splitting/provider work. Exceeding either gives ENAMETOOLONG; existing F_OK/R_OK/W_OK paths unchanged. Reuse per-response XML/entry/time limits. | Reuse unbounded input-path stat behavior with explicit input-dependent request count. Smaller diff but no fixed path/ancestor-work cap at the public access boundary. |

D2–D4 are explicit choices for root; no production implementation has begun.
The directory stack and runtime remain held regardless of this design's scoped
observations. D4 is a proposed new **private** bound, not a previously approved
public limit or a claim about current behavior. Root may choose another concrete
bound before the author fixture freeze.

## Request sequence and error precedence

1. Integer mode0..7 validation, EINVAL without requests. For valid modes, an
   already-aborted caller returns typed ECANCELED without transport admission.
   Preserve the FS typed-error API; do not promise exact abort reason rejection.
2. Any W_OK bit: existing provider ENOTSUP without requests. The readonly wrapper
   is unchanged: it selects EROFS before delegation for W_OK; no wrapper-wide
   cancellation reorder is bundled. Modes1/5 are delegated normally through it.
3. Newly supported modes1/5: bounded input scan, then fresh existing `stat(path,
   options)`. No reuse of a previous caller stat/cache/weak map as permission.
   The normalized namespace-relative path, explicit trailing slash/type rules,
   same-origin confinement and returned href/type parsing remain unchanged.
4. A successful supported directory permits X_OK logically. A successful regular
   file still fails ENOTSUP; there is no remote executable profile. A file with
   a directory-required suffix retains ENOTDIR; unknown type stays ENOTSUP.
5. For mode5, require directory R_OK as well: the existing depth-one readdir
   operation must succeed; a denied/incomplete/unknown listing is not waived.
   For mode1 do **not** GET, list, resolve children or probe mutations. Modes0/4
   retain their existing existence/read semantics.
6. Check caller after awaits/before success. No retries, mutation, rollback,
   policy cache, lock acquisition or privilege escalation. Runtime later must
   still enforce its own caller-error precedence and checked state updates.

Successful directory X_OK ordinarily sends one named-property PROPFIND Depth0
with existing XML body, configured copied headers, Cache-Control:no-cache,
credentials:omit, redirect:manual and linked caller/deadline signal. A permitted
exact trailing-slash canonicalization may send a second Depth0 request using the
same deadline; cancel the first body. No added host, scheme, query, resource,
alternate encoding or general redirect is allowed. `access` does not broaden
that existing narrow policy, even if another endpoint also returns a collection.

`stat` may issue ancestor Depth0 probes **after ENOENT only**, to preserve an
ENOTDIR distinction. With at most256 input components, at most256 logical stat
requests (target plus255 ancestors), each allowing one canonical slash retry:
at most512 HTTP requests. Ordinary success is1 or2. Mode5 adds at most one
Depth1 request after success (readdir addresses a slash-terminated collection),
so successful mode5 is normally2 or3 HTTP requests. The failure-path upper bound
512 and successful-path bound3 do not occur cumulatively; use513 as a loose
per-call upper bound if a simple conservative bound is needed.

Each request already limits XML bytes (default2MiB), returned entries
(default10,000), XML nodes/attributes relative to maxXmlBytes, and request time
(default30s). These are existing configurable per-request limits, not a new
global deadline or total-byte cap. Ancestor requests have separate deadlines;
caller AbortSignal remains the way to bound the full operation. No claim of
instant synchronous XML-parser preemption, aborting arbitrary host work, or
permission stability between requests. The private path cap bounds input scans
and ancestor-count growth; asynchronous requests remain sequential.

### Required metadata/status mapping

| Observation | Required result, no successful navigation |
| --- | --- |
| HTTP401/403 or denied required resourcetype propstat | EACCES; no fallback to advisory modes or prior metadata. |
| HTTP404/410 | Existing ENOENT, including existing ancestor-file ENOTDIR refinement; do not infer nonexistence from a denial. |
| Required resourcetype missing/404, unsupported resource type, pagination | Existing ENOTSUP. |
| HTTP405/501 | Existing ENOTSUP; no OPTIONS/GET substitution. |
| HTTP423 | Existing EBUSY, not a success or automatic retry. |
| HTTP429/503 or conditional412 | Existing EAGAIN; not automatic retry. |
| HTTP408/504 or adapter deadline | Existing ETIMEDOUT. Caller aborted at settlement retains ECANCELED precedence. |
| HTTP413/414/507 | Existing EFBIG/ENAMETOOLONG/ENOSPC respectively. |
| Malformed XML/status, duplicate/missing self, invalid required values, unexpected success status/transport failure | Existing EIO, unless the lower layer already produced a more specific typed error. |
| Cross-scope href/changed final URL/unsafe redirect; extra member in Depth0 | Existing scope/error classification, generally EACCES; never widen authorization. |
| XML/entry limits | Existing EFBIG. |
| Successful file stat | X-bearing modes ENOTSUP; directory-required trailing slash retains ENOTDIR first. |

HTTP207 is only the envelope. Required self/propstat/type checks must pass. An
optional property denied separately (for example getetag403) is not a denial of
the collection itself and currently does not prevent a valid stat. Preserve
that distinction; do not call it proof that all properties are readable. Parsed
stat defaults such as timestamps/mode do not contribute to authorization.

RFC4918 permits extension type identifiers alongside collection. The current
parser rejects them with ENOTSUP (P29); this is an existing stricter profile,
not a standards requirement or permission denial. Preserve it in this bounded
access change rather than silently broadening unknown-type handling.

## Cancellation and cleanup boundaries

Current requestStream maps preabort/active caller abort to typed ECANCELED,
timeout to ETIMEDOUT, and unrelated transport/body failures to EIO. Caller abort
wins an observed request error at catch time. Active cause retains the supplied
reason when that reason caused the rejection; preabort need not have a cause.
Do not change the whole provider to raw-reason rejection. Before returning new
access success, repeat the caller check so a fulfilled-await cancellation is
not hidden by a directory result. A past resolved success is not reopened.

Existing late-fetch logic observes late rejection and best-effort cancels an
unlocked late response body. XML readers cancel and release their reader locks.
Cleanup is not an awaited guarantee for arbitrary signal-ignoring transports;
ignored external work may outlive outward settlement. The finite fixture's
late producers are explicitly awaited in evidence, not credited as a new
provider resource barrier. Never dispatch further access phases after abort.

## Actual bounded evidence and implementation handoff

Freeze `603ba3371736373316e419c2327bc68c4d96dba9` precedes all new provider calls.
**30/30 baseline profiles matched**, comprising41 method outcomes and35 injected
protocol requests. This includes two successful existing cd runs (plain and
readonly), not a new directory-X_OK positive. No current access1 success exists.

- P01/P22: cd succeeds after metadata; X_OK still ENOTSUP. Readonly W_OK remains
  EROFS without a request, independent of its underlying traversal profile.
- P02/P03: a valid collection self stat coexists with later Depth1 or child
  HTTP403/EACCES. This demonstrates why a self response cannot be labeled proof
  of those operations; these are declared synthetic protocol responses, not
  newly observed behavior of a particular stock server/ACL implementation.
- P04–15/P20–21/P24–29 retain existing denial, missing/type, malformed, scope,
  canonical redirect, byte/entry limits, optional-property and unknown rules.
- P16: preaborted stat gives ECANCELED, but current preaborted access1 returns
  ENOTSUP. The proposed correction is an explicit new failure-precedence delta.
- P17/P19: caller-aborted/deadline fetches settle, both late responses arrive
  once and their unlocked bodies are cancelled once; fixture timers awaited.
- P18: one body pull, one cancellation, released reader lock, ECANCELED with
  exact cause. P30: two pulls then EIO with exact late-body-error cause.

All846 packed entries authenticated before/after from accepted5137 full package
SHA256 `13fe54de1cf900d587855e276375fdf72ed1ed0d0e0625cf7ef00730f2bb74c9`.
Actual package-root import only; no live-src fallback or original MockDav edits.
Source hashes before/after match the fixed accepted inputs. One tar child closed,
two Shells disposed, all controlled fixture delays settled, no retained response
reader locks, one task root removed. No sockets/server children/private paths,
dependency install, runtime/provider writes, type/build or new native execution.

Raw compressed evidence SHA256:
`d6090214a7969816c339f4981c72b41b787686b36df9e115ec292b2a3435f283`.
Data-only verification: `node tests/fs/webdav/directory-access-review-20260828/verify.mjs`.
Prior Apache/WsgiDAV auth/native profiles, all cd28 and directory-stack0/34
observations remain unchanged; no original failure is reclassified as a pass.

If D1–D4 are approved, the smallest author write set is
`src/fs/webdav/webdav.ts` access implementation/private validation only,
`src/fs/webdav/README.md` access policy, and new scoped provider access tests.
No shared contract/capability/root export change is required for D1. New source
must receive different review, including configured real-service auth/denial,
plain/readonly cd compatibility, all mode combinations and resource/abort guards.
Only after that accepted prerequisite should runtime-only CDPATH/X_OK work resume.
