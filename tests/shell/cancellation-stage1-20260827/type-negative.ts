import { admitChildCancellation } from "../../../src/shell/cancellation.js";
import type { CancellationAdmissionSnapshot, CancellationBoundary } from "../../../src/shell/cancellation.js";

declare const parent: CancellationBoundary;
declare const admission: CancellationAdmissionSnapshot;

admitChildCancellation(parent);
admitChildCancellation(parent, undefined);
admitChildCancellation(parent, {});
admitChildCancellation(parent, { signal: undefined });
admitChildCancellation(parent, { signal: new AbortController().signal }, admission);

// @ts-expect-error null is not a signal
admitChildCancellation(parent, { signal: null }, admission);
// @ts-expect-error a lookalike is not a native AbortSignal type
admitChildCancellation(parent, { signal: { aborted: false, reason: undefined } }, admission);
// @ts-expect-error an AbortController is not its AbortSignal
admitChildCancellation(parent, { signal: new AbortController() }, admission);
// @ts-expect-error primitives are not AbortSignals
admitChildCancellation(parent, { signal: false }, admission);
