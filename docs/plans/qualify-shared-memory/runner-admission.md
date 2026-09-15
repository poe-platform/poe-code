# Shared-memory fixture admission

Owner: qualify-shared-memory, maintained Test262 integration. Target remains
ECMA-262 edition 16 and Test262 419d3e0a2273ba01a3bfcbec423f2801425b8e93.
Source: local main e044be891151cf6f4b3ff20eaaf8838b687e3869, Node 22.23.2 / ICU 78.2.

Before the change, a SharedArrayBuffer/Atomics feature tag caused unconditional
exclusion even for integer operations requiring no child agent. CanBlockIsFalse
was also excluded although the runtime deliberately rejects synchronous waits.
Two new semantic assertions failed, while a CanBlockIsTrue exclusion control
passed (2.14 s). The change admits non-agent shared-memory fixtures and verifies
the host's nonblocking contract. Guest blocking authority is unchanged.

```sh
npx vitest run packages/safe-js/test/conformance/shared-memory.test.ts packages/safe-js/test/conformance/execute.test.ts packages/safe-js/test/conformance/worker.test.ts
```

After repair: 49 passed (2.87 s). Existing tests now restrict exclusion assertions
to genuinely unavailable capabilities; the new tests verify real Number/BigInt
operations and TypeError from a synchronous infinite wait. This is runner
admission, not proof of all shared semantics. Child-agent fixtures and
CanBlockIsTrue remain unsupported, so agent acceptance is open. Pinned upstream
results and failed setup attempts are retained in `qualification.md`.
