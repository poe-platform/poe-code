# Issue #600: private mapped-address admission

## Validated current boundary

Baseline: `58dc2afbd846b2dfb38ae45071872c25d7730d8c`, September 4, 2026.
The shipped `createOriginAuthorizer` has an opt-in `denyPrivateNetworks` option.
Its default remains an explicit allow-all policy; curl itself requires a host
authorizer and is not installed by the default command aggregate.

A small direct-helper witness with `denyPrivateNetworks: true` allows IPv6
unspecified `::`, mapped loopback `::ffff:127.0.0.1` and mapped link-local metadata
`::ffff:169.254.169.254`. WHATWG URL parsing canonicalizes the mapped examples to
hexadecimal suffixes before the helper sees them. These are real omissions in
the existing opt-in classifier, not merely a hypothetical user blacklist.

The same current helper already rejects `0`, `0.0.0.0`, `localhost.`, `::1`,
`fe80::1` and `fd00::1`. Do not change working cases based solely on the older
report. No loopback listener, cloud endpoint or other external target was contacted
for this witness. Forty injected public-curl initial/redirect controls corroborate
dispatch of the omitted literals and continued enforcement of exact allowlists.
An independent injected-Fetch review passes 25 controls, confirms normalized URL
identity, and reproduces mapped-loopback redirect dispatch without network I/O.

The existing textual IPv6 prefix check also rejects short first hextets `fc`,
`fd` and `fe8`, although those values are outside `fc00::/7` and `fe80::/10`.
Small direct controls establish these false positives. Numeric prefix checks
must preserve the intended ranges rather than that string-prefix mistake.

## Selected scope

Repair the existing private-destination option for IPv4-mapped private addresses
and IPv6 unspecified, preserving the existing IPv4 ranges and ordinary public
destinations. IPv4-mapped addresses contain the IPv4 value in their low 32 bits;
reuse the same private IPv4 classification for that value. Recognize actual
address structure rather than applying dotted-decimal string checks to an IPv6
hostname. RFC 4291 sections 2.2, 2.5.2 and 2.5.5.2 provide the address definitions.

Do not add another public destination-policy API, implicit network authority,
DNS resolution, connection pinning or a new default-deny mode. Existing exact
origin/hostname allowlists and explicit opt-out behavior remain. Public names
resolving to private addresses are outside a URL-literal classifier's promise.
Keep per-hop authorization, normalized transport URL identity and error redaction.
Do not add README content without the user's permission.

## Implementation and evidence

- Authorizer owner: focused failing classifier tests, then the smallest change
  to `authorizer.ts`; no unrelated transport rewrite.
- Independent integration owner: injected-transport initial and redirect tests,
  allowlist/default/opt-out controls and literal test registrations.
- Root: plan/contract, normal build, built public exports, current consumers,
  maintained lint, exact-path commit, verified remote-main delivery and closure.

Tests must use bounded memory-only inputs and injected transports. No external
SSRF probe or claim about actual DNS resolution is needed. Preserve user staging.
The independent #574 delivery is already closed at the baseline; our overlapping
unpublished work is retained in recovery stash
`a1e8dd97de3c2faad19827f195e1406add4ed73b`, not reapplied or discarded.

## Delivery

#600 remains open pending verified remote delivery. Implementation and local
validation are complete; a local commit is not a completed push or release.
Close after verified remote-main delivery, before publication, and monitor the
release while continuing useful queue work. Local commits, remote delivery and
successful releases remain separately reported.

## TDD checkpoints

- Classifier RED: initial 58 tests, 42 pass / 16 fail. Three additional
  short-hextet false-positive controls fail before the fix. Final classifier
  suite passes 65/65, and its existing export control gives 66/66 combined.
- Independent curl regression RED: 46 tests, 18 pass / 28 fail. Each failure is
  an incorrectly successful private initial/redirect request (status 0 instead
  of 7), through injected transport or Fetch.
- Exact literal registrations pass their two discovery controls; the adjacent
  public exports and Fetch tests pass 4/4 before the classifier change.
- Upstream #574 was independently checked at the baseline: 38 focused and 163
  combined string/substring/parameter controls pass, with no full-value array in
  bounded public observers. Its selected input/work admission intentionally
  differs from our preserved draft; no duplicate implementation is applied.
- Final injected curl and adjacent export/Fetch checks pass 50/50. The complete
  maintained network test selection plus integration-input registration controls
  passes 424/424 with no skips, cancellations or failures.
- Independent numeric-reference checks pass 196,636 comparisons: all 65,536
  first-hextet values and all 65,536 mapped first-two-octet combinations in dotted
  and hexadecimal forms, plus policy controls. No network connections occur.
  Authorizer SHA-256 is
  `07d5e4f0d0bf4f0e3b40898420c508ac04982ddc007bc77aaf1fb19f130bfa44`.
- The accepted private-address contract passes its checker with zero warnings.
- Normal `npm run build` passes, including workspace build closure and root
  schema-generation suffix stages.
- Current consumers pass: historical build-first route, three source groups,
  26 current consumer groups and three expected-negative groups. This is not a
  claim that the separate legacy-fixture source audit in #605 is clean.
- Built `virtual-bash` and `poe-code/safe-bash` exports pass 44 memory-only public
  cases: initial and redirected private/public controls, disposal and opt-out.
- Full maintained `npm run lint` passes: 9,699 configured/linted files, zero
  errors/warnings, plus type and workflow checks. Builds finished before lint.
- Frozen source/test/registration hashes match the reviewed candidate. The
  user's staged three files remain unchanged at 33 insertions / 3 deletions.
  No README additions or transport edits are included.
