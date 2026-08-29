import { types } from "node:util";
import { nodeLimits, type NodeObservation, type NodeReason } from "./types.js";

export interface NodeObservationPublication {
  readonly observation: NodeObservation;
  readonly publisherFault: NodeReason | undefined;
}
export function observeNodeFailure(reason: unknown): NodeObservation {
  const fields: { name: string | null; message: string | null; code: string | null } = { name: null, message: null, code: null };
  let fault = false;
  try {
    if (reason !== null && typeof reason === "object" && !types.isProxy(reason)) {
      for (const key of ["name", "message", "code"] as const) {
        const descriptor = Object.getOwnPropertyDescriptor(reason, key);
        if (!descriptor) continue;
        if (!Object.hasOwn(descriptor, "value")) { fault = true; continue; }
        const value: unknown = descriptor.value;
        if (typeof value !== "string") continue;
        if (value.length > nodeLimits.errorBytes || Buffer.byteLength(value) > nodeLimits.errorBytes) { fault = true; continue; }
        fields[key] = value;
      }
    } else if (types.isProxy(reason)) fault = true;
  } catch { fault = true; }
  return Object.freeze({ state: fields.name === null && fields.message === null && fields.code === null ? "unknown" : "captured", fault, ...fields });
}
export function publishNodeObservation(reason: unknown, publish: (observation: NodeObservation) => void): NodeObservationPublication {
  const observation = observeNodeFailure(reason);
  try { publish(observation); return { observation, publisherFault: undefined }; }
  catch (error) { return { observation: Object.freeze({ ...observation, fault: true }), publisherFault: { present: true, value: error } }; }
}
