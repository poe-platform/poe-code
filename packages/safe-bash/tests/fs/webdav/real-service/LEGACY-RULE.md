# Source-author rule: legacy LOCK grants

The original `a4c7824` matrices and evidence are immutable. In particular, Apache
14/17 and WsgiDAV 10/15 public positives are historical observations, not current
acceptance. This document records the proposed rule **before** source editing.

## Normative basis

RFC2518 section 8.10.1 specifies creation on the Request-URI and requires the new
grant's Lock-Token header and lockdiscovery response. Section 9.5 associates that
response token with the new grant. Its section 12.1 activelock grammar contains
scope, type, depth and optional owner/timeout/token, but **no lockroot element**.
Section 8.10.3 requires a provider to honor a resource's locks across aliases;
this is a provider obligation, not a new client identity assertion.

RFC4918 section 9.10.1 retains request-target binding and the required new-grant
header; section 14.12 describes lockroot as the URL used to address the LOCK
request. Its grammar adds lockroot while the description says servers SHOULD
include it. A strict RFC4918-only grammar was unnecessarily excluding a valid
RFC2518 response. We support the older grant form, without claiming that an
omitted field is a present, fully validated RFC4918 field.

Pinned Apache 2.4.66 `dav_lock_get_activelock` emits scope, type, depth, timeout
and token but no lockroot. Original raw captures and public default-lock failures
confirm this installed provider behavior. Primary URLs, full-document hashes,
line-numbered excerpts, pre-edit source hashes and actual package map are frozen
in `evidence/legacy-primary/sources.json` by `phase2-primary.mjs`.

## Validation rule

Only the adapter's **new-lock acquisition on an existing destination** may use
the request target as the grant binding when lockroot is absent. Its request has
a nonempty lockinfo body and an existence/strong-validator condition; status must
be 200, not 201, 207, or a redirect. The response must remain associated with the
already validated same-origin, root-confined request URL. The required coded-URL
header must match the XML locktoken exactly. Exclusive/write/depth-infinity,
finite positive timeout, namespaces and uniqueness checks remain in force.

If DAV:lockroot **is present**, it still must contain a valid DAV:href identifying
exactly the requested virtual path. Empty, foreign, conflicting, wrong-path or
out-of-scope root assertions never fall back to request-target inference. The
change does not infer storage identity, consult or override callback authority,
accept redirected responses, change auth/TLS policy, or change unlock/cancellation.
Post-acquisition stat/type/empty-collection checks and the destination-tagged token
on COPY/MOVE remain unchanged. The default policy remains lock.

## WsgiDAV formats are a separate question

RFC2518 section 9.5 and RFC4918 section 10.5 both define a coded-URL Lock-Token
header. RFC2518 section 13.6 and RFC4918 section 15.6 define getetag as the HTTP
entity-tag value. WsgiDAV 4.3.5 emits `lock["token"]` without brackets and returns
the provider's unquoted get_etag string as DAV:getetag. Its real GET header is
quoted. Neither legacy specification authorizes inventing the absent brackets or
turning the property into a fabricated strong validator. These remain failures;
actual conditional probes continue to use the unmodified valid GET validators.

The separate WsgiDAV source/destination condition and lock-removal behaviors are
not parsing bugs in this adapter. No guard is dropped to accommodate them. The
timestamp postcondition from `4143efd`, atomicRename false, unsupported rmdir and
permission semantics are outside this compatibility change and remain intact.
