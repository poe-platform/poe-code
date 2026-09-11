# #619: Selected IPv6 translation prefixes in private-address policy

## Status and scope

September 5, 2026: integrated from a private-scratch candidate; delivery and
release verification remain separate requirements.
GitHub issue #619 was read through `gh`; its author is exactly `kamilio`.
The authenticated body and original read-only evidence remain under
`/home/kjopek/kamilio-validation-569-575.RoFXyZ/619-readonly.AeTphQ/`.

This intentionally extends `denyPrivateNetworks: true`. The baseline explicitly
allowed `::ffff:0:7f00:1` and `64:ff9b::7f00:1`; it did not promise to classify
all translated addresses. Preserve those historical expectations in baseline
evidence rather than calling them violations of the old contract.

The candidate changes only the authorizer, its two existing private-address test
files, the private-address contract and this plan. No runtime transport changes,
registry changes, README edits or test-runner registration are needed.

## Correction

After the existing URL-validated hextet expansion, recognize these exact first
six hexadecimal hextets and reuse the unchanged `privateIPv4` range predicate:

| Family | Prefix | First six hextets |
| --- | --- | --- |
| Existing mapped | `::ffff:0:0/96` | `0, 0, 0, 0, 0, ffff` |
| Added historical translated | `::ffff:0:0:0/96` | `0, 0, 0, 0, ffff, 0` |
| Added NAT64 well-known | `64:ff9b::/96` | `64, ff9b, 0, 0, 0, 0` |

The issue's translated prefix name/condition and incomplete NAT64 mask are not
used. No arbitrary IPv6 suffix, IPv4-compatible address or network-specific
translation prefix is decoded. Existing IPv6 local-address rules still apply.
Public IPv4 values inside the selected prefixes remain eligible for allowlisting.
Filtering stays opt-in and precedes explicit origin/hostname allowlists.

This is defensive literal classification, not a promise that the transport can
route either representation to an IPv4 endpoint. RFC 6052 section 3.1 prohibits
the well-known prefix from representing non-global IPv4; RFC 2765 describes the
historical translated format, not mapped IPv4 socket behavior. Translator/host
behavior and actual metadata reachability were not tested or established.

## Bounded TDD evidence

Evidence base:
`/home/kjopek/kamilio-validation-569-575.RoFXyZ/619-candidate.pdx6fV/`.

| Stage | Result | Preserved log |
| --- | --- | --- |
| Exact baseline copies | 111 passed, 0 failed | `baseline-tests.log` |
| New tests, unchanged authorizer | 163 passed, 60 failed | `red-tests.log` |
| Exact-prefix candidate | 223 passed, 0 failed | `green-tests.log` |
| Actual-options scoped types | 0 diagnostics | `scoped-types.log` |

The 60 RED failures consist of 30 classifier denials, two classifier allowlist
precedence cases, 24 initial/redirect transport refusals and four explicit-origin
transport refusals. The original two ALLOW expectations are moved into the
denial table; no unrelated existing test is dropped.

New coverage includes all denied IPv4 range boundaries, neighboring permitted
values, dotted/hexadecimal and expanded/compressed spellings, and one-hextet
neighbors of both new prefixes. Both injected transports and injected Fetch test
initial denial, redirect denial with zero target dispatch and prior-response
cleanup, public success, opt-out, and allowlist composition. No live DNS or
network request is used; the scratch runner rejects external network calls and
records zero such calls.

Tests use an exact-three-file source overlay at the original repository URLs:
only the copied authorizer and two copied tests replace loaded source. Other
imports retain ordinary checkout resolution. The overlay records loaded hashes;
it changes neither candidate import specifiers nor production package exports.
The standalone type driver similarly supplies only those three candidate roots,
uses the maintained package compiler options unchanged plus `noEmit`, and checks
their dependency closure without filtering diagnostics (452 source files).
Validation used Node 22.22.0 and TypeScript 5.9.3. This is not the full source gate.

## Handoff and limitations

`baseline.json` records the four exact original file hashes; baseline copies and
the earlier read-only probe remain preserved. `candidate.apply_patch` is the
five-file integration candidate; `candidate-manifest.json` records candidate,
patch and evidence hashes. Root must verify the baseline before integration and
owns maintained integration/build/lint/type gates and release verification.

No repository or Git writes, full gates, GitHub posts, DNS, live-target requests,
stress tests or exploits were performed by this scratch implementation. Focused
passes do not establish connection pinning, DNS-rebinding resistance, host SSRF
isolation, NAT64 availability, metadata access or general resource guarantees.

## Root checkout verification

Root verified the candidate patch hash and the selected source/test changes,
then applied the two test files before changing production. The unchanged
authorizer produced the same 60 expected failures and 163 passes. After applying
the exact-prefix policy, all 223 controls passed in the actual checkout without
source overlays. Logs are `issue619-root-red.log` and `issue619-root-green.log`
under the shared evidence base. No external target or DNS request was made.

Root also rechecked RFC 6052 section 3.1 and RFC 2765 section 2.1 against the
RFC Editor texts. As checked September 5, 2026, the August 27, 2026 revision 08
of `draft-ietf-v6ops-nat64-wkp-1918` remains an Internet-Draft, not a published
replacement for the cited RFC rule. No translation or metadata-access claim
is inferred from those documents. Full maintained gates and publication are
not established by these focused checks.
