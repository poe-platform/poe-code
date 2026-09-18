# Issue 769: remote standard network audit

## Frozen scope

Audit input: remote main `b0b6244b77ab2c217ecfd3860e474efc92425d65`, including
the standard Playwright implementation from `7d0897d8e`. Work is detached in
the home `issue-769-network-audit` worktree. The earlier network factory commits
through `53e5c24c4` and its uncommitted target-authorization work remain preserved
in the separate `issue-769-network` worktree; they are not ported wholesale.

The only product correction here is in `route-capabilities.ts`. Network policy,
prepared-target ownership, shared adapters and the parent main checkout are
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
first and retain the earlier runs separately.

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

## Remaining necessary integration

Keep the remote route validation, registry and output behavior. A policy-backed
route backend still needs one explicit trusted owner/context binding that
evaluates those route records inside the policy fetch callback, after mandatory
host URL admission and before downstream transport. Header/authority rewrites
must be readmitted. Mock responses must preserve byte/concurrency budgets,
acknowledged release and cancellation; offline mode must also gate host transport.
Context replacement must acquire a new trusted binding, not copy owner authority
from a user session name. Hidden prepared targets require the parent's guarded
target/context identity and target-bound nonce mechanism, not native Page routes.

This audit does not add that backend or claim the still-red policy/mock controls
are repaired. It also does not qualify deployed Cloudflare or a published package.
