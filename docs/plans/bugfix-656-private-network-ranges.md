# Issue 656: selected private-network range extension

## Root delivery validation

After isolating unfinished issue 649, the maintained selected virtual-bash build
passed. Combined focused regressions passed 620/620 and maintained runner/inventory
checks passed 279/279. Repository lint passed with these unchanged product/test
edits. The earlier combined full suite is not claimed as passing; its remaining
failures concern isolated 649. The installed-package classification screenshot
was visually inspected. No live network reachability claim is added.

## Scope and ownership

Approved writer window after root's issue 648 delivery on 2026-09-08.
Own the classifier, its three existing classification/DNS/redirect test files,
the existing private-address contract, and this plan. Root owns inventory,
Git, lint, full build, delivery and release checks. No README changes.

## Intended policy

- Add IPv4 shared `100.64.0.0/10`, benchmark `198.18.0.0/15`, multicast
  `224.0.0.0/4`, and reserved `240.0.0.0/4` including limited broadcast.
- Deny IPv6 local-use NAT64 `64:ff9b:1::/48`, deprecated site-local
  `fec0::/10`, and multicast `ff00::/8` as whole prefixes.
- Apply the shared IPv4 policy inside exact compatible `::/96` and to the
  IPv4 tunnel endpoint immediately following `2002` in `2002::/16`.
- Preserve mapped/historical-translated/WKP public embedded IPv4, ordinary
  IPv6, exact-prefix neighbors, allowlist semantics and omitted/false opt-out.
- Leave optional documentation ranges and registry-wide classification out of
  scope. In particular, do not block the globally reachable `192.0.0.9` and
  `192.0.0.10` exceptions with a blanket `192.0.0.0/24` rule.

## TDD and safety

Extend existing maintained test files before editing production code. Exercise
range endpoints and neighbors, compressed/expanded and dotted/hex spellings,
public payloads, private payloads outside selected prefixes, explicit allowlists,
and legacy opt-out. Use actual Node transport with mocked HTTP/HTTPS requests
and injected DNS; assert no denied-target dispatch or upload, including redirects.
All traffic is in memory; no real network probes or servers.

Run the maintained focused reporter with Node 22 from
`/tmp/kamilio-toolchain.path`, `TSX_DISABLE_CACHE=1`, `NO_COLOR` unset, and
`TMPDIR=$(cat /tmp/kamilio-569-575-validation.path)/tmp`:

```sh
node packages/safe-bash/scripts/test-reporting.mjs --import tsx --test-concurrency=1 \
  packages/safe-bash/tests/commands/network/private-addresses.test.ts \
  packages/safe-bash/tests/commands/network/dns-pinning.test.ts \
  packages/safe-bash/tests/commands/network/private-address-integration.test.ts
```

Record fresh RED against the original classifier, then GREEN for the same
selection and the adjacent mock-only address-policy/Fetch tests. Freeze owned
files promptly for root integration; do not run competing full checks.

## Evidence

Fresh RED on 2026-09-08 used the unchanged classifier SHA-256
`eec3e751fa3cd9634c32ab1ed7b0e72659c89265233a84bace1d231eaa5eb8f8`.
The three-file maintained selection ran 546 tests: 419 passed, 127 failed,
zero skipped/cancelled/TODO, exit 1 (1131.602 ms). Failures include newly
denied range decisions, resolved candidates reaching request construction,
and initial/redirect targets reaching dispatch. The expected failures are
fresh policy evidence, not a green result. Raw local output:
`/tmp/poe-code-656-red.log`.

The minimal classifier change produced GREEN on the identical three-file
selection: 546/546 passed, zero failed/skipped/cancelled/TODO, exit 0
(1126.872 ms). The final focused selection added only the existing
`address-policy.test.ts` and `fetch-transport.test.ts` controls: 575/575 passed,
zero failed/skipped/cancelled/TODO, exit 0 (1537.282 ms). Raw local output:
`/tmp/poe-code-656-green.log`. Both runs used Node v22.22.0 and the environment
specified above. These logs are ephemeral local evidence, not committed gates.

Initial sandboxed maintained invocations reported only file-level failures;
a direct classifier test invocation exposed 34 expected assertion failures.
The authoritative detailed RED/GREEN selections were rerun with approved
escalation. No passing sandbox test run or production network access is claimed.

Production changes are confined to `private-address.ts`; authorizer, Node
transport and curl admission code are unchanged. Existing test files retain
their registered paths; no inventory edits or new test registrations are needed.
Classification, literal/DNS/redirect refusal, no-upload, response cleanup,
public embedded IPv4 and legacy opt-out are covered by in-memory controls.
No README, Git, lint, full build, full suite or release actions were performed.

Source and test writes are frozen for root's integrated build. Owned paths:

- `packages/safe-bash/src/commands/network/private-address.ts`
- `packages/safe-bash/tests/commands/network/private-addresses.test.ts`
- `packages/safe-bash/tests/commands/network/dns-pinning.test.ts`
- `packages/safe-bash/tests/commands/network/private-address-integration.test.ts`
- `packages/safe-bash/src/contracts/network-private-addresses.md`
- `docs/plans/bugfix-656-private-network-ranges.md`

The contract records the intentional expanded policy and preserves the
limitations from RFC 4291 (compatible/site-local deprecation), RFC 3056
(6to4 tunnel endpoint), RFC 6052 (well-known NAT64 restrictions) and RFC 8215
(local-use /48 without a single prescribed embedded layout). No live routing,
cloud metadata reachability or exhaustive special-purpose registry coverage
is established. Root still owns integrated verification and delivery.
