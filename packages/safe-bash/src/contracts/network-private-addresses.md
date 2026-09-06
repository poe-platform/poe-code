# Private-Address Authorization and Connection Specification

Status: Baseline and #619 literal policy; #618 connection enforcement contract

Baseline Implemented Through: `1433543a56f5558f0eb9aa07bfa65da29ffda05c`

Purpose: Make the existing opt-in private-address authorizer classify mapped
IPv4, selected translation prefixes and native IP literals before curl transport
dispatch, then enforce that selected policy on the actual Node connection.

## Normative Language

The key words `MUST`, `MUST NOT`, `REQUIRED`, `SHOULD`, `SHOULD NOT`, `RECOMMENDED`,
`MAY`, and `OPTIONAL` are to be interpreted as described in RFC 2119.
`Implementation-defined` means the implementation MUST document its chosen policy.

## 1. Problem Statement

The original extension added IPv4-mapped private addresses and IPv6 unspecified
to the helper's ordinary private IPv4, loopback and local IPv6 policy. The #619
extension deliberately adds two exact translation prefixes. Earlier tests
explicitly permitted `::ffff:0:7f00:1` and `64:ff9b::7f00:1`; their changed
expectations are a new opt-in policy, not proof that the baseline violated its
published range list. Small injected-transport controls establish dispatch past
the policy boundary, not an actual connection to a private service.

## 2. Goals and Non-Goals

The classifier MUST apply the existing private IPv4 policy to the IPv4 value
embedded in an IPv4-mapped IPv6 literal or either translation prefix selected in
section 4, and reject unspecified IPv6. Preserve public destination, allowlist
and opt-in behavior outside the intentional extension.

The #618 extension requires connection pinning when the existing private-network
option is true in curl. Node enforces the selected policy against the resolved
address; unsupported transports fail closed. This is not a complete non-global
address registry, protection from arbitrary trusted host JavaScript, or a claim
that all host network activity is isolated. Network registration remains opt-in.

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

With filtering enabled, the helper MUST invoke the optional request-carried
`requirePrivateNetworkDeny` callback. Curl supplies this callback and records a
monotonic requirement for each authorized hop. Forwarding authorization wrappers
MUST preserve it. Authorizers MUST announce requirements before returning or
fulfilling an allowed decision; a later callback does not revise a dispatched
request. A standalone helper call without that integration remains a
literal decision, not proof of connection enforcement. The configured boolean
MUST be captured when constructing the helper, not changed by later mutation of
the caller's options object.

## 4. Literal Classification

With private filtering enabled, the classifier MUST reject the existing IPv4
ranges: `0.0.0.0/8`, `10.0.0.0/8`, `127.0.0.0/8`, `169.254.0.0/16`,
`172.16.0.0/12` and `192.168.0.0/16`.

The classifier MUST recognize the IPv4-mapped IPv6 prefix `::ffff:0:0/96`,
extract its low 32-bit IPv4 value, and apply those same IPv4 ranges. Equivalent
URL-accepted dotted and hexadecimal representations MUST yield the same
decision. Mapped addresses outside the configured private ranges MUST NOT be
denied merely for being mapped.

The classifier MUST also apply those same IPv4 ranges to the low 32 bits of
exactly `64:ff9b::/96` (the NAT64 well-known prefix) and `::ffff:0:0:0/96`
(the historical IPv4-translated prefix). Their first six hexadecimal hextets
MUST respectively equal `[64, ff9b, 0, 0, 0, 0]` and
`[0, 0, 0, 0, ffff, 0]`. The latter is distinct from the existing mapped prefix
`::ffff:0:0/96`, whose first six hextets are `[0, 0, 0, 0, 0, ffff]`.
Equivalent URL-accepted dotted, hexadecimal, compressed and expanded forms MUST
agree. Values outside the configured IPv4 ranges MUST remain eligible for
allowlisting, including within these two prefixes.

This is an explicit defensive policy for these exact prefixes, not a claim
that either literal necessarily connects to its low-32-bit IPv4 value. RFC 6052
section 3.1 prohibits its well-known prefix from representing non-global IPv4
addresses; actual translation and routing remain host concerns. RFC 2765's
historical translated-address format is not the mapped IPv4 socket format.
The classifier MUST NOT generalize this extraction to arbitrary IPv6 suffixes,
IPv4-compatible `::/96`, network-specific translation prefixes, or neighbors of
the two selected prefixes. The IPv6 denials below continue to apply independently.

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

### Connection admission

An authorized request requiring private-network denial MUST carry
`HttpRequest.denyPrivateNetworks: true`. Before dispatch, curl MUST require
`HttpTransport.supportsPrivateNetworkDeny: true`; otherwise it MUST fail with
curl status 7 without dispatching or consuming the upload. This capability is
a truthful trusted-host contract, not protection against a lying implementation.
Here upload consumption means request-body upload iteration. Existing
preauthorization query construction (`-G`) and write-out preparation may consume
VFS or stdin inputs; this is not a guarantee of zero input preparation.

The shipped Node transport MUST enforce flagged requests. It MUST resolve one
numeric candidate, validate and snapshot its address/family, apply section 4,
and connect only to that candidate through request-local lookup. Literal IP
destinations MUST be checked too. DNS answers MUST NOT be cached between hops,
retried through an unchecked address, or resolved again after admission. This
single-candidate protected profile intentionally omits multi-address failover.

`NodeHttpTransportOptions.resolveAddress` MAY inject the resolver, taking a
hostname and effective AbortSignal and returning an address with family 4 or 6.
Malformed results MUST fail before request construction. The original URL,
default Host and port MUST remain intact. An explicit Host override MUST NOT
change the original hostname/IP used for TLS SNI and certificate identity;
ordinary CA validation MUST remain enabled.

Cleanup MUST be registered before resolution. Cancellation MUST prevent later
request construction and upload admission, and late resolver rejection MUST be
observed. This does not guarantee hard preemption of an opaque host resolver.

The generic Fetch transport MUST NOT claim this capability. Flagged direct
requests MUST fail before constructing Request/body objects, acquiring the body
iterator, or invoking fetch. Omitted/false policy behavior remains unchanged;
true-option Fetch success intentionally becomes an unsupported-policy refusal.

## 6. Test and Validation Matrix

| Requirement | Required evidence |
| --- | --- |
| Mapped private addresses | Dotted/hexadecimal and compressed/expanded equivalent forms for each denied IPv4 range, including boundaries. |
| Selected translation prefixes | Exact-prefix private range boundaries denied; public range neighbors and one-hextet prefix neighbors eligible; equivalent spellings agree. |
| Existing classification | Native IPv4, unspecified/loopback/local IPv6, localhost terminal-dot controls and unrelated/public neighbors. |
| Opt-in and allowlists | Default/false option behavior, private explicitly allowed yet denied with the option, exact origin and hostname preservation. |
| Initial/redirect enforcement | Actual Shell/curl with enforcing injected transport, normalized URL identity, zero denied-target dispatches and response disposal; unsupported Fetch refusal. |
| Connection enforcement | Private DNS answers denied before connection; one pinned candidate, fresh hop/retry resolution, validated family/address and original TLS identity. |
| Cancellation | Registered cleanup before resolution, no late socket/upload admission, observed late rejection and falsey reason preservation. |
| Honest boundary | Bounded mock/loopback evidence is distinguished from live DNS, cloud metadata, provider routing and complete address-registry coverage. |
| Integration | Maintained network cohorts, normal build, built public exports, current consumers and maintained lint. |

## 7. Conformance Criteria

All normative behavior and validation categories MUST pass against the identified
implementation commit. The recorded commit passed the focused classifier and
injected-curl regressions, maintained network selection, build, public exports,
current consumers and lint routes recorded in the associated #600 plan.
Those baseline integration results do not qualify the #619 extension. Its
private-scratch and checkout verification evidence are recorded in
`docs/plans/bugfix-619-translated-private-addresses.md`.
Passing a hostname classifier does not establish connection-level isolation.
Those historical results also do not qualify #618. Its implementation, fresh
RED/GREEN evidence, intentional compatibility changes and integrated delivery
are tracked in `docs/plans/bugfix-618-dns-pinning.md`.
