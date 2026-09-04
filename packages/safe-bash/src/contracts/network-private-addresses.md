# Literal Private-Address Authorization Specification

Status: Accepted

Implemented Through: Not applicable

Purpose: Make the existing opt-in private-address authorizer classify mapped
IPv4 and native IP literals consistently before curl transport dispatch.

## Normative Language

The key words `MUST`, `MUST NOT`, `REQUIRED`, `SHOULD`, `SHOULD NOT`, `RECOMMENDED`,
`MAY`, and `OPTIONAL` are to be interpreted as described in RFC 2119.
`Implementation-defined` means the implementation MUST document its chosen policy.

## 1. Problem Statement

The current helper's private-address option rejects ordinary private IPv4,
loopback and local IPv6 forms, but omits IPv4-mapped private addresses and the
IPv6 unspecified address. Small injected-transport controls establish dispatch
past the policy boundary, not an actual connection to a private service.

## 2. Goals and Non-Goals

The classifier MUST apply the existing private IPv4 policy to the IPv4 value
embedded in an IPv4-mapped IPv6 literal and reject unspecified IPv6. Preserve
existing public destination, allowlist and opt-in behavior.

This is literal URL classification, not DNS resolution, rebinding protection,
connection pinning, a complete non-global-address registry, or an SSRF sandbox.
There is no new public API or automatic network registration. A host needing
actual-connection IP restrictions remains responsible for its transport policy.

## 3. Configuration and Trust Boundary

`createOriginAuthorizer(allowlist, { denyPrivateNetworks: true })` MUST apply the
private-address rejection before considering the allowlist. An explicitly
listed private destination MUST remain denied while the option is true.
Omitting the option or setting it false MUST preserve existing allowlist behavior.
The helper's omitted allowlist remains the deliberate wildcard `"*"`; this
extension MUST NOT silently change it to a default-deny policy.

Exact origin entries retain scheme, normalized host and port identity. Bare
hostname entries retain their existing scheme/port-independent semantics and
single terminal-dot normalization. Neither form implicitly allows subdomains.

The authorizer operates on URL-parsed hostnames. It MUST NOT infer an address
from an arbitrary DNS name or perform network I/O. The URL parser remains
responsible for URL syntax and canonicalization.

## 4. Literal Classification

With private filtering enabled, the classifier MUST reject the existing IPv4
ranges: `0.0.0.0/8`, `10.0.0.0/8`, `127.0.0.0/8`, `169.254.0.0/16`,
`172.16.0.0/12` and `192.168.0.0/16`.

The classifier MUST recognize the IPv4-mapped IPv6 prefix `::ffff:0:0/96`,
extract its low 32-bit IPv4 value, and apply those same IPv4 ranges. Equivalent
URL-accepted dotted and hexadecimal representations MUST yield the same
decision. Mapped addresses outside the configured private ranges MUST NOT be
denied merely for being mapped.

The classifier MUST reject IPv6 unspecified `::`, loopback `::1`, unique-local
`fc00::/7` and link-local `fe80::/10`, retaining existing localhost and
subdomain-of-localhost rejection after terminal-dot normalization. Ordinary
public IPv6 and unrelated hostname prefixes remain eligible for allowlisting.

Address definitions follow RFC 4291 sections 2.2, 2.5.2 and 2.5.5.2. This list is
the selected policy, not a claim to reject every special-use or non-routable
address family.

## 5. Dispatch, Failure and Recovery

Curl MUST continue to authorize every hop and retry before transport dispatch,
using the same normalized URL string sent to the transport. A denied initial
destination MUST cause zero transport calls. A denied redirect target MUST
cause zero transport calls to that target; a previously fetched response still
requires normal disposal.

Denial and authorization exceptions MUST retain existing curl error handling
and redacted diagnostics. This change MUST NOT add a fallback allowing a denied
request, alter credential stripping, auto-follow redirects in transports, or
change cancellation and response-cleanup ownership.

## 6. Test and Validation Matrix

| Requirement | Required evidence |
| --- | --- |
| Mapped private addresses | Dotted/hexadecimal and compressed/expanded equivalent forms for each denied IPv4 range, including boundaries. |
| Existing classification | Native IPv4, unspecified/loopback/local IPv6, localhost terminal-dot controls and unrelated/public neighbors. |
| Opt-in and allowlists | Default/false option behavior, private explicitly allowed yet denied with the option, exact origin and hostname preservation. |
| Initial/redirect enforcement | Actual Shell/curl with injected transport and Fetch, normalized URL identity, zero denied-target dispatches and response disposal. |
| Honest boundary | No external connections or DNS claims; mapped-public controls continue to succeed. |
| Integration | Maintained network cohorts, normal build, built public exports, current consumers and maintained lint. |

## 7. Conformance Criteria

All normative behavior and validation categories MUST pass against an identified
implementation commit before this accepted extension is marked implemented.
Passing a hostname classifier does not establish connection-level isolation.
