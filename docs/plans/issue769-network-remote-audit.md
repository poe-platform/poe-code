# Issue 769: remote standard network audit

## Frozen scope

Audit input: remote main `b0b6244b77ab2c217ecfd3860e474efc92425d65`, including
the standard Playwright implementation from `7d0897d8e`. Work is detached in
the home `issue-769-network-audit` worktree. The earlier network factory commits
through `53e5c24c4` and its uncommitted target-authorization work remain preserved
in the separate `issue-769-network` worktree; they are not ported wholesale.

The corrections extend the existing route capabilities with an optional policy
backend, a standard offline-state hook and public binding exports. Network policy,
prepared-target ownership, shared adapters and the parent main checkout remain
unchanged. The current safe-bash AGENTS command-workspace rule is acknowledged;
this patch corrects an existing command rather than adding one.

## What remote already covers

- All ten network command names: request listing/details/header/body inspection,
  response headers/bodies, route registration/list/removal and offline state.
- Native event observation with retained-event limits, output byte limits,
  binary virtual artifacts, route count/byte limits and header validation.
- Context-scoped route records, exact-handler removal, session cleanup and route
  restoration after storage-driven context replacement.
- A separate guarded CDP network policy with per-request host callbacks,
  bounded request/response payloads, response-release acknowledgement,
  cancellation and browser retirement. The host must supply manual redirects
  and independent egress denial; the callback is not an automatic network grant.

These capabilities should be reused, not replaced by a second command family.

## Native admission and composition evidence

The frozen source was exercised with the existing Chromium 143 toolchain and a
local deny proxy. Five modes were tested with policy installation both before
and after route registration: plain navigation, the standard route ability,
raw page routes, raw context routes and the standard header-rewrite route.

All ten forbidden-navigation scenarios reached the host callback and failed.
No page/context-route admission bypass was reproduced in this profile. The two
admission logs each contain five subtests and their parent, all green. This is
not proof for every provider, installation mode or external egress boundary.

There is a distinct, concrete composition failure: admitted standard/page/context
mocks return the policy host's body instead of the registered mock, and the
standard header rewrite never reaches host authorization. Those four controls
fail in each installation order. The policy callback is still invoked for URLs
the user intended to mock. Initial exploratory runs also hit error-page followup
navigation races; the final frozen-source controls test the allowed navigation
first and explicitly supply the mock's HTML content type. Earlier runs, including
the initial unspecified-MIME probes, remain separate rather than being overwritten.

Evidence under `/home/kjopek/out/issue769-network-audit`:

- `admission-policy-first-green.tap`, `admission-routes-first-green.tap`.
- `composition-policy-first-red.tap`, `composition-routes-first-red.tap`.
- `route-admission-red.test.mjs` is the explicit home-only native probe;
  `AUDIT_REQUIRE_MOCK` selects the separate mock/header-effect assertions.
- `baseline-b0b6244b7` contains the archived source used by those final probes.

## Minimal correction

Three new unit controls reproduced late native route registration surviving
command cancellation or session cleanup, including state-restoration registration.
All three originally resolved successfully rather than rejecting. Registration
now checks cancellation/registry closure after native installation and awaits
removal of exactly its own handler before failing. Existing handlers survive,
and cancellation preserves its exact reason, including zero. The same install
path is used when restoring routes.

`route-registration-red.tap` records three failures and three prior passes;
`route-registration-green.tap` records six passes. `scoped-green.tap` records
81 passing route/event/standard-session/network-policy tests. `types.txt` is the
successful strict exact-optional/no-unchecked scoped TypeScript check. No full
suite, root lint, dependency installation or push was performed.

## Implemented policy composition

The existing standard commands now support an explicit host binding, exported
from the Playwright entry:

```ts
const binding = bindPlaywrightRoutePolicy(context, {
  ownsRequest,
  admit,
  fetch: boundedManualRedirectTransport,
}, limits);
```

Supply `binding.fetch` to the existing network policy. For multiple contexts,
the host dispatches through authoritative target/context identity, never a user
session string. `ownsRequest` must verify that identity on each request. `admit`
must authorize the initial URL and rewritten headers/authority without fetching.
The downstream transport must use manual redirects and bounded cancellable reads.
Bind before standard route commands; installed or pending native route records
and duplicate bindings are rejected rather than mixed with policy interception.

Bound commands keep the existing validation, registry, handlers and output. They
do not call native page/context route APIs. The backend admits before matching
or fulfillment, readmits header rewrites, enforces request/response/header/route
retention and concurrency limits, and holds response leases until awaited release.
Standard offline mode also gates downstream transport, while admitted explicit
mocks remain usable. Session/context cleanup aborts and drains cooperative work;
disposing a binding cannot silently downgrade it to native routing. Context
replacement requires a fresh explicit policy binding before restoring records.

The new controls cover late cancellation, exact falsey abort reasons, response
ownership, acknowledged release/backpressure, route quota recovery, owner/context
separation, replacement downgrade rejection and pending-native binding races.
`backend-red.tap`, `backend-resources-red.tap` and
`backend-binding-race-red.tap` retain the failing stages; current route controls
are in `backend-final-unit.tap`.

Final focused verification: `backend-scoped-green.tap` records 123 passing tests,
zero skips and zero failures across the route, event, standard-session, restoration
and network-policy controls. `backend-types.txt` records the successful strict
exact-optional/no-unchecked TypeScript check. `backend-inventory.tap` records the
passing maintained normal-runner inventory control. These are scoped checks,
not a full workspace gate or root lint run.

`playwright-route-policy-native.test.ts` exercises the actual guarded Chromium
path: admitted mocks without downstream traffic, denied mock destinations,
allowed and denied header rewrites, redirected forbidden mocked URLs, offline
transport, admitted offline mocks, unroute, context isolation and late-response
cleanup. Nine glob cases are compared against native routing in a separate
deny-proxy-backed browser. `backend-native-patterns.tap` records Chromium
143.0.7499.4, 23 admissions, eight downstream responses and eight releases. The
final unchanged-source rerun is `backend-native-final.tap`, with the same counts.
The native route test is opt-in through the maintained `PLAYWRIGHT_TEST_MODULE` and
`PLAYWRIGHT_TEST_EXECUTABLE` variables, with home-only TMPDIR, and has an explicit
normal-runner inventory assertion. It does not require a new dependency install.

## Remaining host qualifications

Native-only routing remains available for hosts not using a policy binding;
arbitrary external native page/context routes are not made policy-compatible.
The guarded standard route backend repairs the reproduced composition failure,
not the behavior of unrelated host-installed interceptors. The host still owns
independent egress denial and authoritative target/context mapping. Logical byte
budgets do not claim a process-wide RSS bound or preemption of uncooperative
host code. Hidden prepared targets remain the parent's guarded target and nonce
mechanism, not native Page routes. No deployed Cloudflare or published-package
qualification is claimed by these local tests.
