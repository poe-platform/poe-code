# Production rebase API checkpoint — August 27, 2026

Staged production source only; not release acceptance. Exclusive author ownership
is the nine source paths listed below and this author directory. No other writer
was spawned. Actual starting committed HEAD is
`a03b9288a6f4b652387be9fefa8faf17ef58b9e7`, tree
`d411959221ddce4c0b04d686aa5885c9db40e547`, not ROOT's earlier observation.
`BASELINE.json` binds each owned blob, historical receipts and foreign status.
There were no tracked dirty or staged inputs at the first observation.
The nine paths have no committed delta from proposal baseline `53f2a468`.

## Exact proposed public TypeScript shape

```ts
export interface ByteSink {
  write(chunk: Uint8Array): Promise<void>;
  readonly ownedOutput?: {
    readonly consumerClosed: AbortSignal;
    write(chunk: Uint8Array): Promise<void>;
  };
}

export interface OutputOperation {
  readonly signal: AbortSignal;
  readonly output: ByteSink;
  child(destination: ByteSink): OutputOperation;
  registerCleanup(cleanup: InvocationCleanup): void;
  acquire<Value>(
    start: (signal: AbortSignal) => Value | Promise<Value>,
    release: (resource: Value) => void | Promise<void>,
  ): Promise<Value>;
  close(): Promise<void>;
}

export function createOutputOperation(
  context: Pick<CommandContext, "signal" | "registerCleanup">,
  destination: ByteSink,
): OutputOperation;
```

`InvocationCleanup` is the existing `() => void | Promise<void>` type.
The network request adds only S1's optional
`readonly registerCleanup?: (cleanup: InvocationCleanup) => void` on `HttpRequest`.
`src/contracts/index.ts` exports `./output.js`; no root barrel change.
No `accountedWrite` field, `runtimeOwnedOutput` export, dependencies, private
runtime access, global configuration, or changed required host method.

## Acquisition and precedence profile

- Register the shared idempotent close with the context synchronously before any
  operation-owned acquisition. Each acquisition registers its disposer before
  calling `start`; registration failure or closed admission prevents `start`.
- Close synchronously seals admission, blocks new child/acquire/write/cleanup
  work, seals children, and drains all registered cleanup including admitted
  pending cooperative acquisitions and their eventual release. Child closure
  does not close siblings. Close calls share completion and cleanup is once-only.
- Material implementation correction to historical S1: its disposer returns
  immediately while `start` is pending, allowing public close to settle before
  resource acquisition/release. Track that admitted settlement internally;
  neither the signatures nor the approved cooperative-resource policy changes.
  Acquisition rejection is execution failure, not an invented cleanup failure;
  release failures remain cleanup failures. Drain every callback and preserve
  registration-order cleanup error reporting.
- Explicit consumer closure cancels only the enrolled output operation. Required
  file/header/stderr work uses separate children or the invocation signal, not
  the stdout consumer signal. Accounted capability writes retain every existing
  budget/capture wrapper once; legacy writes retain their current behavior.
- At public invocation settlement preserve exact caller abort identity before
  actual execution rejection before cleanup failure. Nonzero command results
  are not rejections. Do not mask a rejected command by prematurely aborting its
  already-completed pipeline controller.
- No waiting for arbitrary opaque command/input promises, implicit borrowed
  cursor return, stdin prebuffer, hard preemption, or hard RSS guarantee.

## Exact source write set

1. `src/contracts/io.ts`
2. `src/contracts/output.ts` (new)
3. `src/contracts/index.ts`
4. `src/shell/runtime.ts`
5. `src/shell/shell.ts`
6. `src/commands/network/types.ts`
7. `src/commands/network/transport.ts`
8. `src/commands/network/curl.ts`
9. `src/commands/streams.ts` (cat section and required import only)

## Provenance and limits

The proposal's exact in-memory receipt reconstruction was executed read-only:
B0 to V1 has nine feature paths; retention has four paths; final S1 adjusts only
curl/output. Q archive equals reconstructed final S1. The three captured dirty
tree-command baseline files are historical data, not feature inputs. Historical
S1 identity is `6de9b96c7286cc320379d8f7f720f3d1a5ecffdc24b7268b198859550362feea`.
Current zero validation in `shared.ts` equals accepted `bb7f5972`; it is untouched.
No rejected V2/prebuffer source is used. Accepted zero-overlay audit is historical
evidence only, not a production promotion or a gate for this candidate.

Proceeding because this API is materially identical to approved S1. Focused
regressions will cover the admitted acquisition correction. Build/package/current
private SafeJS checks remain ROOT-delegated pending candidate freeze; author
checks cannot substitute for a different final verifier.
