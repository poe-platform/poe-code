# Maintained engine-free smoke selector review — UNRUN

The proposed new `tests/integration/agent-bash-smoke.test.ts` is a reasonable
maintained home. No existing broad suite or current HEAD is certified here, and
this review does not create that test or change a package script.

## Exact selection and dependency boundary

Use one literal test path with authenticated Node/tsx and its exact import closure:

```text
<bound-node> --import <bound-tsx> --test --test-reporter=tap tests/integration/agent-bash-smoke.test.ts
```

Do not use `npm test <path>`: the selected package script first globs
`tests/**/*.test.ts`, so appending an argument does not restrict discovery.
Do not substitute `typecheck:all`, a directory argument, a wildcard or the old
gate. A future `test:agent-bash` script must wrap only the literal selector and
requires its owner's authorization. It must not delegate to the broad script.

Import the selected public API and a small explicit test helper closure. Keep
PUBLIC engine/Worker adapters, archived runners, historical fixtures and native
oracles out of that import graph. A test-only module imported transitively can
run even when its filename is not selected: inventory imports, not just paths.
Store consumer templates as `.ts.fixture` until explicitly staged/typechecked;
the engine runner stays a separately selected `.mjs`, outside canonical `.test.ts`
discovery. An absent engine is an explicit unmet prerequisite, not a zero-case pass.

## Eight small maintained families

1. Literal independently declared80-name set; explicit Node registration,
   required-provider/config validation and asynchronous duplicate failure.
2. Unit2 supported strict flags and positional/state preservation.
3. Unit3 lazy conditional/quoted pattern semantics; reached unsupported cases
   remain explicit refusals, not boolean false or GNU parity.
4. Unit1 ordinary pipe/`|&`/`&>` ordering, exact file bytes and writer ownership.
5. Nounset/parameter failure before Node preparation; source syntax errors before
   any acquisition. No guest is needed to test a never-reached provider.
6. Arrays/functions/source/LET on the accepted scalar/canonical-index profile;
   no aggregate-u, binsh or arithmetic nounset claims.
7. Independently accepted N14 exact-return guard: raw falsy reason, cleanup barrier,
   caller dominance and consumed/unrelated-failure controls. Gate release lives
   in an independent finally, not a callback waiting on the same invocation.
8. Read-only VFS effects and mock curl hop authorization, with deterministic
   teardown. Mock authorization is not real network interoperability evidence.

An inert provider may record configuration and throw if unexpectedly prepared.
It must not invent `entryReturned` with no acquisition, the earlier public Node
fixture defect. If execution is needed for a host-only control, use a complete
accepted fake-provider receipt/profileFailure and label it synthetic, never
engine proof. Default imports/factory calls may load Worker class definitions
without starting a Worker; instrument actual application construction/start.

## Negative selector and ownership controls to preseal

- Place one task-owned unrelated `.test.ts` sentinel outside the literal list.
  It throws on import. Smoke must pass without importing it; this is a future
  proposed control, not permission to execute it now.
- Include a referenced-helper sentinel to show transitive discovery guards are
  meaningful; binding refusal must occur before product/engine admission.
- Refuse attempted application Worker construction, provider startup in a
  never-reached case, engine import, native process, live network or outside-VFS
  mutation. Do not mistake a fixed Node/tsx loader admission for a product Worker.
- Give each case its own VFS and recorded sinks. Await Shell.dispose and every
  enrolled operation. Distinguish caller cancellation from local controls,
  execution failure, numeric status and secondary cleanup; compare actual raw
  references/presence, not deserialized error lookalikes or truthiness.
- Source-built smoke may use explicitly bound source imports. Installed/moved
  consumers must use native package resolution with admitted package metadata,
  runtime and declarations, with old roots absent. Hashing aliases alone does
  not test the export map; retain the prior public Node I13 lesson.

The selector's existence, future script, complete helper/type/loader closure,
exact assertions and negative controls must be frozen before any actual grant.
No application or internal-loader Worker count is claimed by this design-only
review; all listed controls remain UNRUN.
