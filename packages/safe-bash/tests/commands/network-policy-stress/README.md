# Bounded independent network-policy tests

Run from repository root:

```sh
node --unhandled-rejections=strict --import tsx --test tests/commands/network-policy-stress/*.test.ts
node_modules/.bin/tsc --noEmit -p tests/commands/network-policy-stress/tsconfig.json
```

The 22 cases exercise authorization-object mutation, captured callbacks,
pending deny/abort/deadline, settlement ordering, late rejection, and URL policy
inputs. All transports are deterministic injected fixtures: no sockets, DNS,
public requests, native curl, private repositories, or new dependencies.
The VFS fixture rejects any access. No method/body/file/retry parity is tested.

Pending-policy races require an explicit callback-entry barrier and an
independently controlled decision promise. Two event-loop turns flush already
queued continuations; they do not approximate a policy-entry barrier with sleep.
The host deadline case must finish while policy remains unresolved, then reject
late approval effects. Each barrier has a two-second failure deadline; helper
invocations supply a 1.5-second command deadline, capped by any tighter host
limit. Tests abort execution and settle pending fixtures in cleanup.

Late-rejection cases execute under strict unhandled-rejection handling in
separate children. They require clean natural exit and exact success markers,
with a four-second child watchdog, six-second parent kill deadline, and bounded
output. The decision rejection has no test-installed catch: product code must
observe it. Abort listeners on the policy signal must be removed after completion.

Passing assertions establish only the stated behavior under these fixtures.
URL strings delivered to authorization and transport agree, including numeric
IPv4 normalization and userinfo parsing. This is not resolved-address policy:
the default Node transport has no DNS address pinning or socket-address
allowlist check. **Hostname allowlisting does not prevent DNS rebinding.**
Injected transports remain trusted to issue only the authorized request, avoid
automatic extra hops, honor cancellation, and release resources. The plugin
cannot forcibly constrain a dishonest transport or cancel arbitrary host work.
No live rebinding, universal SSRF prevention, or universal security is claimed.

## Admission DIAGNOSTIC (not an acceptance gate)
Run: `node --unhandled-rejections=strict --import tsx tests/commands/network-policy-stress/admission.probe.ts`
Four bounded orderings print dispatch counts, signal state, effects and rejection identity.
Observed: two/three nested abort microtasks can admit transport with an aborted signal.
This is a cancellation boundary, not a demonstrated current-contract source bug or SSRF bypass:
trusted transports must honor cancellation; never-aborted callback admission is not promised.
Only documented caller cancellation and cooperative zero-effect behavior are asserted;
dispatch counts are observations, not desired behavior. This adds no cases to the 22-test total.

## Validated handoff — August 26, 2026

On Node v22.22.2, the exact test and scoped TypeScript commands above each ran
once for this handoff: **22/22 pass**, zero failures/cancellations/skips/todos;
TypeScript exits 0, including the standalone diagnostic. The diagnostic command
above also ran once and exited naturally with status 0. Observed dispatch counts
were `0,0,1,1`; admitted requests had already-aborted signals, exact caller
rejection identity was preserved in all four orderings, and cooperative
post-guard effects were zero. Counts remain observations, not desired behavior.
This is not a demonstrated authorization bypass, SSRF bypass, or current-contract
defect; trusted transports must honor cancellation.

Relevant source SHA256 values were identical before and after these runs:

```text
4859cc27a94d4ffe74ecadf20280d5d519d85babc50d24f55b9c51357c2dca42 src/commands/network/curl.ts
7adab18b67c7584b646b3a6508729d7ab0672e7a0808f512f74ae16464f8842f src/commands/network/shared.ts
b6246ceacc90c0451028755fdf9cbb795790968676f48c8e3f9258128286f844 src/commands/network/transport.ts
806dd2132dd4004404dbb5c21a421e84c53c161f750f6acc1aedd0f8054b5fe9 src/commands/network/types.ts
41e75f9ae587e63a61344df06b0cb518eae1f1d5eab155fd5892026c8c1ccb0f src/commands/network/README.md
```

**For Archimedes:** consider a cancellation recheck **inside the queued callback**,
immediately before invoking transport around `src/commands/network/curl.ts:172`,
as robustness strengthening if appropriate. This audit supplies no source fix,
does not require that strengthening under the current contract, and makes no
stronger race-proof claim. Original 22-case files and diagnostic remain unchanged.
