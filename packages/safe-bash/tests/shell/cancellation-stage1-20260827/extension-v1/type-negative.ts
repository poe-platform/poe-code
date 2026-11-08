import {
  activateChildCancellation,
  prepareChildCancellation,
  selectRuntimeCancellationOutcome,
} from "../../../../src/shell/cancellation.js";
import type {
  CancellationAdmissionSnapshot,
  CancellationBoundary,
  CancellationOrigin,
  PreparedChildCancellation,
} from "../../../../src/shell/cancellation.js";

declare const parent: CancellationBoundary;
declare const admission: CancellationAdmissionSnapshot;
declare const prepared: PreparedChildCancellation;
declare const origin: CancellationOrigin;

prepareChildCancellation(parent);
prepareChildCancellation(parent, undefined, undefined, undefined);
prepareChildCancellation(parent, {}, undefined, []);
prepareChildCancellation(parent, { signal: undefined }, undefined, undefined);
prepareChildCancellation(parent, { signal: new AbortController().signal }, admission, []);
prepareChildCancellation(parent, undefined, admission, [
  { role: "pipeline-control", signal: new AbortController().signal },
]);
activateChildCancellation(prepared);
selectRuntimeCancellationOutcome(parent, { kind: "return", value: 0 });
selectRuntimeCancellationOutcome(parent, { kind: "throw", reason: undefined }, origin);

// @ts-expect-error prepared values are opaque and cannot be fabricated
activateChildCancellation({ owned: true });
// @ts-expect-error null is not an invoke signal
prepareChildCancellation(parent, { signal: null }, admission);
// @ts-expect-error controls only accept original cancellation roles
prepareChildCancellation(parent, undefined, admission, [{ role: "invoke-option", signal: new AbortController().signal }]);
// @ts-expect-error a controller is not a control signal
prepareChildCancellation(parent, undefined, admission, [{ role: "budget-control", signal: new AbortController() }]);
// @ts-expect-error observed origin must be a helper cancellation origin
selectRuntimeCancellationOutcome(parent, { kind: "throw", reason: 0 }, { role: "invoke-option" });

