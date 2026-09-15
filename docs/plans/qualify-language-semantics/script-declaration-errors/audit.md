# Script declaration error ownership — 2026-09-13

Nine independent regressions fail with one negative control passing before repair.
Restricted global lexical declarations and declaration collisions correctly threw, but
the exceptions retained native host constructors instead of guest-realm constructors.
Non-extensible global var/function declarations exposed the same problem for TypeError.
The interpreter now converts declaration-validation exceptions using its existing guest
exception boundary. Fatal budgets remain fatal; explicit surfaced-error options remain
respected. The conformance classifier and its error-type assertions were not changed.

```sh
npx vitest run packages/safe-js/test/conformance/script-declaration-errors.test.ts
npx vitest run packages/safe-js/test/conformance/script-declaration-errors.test.ts packages/safe-js/test/conformance/realm.test.ts packages/safe-js/test/conformance/result.test.ts packages/safe-js/test/conformance/execute.test.ts packages/safe-js/src/interp/global-scope.test.ts packages/safe-js/src/interp/globals/eval-global-declarations.test.ts packages/safe-js/src/interp/globals/eval-global-block-functions.test.ts
npx eslint packages/safe-js/src/interp/interpreter.ts packages/safe-js/test/conformance/script-declaration-errors.test.ts
npm run build:workspaces -- --workspace=@poe-code/safe-js
```

The first focused invocation named nonexistent eval-global-environment.test.ts, which
is not counted:87 tests/five actual files passed. The discovered maintained eval neighbors
passed20 tests. After isolating sibling workspace resolution, the complete focused set
passes107 tests/seven files, zero skips; maintained build and lint pass. External npm
lock entries match exactly across checkouts. Sibling workspace symlinks now resolve to
the delivery checkout instead of the original dirty checkout. External dependencies are
still shared, not a fresh npm ci. dependency-link-isolation.json records this qualification.
Prior evidence is retained with its earlier dependency setup; current verification does
not presume it certified isolated sibling sources.

Original two failing variants and their recorded neighbors pass five/five variants in
three files after isolation, zero unsupported/errors. Exact source SHA/fingerprint/patch,
fixture hashes/modes and commands are retained. Test262419d3e0a2273ba01a3bfcbec423f2801425b8e93,
ECMA-262 edition16/ECMA-402 edition12, Node22.23.2/ICU78.2 and3000ms/10000ms deadlines
remain pinned. No budget, assertion, timeout, runtime support or authority was weakened.

Built Script-interpreter probes preserve same-realm SyntaxError identity in strict and
sloppy contexts across Node18.18.0/ICU73.2,18.20.8/74.2,20.20.0/77.1,22.23.2/78.2,
24.14.0/78.2,26.8.2/78.3 and Bun1.3.11/74.2. Public SDK/CLI function-body goals allow
local shadowing of undefined; the SDK control passes original and three pending/completed
replays with matching source and host-constructor denial. The inspected CLI screenshot
returns[7,"undefined,undefined"] with the expected AS-SHADOW-GLOBAL lint warning; the warning does not reject execution. Script goal is exercised through the maintained Script
integration. The first screenshot attempt lacked delivery-built terminal-png; retained
failure was resolved with npm run build:workspaces -- --workspace=terminal-png, then retried.

Residual arithmetic becomes124 nonpasses. Whole-task acceptance and publication remain
open. A fresh integrated replay is required after sibling-workspace isolation. Local,
remote and publication receipts remain distinct.
