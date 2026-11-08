# B01 API boundary

This repair changes no API. It exercises only the already-frozen private helper
extension from `88d91975e4a718fb3c1b55322e44492cf4059391` and requires these existing
signatures to remain unchanged:

```ts
function prepareChildCancellation(
  parent: CancellationBoundary,
  options?: CancellationInvokeOptions,
  snapshot?: CancellationAdmissionSnapshot,
  controls?: readonly CancellationControlOriginInput[],
): PreparedChildCancellation;

function activateChildCancellation(
  prepared: PreparedChildCancellation,
): CancellationBoundary;

function selectRuntimeCancellationOutcome<Value>(
  boundary: CancellationBoundary,
  captured: CapturedCancellationOutcome<Value>,
  observedOrigin?: CancellationOrigin,
): CancellationSelection<Value>;
```

The accepted Stage 1 `selectCancellationOutcome` behavior and all preparation,
activation, ownership, callback, report-authentication, and close APIs are out of
repair scope. No Runtime/Shell integration or public export is added.
