# Symbol construction — 2026-09-13

The pinned edition section20.4.1 permits Symbol as an extends value and as newTarget,
while invoking its construction operation throws before description coercion. SafeJS
lacked that internal construction operation and rejected valid subclasses immediately.
Five independent cases fail and one negative control passes before repair. A throwing
construct operation restores the distinction. The prototype descriptor is explicitly
non-writable because constructor materialization creates a writable default property.
Two existing descriptor tests caught that interaction; green.log retains those failures.

```sh
npx vitest run packages/safe-js/src/interp/globals/symbol-construction.test.ts
npx vitest run packages/safe-js/src/interp/globals/symbol-construction.test.ts packages/safe-js/src/interp/symbol.test.ts packages/safe-js/src/interp/symbol-boxing.test.ts packages/safe-js/src/interp/symbol-descriptors.test.ts packages/safe-js/src/interp/classes.test.ts packages/safe-js/src/interp/private-class-elements.test.ts
npx eslint packages/safe-js/src/interp/globals/symbol.ts packages/safe-js/src/interp/globals/symbol-construction.test.ts
npm run build:workspaces -- --workspace=@poe-code/safe-js
```

Final197 tests/six files pass, zero skips. Lint and maintained build pass. The original
four failing variants and recorded neighbors all pass in the final stable-source report.
Exact counts, source SHA/fingerprint/patch, fixture hashes/modes and commands are retained.
Test262419d3e0a2273ba01a3bfcbec423f2801425b8e93, ECMA-262 edition16/ECMA-402 edition12,
Node22.23.2/ICU78.2 and3000ms/10000ms deadlines remain pinned. No authority, budget,
assertion, timeout or runtime support changed.

SDK probes pass Node18.18.0/ICU73.2,18.20.8/74.2,20.20.0/77.1,22.23.2/78.2,
24.14.0/78.2,26.8.2/78.3 and Bun1.3.11/74.2. Original and three pending/completed
replay checks preserve subclass behavior, constructor rejection, exact class source and
host-escape denial. CLI screenshot inspected; output agrees with SDK. Exact invocations
and results are in runtime-sdk.json and screenshot.log.

Residual arithmetic becomes128 nonpasses. Whole-task acceptance and publication remain
open. Local/remote/publication receipts are distinct; shared dependency setup applies.
