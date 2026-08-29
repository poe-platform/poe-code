import { types as utilTypes } from "node:util";
import { EreProfileLimitError, EreUnsupportedError } from "../errors.js";
import { deriveEreLimits } from "../limits.js";
import type { EreFragment, EreLimits, EreResource, EreUsage } from "../types.js";
import { add, integer, multiply, TransportAccounting } from "./accounting.js";
import { EreTransportError, EreTransportProfileLimitError, operation, profile, resources } from "./protocol.js";
import type { EreTransportInput, EreTransportReply, EreTransportRequest, EreTransportResult } from "./protocol.js";

const inputKeys = Object.freeze(["pattern", "subject"]);
const fragmentKeys = Object.freeze(["text", "literal"]);
const resultKeys = Object.freeze(["matched", "groupCount", "spans", "steps", "allocatedUnits"]);
const spanKeys = Object.freeze(["start", "end"]);
const replyKeys = Object.freeze(["version", "operation", "id", "grantId", "kind", "result", "usage"]);
const failureKeys = Object.freeze(["version", "operation", "id", "grantId", "kind", "category", "resource", "offset", "usage"]);

function fail(): never { throw new EreTransportError("PROTOCOL", "invalid ERE transport frame"); }

function data(value: unknown, key: string, transport?: TransportAccounting): unknown {
  const scratch = transport?.owned(5);
  try {
    if (value === null || typeof value !== "object" || utilTypes.isProxy(value)) return fail();
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || !Object.hasOwn(descriptor, "value")) return fail();
  return descriptor.value;
  } finally { scratch?.retire(); }
}

function indexed(value: readonly unknown[], index: number, transport?: TransportAccounting): unknown {
  const scratch = transport?.owned(16);
  try { return data(value, String(index), transport); }
  finally { scratch?.retire(); }
}

export function record(value: unknown, keys: readonly string[], visit: (units: number) => void, transport?: TransportAccounting): Record<string, unknown> {
  visit(1 + keys.length);
  if (value === null || typeof value !== "object" || utilTypes.isProxy(value) || Array.isArray(value)) return fail();
  const scratch = transport?.owned(add(1, multiply(keys.length, 6)));
  try {
    const actual = Reflect.ownKeys(value);
  if (actual.length !== keys.length) return fail();
  for (let index = 0; index < keys.length; index++) {
    if (actual[index] !== keys[index]) return fail();
    const descriptor = Object.getOwnPropertyDescriptor(value, keys[index]!);
    if (!descriptor || !Object.hasOwn(descriptor, "value")) return fail();
  }
  return value as Record<string, unknown>;
  } finally { scratch?.retire(); }
}

function array(value: unknown, maximum: number, visit: (units: number) => void, overLimit: () => never = fail, transport?: TransportAccounting): readonly unknown[] {
  visit(1);
  if (value === null || typeof value !== "object" || utilTypes.isProxy(value) || !Array.isArray(value)) return fail();
  const lengthValue = data(value, "length", transport);
  integer(lengthValue);
  if (lengthValue > maximum) return overLimit();
  visit(lengthValue);
  const scratch = transport?.owned(add(2, multiply(lengthValue, 22)));
  try {
    const keys = Reflect.ownKeys(value);
  if (keys.length !== lengthValue + 1 || keys[keys.length - 1] !== "length") return fail();
  for (let index = 0; index < lengthValue; index++) {
    const key = String(index);
    if (keys[index] !== key) return fail();
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !Object.hasOwn(descriptor, "value")) return fail();
  }
  return value;
  } finally { scratch?.retire(); }
}

function ascii(value: unknown, cap: number, visit: (units: number) => void): string {
  if (typeof value !== "string" || value.length > cap) return fail();
  for (let offset = 0; offset < value.length; offset++) {
    visit(1);
    if (value.charCodeAt(offset) === 0 || value.charCodeAt(offset) > 127) return fail();
  }
  return value;
}

export function usage(value: unknown, allowance: EreLimits, visit: (units: number) => void, transport?: TransportAccounting): EreUsage {
  const fields = record(value, resources, visit, transport);
  for (const key of resources) { integer(fields[key]); if ((fields[key] as number) > allowance[key]) return fail(); }
  return fields as unknown as EreUsage;
}

export interface InspectedInput {
  readonly input: EreTransportInput;
  readonly patternBytes: number;
  readonly units: number;
}

export function inspectInput(value: EreTransportInput, limits: EreLimits, transport: TransportAccounting, signal?: AbortSignal): InspectedInput {
  const visit = (amount: number): void => { if (signal?.aborted) throw signal.reason; transport.visit(amount); };
  const input = record(value, inputKeys, visit, transport);
  if (typeof input.subject !== "string") return fail();
  if (input.subject.length > limits.subjectBytes) throw new EreProfileLimitError("subjectBytes", limits.subjectBytes);
  const maximum = Math.max(0, Math.floor((Math.floor(transport.available / 2) - 47 - input.subject.length) / 4));
  const fragments = array(input.pattern, maximum, visit, () => { throw new EreTransportProfileLimitError("transportStorage", transport.storageLimit); }, transport);
  let bytes = 0;
  for (let index = 0; index < fragments.length; index++) {
    const item = indexed(fragments, index, transport);
    const fragment = record(item, fragmentKeys, visit, transport);
    if (typeof fragment.text !== "string" || typeof fragment.literal !== "boolean") return fail();
    if (fragment.text.length > limits.patternBytes - bytes) throw new EreProfileLimitError("patternBytes", limits.patternBytes);
    for (let offset = 0; offset < fragment.text.length; offset++) {
      visit(1);
      if (fragment.text.charCodeAt(offset) === 0 || fragment.text.charCodeAt(offset) > 127) throw new EreUnsupportedError("transport requires non-NUL ASCII", bytes + offset);
    }
    bytes += fragment.text.length;
  }
  for (let offset = 0; offset < input.subject.length; offset++) {
    visit(1);
    if (input.subject.charCodeAt(offset) === 0 || input.subject.charCodeAt(offset) > 127) throw new EreUnsupportedError("transport requires non-NUL ASCII subject", offset);
  }
  const units = add(add(47, multiply(fragments.length, 4)), add(bytes, input.subject.length));
  if (multiply(units, 2) > transport.available) throw new EreTransportProfileLimitError("transportStorage", transport.storageLimit);
  return { input: value, patternBytes: bytes, units };
}

export function copyInput(inspected: InspectedInput, transport: TransportAccounting): EreTransportInput {
  transport.visit(inspected.units);
  const pattern: EreFragment[] = [];
  for (let index = 0; index < inspected.input.pattern.length; index++) {
    const fragment = indexed(inspected.input.pattern, index, transport) as EreFragment;
    const text = data(fragment, "text", transport);
    const literal = data(fragment, "literal", transport);
    if (typeof text !== "string" || typeof literal !== "boolean") return fail();
    pattern.push(Object.freeze({ text, literal }));
  }
  return Object.freeze({ pattern: Object.freeze(pattern), subject: inspected.input.subject });
}

export function validateRequest(value: unknown, prepaidWork = 0, observed?: (units: number) => void): EreTransportRequest {
  integer(prepaidWork);
  let work = prepaidWork;
  let workLimit: number | undefined;
  const visit = (amount: number): void => {
    const next = add(work, amount);
    if (workLimit !== undefined && next > workLimit) throw new EreProfileLimitError("work", workLimit);
    work = next;
    observed?.(amount);
  };
  const frame = record(value, ["version", "operation", "id", "grantId", "profile", "bounds", "allowance", "pattern", "subject"], visit);
  if (frame.version !== 1 || frame.operation !== operation || frame.profile !== profile) return fail();
  integer(frame.id); integer(frame.grantId); if (frame.id === 0 || frame.grantId === 0) return fail();
  const bounds = record(frame.bounds, ["maxExpansionBytes", "maxExpansionFields"], visit);
  integer(bounds.maxExpansionBytes); integer(bounds.maxExpansionFields);
  const limits = deriveEreLimits({ maxExpansionBytes: bounds.maxExpansionBytes, maxExpansionFields: bounds.maxExpansionFields });
  visit(resources.length);
  const allowance = usage(frame.allowance, limits, visit);
  workLimit = allowance.work;
  if (work > workLimit) throw new EreProfileLimitError("work", workLimit);
  const fragments = array(frame.pattern, Math.floor(limits.allocationUnits / 8), visit);
  let bytes = 0;
  for (let index = 0; index < fragments.length; index++) {
    visit(1);
    const item = indexed(fragments, index);
    const fragment = record(item, ["text", "literal"], visit);
    const text = ascii(fragment.text, limits.patternBytes - bytes, visit);
    if (typeof fragment.literal !== "boolean") return fail(); bytes += text.length;
  }
  const subject = ascii(frame.subject, limits.subjectBytes, visit);
  if (multiply(add(add(47, multiply(fragments.length, 4)), add(bytes, subject.length)), 2) > limits.allocationUnits) return fail();
  return value as EreTransportRequest;
}

export function validateReply(value: unknown, request: EreTransportRequest, visit: (units: number) => void, transport?: TransportAccounting): { reply: EreTransportReply; replyUnits: number; resultUnits: number } {
  if (value === null || typeof value !== "object" || utilTypes.isProxy(value)) return fail();
  const kind = data(value, "kind", transport);
  const keys = kind === "result" ? replyKeys : failureKeys;
  const frame = record(value, keys, visit, transport);
  if (frame.version !== 1 || frame.operation !== operation || frame.id !== request.id || frame.grantId !== request.grantId) return fail();
  const spent = usage(frame.usage, request.allowance, visit, transport);
  visit(operation.length);
  if (frame.kind === "failure") {
    if (frame.category !== "syntax" && frame.category !== "unsupported" && frame.category !== "profile-limit") return fail();
    if (frame.category === "profile-limit") {
      if (!resources.includes(frame.resource as EreResource) || frame.offset !== null) return fail();
    } else {
      if (frame.resource !== null) return fail();
      if (frame.offset !== null) { integer(frame.offset); if (frame.offset > request.allowance.patternBytes) return fail(); }
    }
    const units = 34 + frame.category.length + (typeof frame.resource === "string" ? frame.resource.length : 0);
    visit(7 + frame.category.length + (typeof frame.resource === "string" ? frame.resource.length : 0));
    return { reply: value as EreTransportReply, replyUnits: units, resultUnits: 0 };
  }
  if (frame.kind !== "result") return fail();
  const result = record(frame.result, resultKeys, visit, transport);
  if (typeof result.matched !== "boolean") return fail();
  integer(result.groupCount); integer(result.steps); integer(result.allocatedUnits);
  if (result.groupCount > 32 || result.steps !== spent.work || result.allocatedUnits !== spent.allocationUnits) return fail();
  const spans = array(result.spans, 33, visit, fail, transport);
  if (spans.length !== result.groupCount + 1) return fail();
  let participating = 0; let captureBytes = 0; let overall: { start: number; end: number } | null = null;
  for (let index = 0; index < spans.length; index++) {
    const item = indexed(spans, index, transport);
    if (item === null) { if (index === 0 && result.matched) return fail(); continue; }
    if (!result.matched) return fail();
    const span = record(item, spanKeys, visit, transport); integer(span.start); integer(span.end);
    if (span.start > span.end || span.end > request.subject.length) return fail();
    if (index === 0) overall = span as unknown as { start: number; end: number };
    else if (!overall || span.start < overall.start || span.end > overall.end) return fail();
    captureBytes = add(captureBytes, span.end - span.start); participating++;
  }
  if (result.matched ? spent.captureSlots !== spans.length || spent.captureBytes !== captureBytes : spent.captureSlots !== 0 || spent.captureBytes !== 0) return fail();
  const resultUnits = 7 + spans.length + 3 * participating;
  visit(6);
  return { reply: value as EreTransportReply, replyUnits: 31 + resultUnits, resultUnits };
}

export function copyReplyResult(reply: Extract<EreTransportReply, { kind: "result" }>, transport?: TransportAccounting): EreTransportResult {
  const value = reply.result;
  const spans: ({ readonly start: number; readonly end: number } | null)[] = [];
  for (let index = 0; index < value.spans.length; index++) {
    const span = indexed(value.spans, index, transport);
    if (span === null) spans.push(null);
    else {
      const start = data(span, "start", transport);
      const end = data(span, "end", transport);
      integer(start); integer(end);
      spans.push(Object.freeze({ start, end }));
    }
  }
  return Object.freeze({ matched: value.matched, groupCount: value.groupCount, spans: Object.freeze(spans), steps: value.steps, allocatedUnits: value.allocatedUnits });
}
