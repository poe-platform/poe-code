import { object, objectKeys, put, type Json } from "../structured/limits.js";
import { Decimal, numberText } from "../structured/numbers.js";
import type { YqOwnedWork } from "../structured/query-core.js";
import { YqError, limit } from "./errors.js";

export const yqCaps = Object.freeze({
  maxArgvEntries: 4096,
  maxArgvUtf8Bytes: 65_536,
  maxVfsOperandPathBytes: 16_384,
  maxInputBytes: 16_000_000,
  maxDocumentBytes: 8_388_608,
  maxValueBytes: 8_388_608,
  maxScalarBytes: 1_048_576,
  maxQuerySourceBytes: 8192,
  maxDepth: 128,
  maxAstDepth: 64,
  maxSteps: 1_000_000,
  maxResults: 100_000,
  maxCollectionSize: 100_000,
  maxDocuments: 1024,
  maxAnchorsPerDocument: 1024,
  maxAliasReferences: 1024,
  maxDocumentNodes: 100_000,
  maxOutputBytes: 16_777_216,
  diagnosticReserveBytes: 4096,
  stdoutCapBytes: 16_773_120,
  maxDisplayedFilenameBytes: 256,
});

function checked(current: number, incoming: number, limitValue: number, code: Parameters<typeof limit>[0]): number {
  if (!Number.isSafeInteger(incoming) || incoming < 0) throw new RangeError("invalid yq accounting projection");
  if (incoming > limitValue - current) throw limit(code);
  return current + incoming;
}

export class YqLedger {
  documents = 0;
  aliases = 0;
  documentNodes = 0;
  documentValueBytes = 0;
  anchors = 0;
  stdoutBytes = 0;
  combinedOutputBytes = 0;

  admitDocumentBytes(rawBytes: number): void {
    if (!Number.isSafeInteger(rawBytes) || rawBytes < 0) throw new RangeError("invalid raw document byte count");
    if (rawBytes > yqCaps.maxDocumentBytes) throw limit("LIMIT_MAX_DOCUMENT_BYTES");
  }

  beginDocument(rawBytes: number): void {
    this.admitDocumentBytes(rawBytes);
    this.documents = checked(this.documents, 1, yqCaps.maxDocuments, "LIMIT_MAX_DOCUMENTS");
    this.documentNodes = 0;
    this.documentValueBytes = 0;
    this.anchors = 0;
  }

  admitNode(): void {
    this.documentNodes = checked(this.documentNodes, 1, yqCaps.maxDocumentNodes, "LIMIT_MAX_DOCUMENT_NODES");
  }

  admitAnchor(): void {
    this.anchors = checked(this.anchors, 1, yqCaps.maxAnchorsPerDocument, "LIMIT_MAX_ANCHORS_PER_DOCUMENT");
  }

  admitScalar(bytes: number): void {
    if (bytes > yqCaps.maxScalarBytes) throw limit("LIMIT_MAX_SCALAR_BYTES");
  }

  admitValueBytes(bytes: number): void {
    this.documentValueBytes = checked(this.documentValueBytes, bytes, yqCaps.maxValueBytes, "LIMIT_MAX_VALUE_BYTES");
  }

  preflightAlias(descriptor: AliasDescriptor): { readonly aliases: number; readonly nodes: number; readonly valueBytes: number } {
    const aliases = checked(this.aliases, 1, yqCaps.maxAliasReferences, "LIMIT_MAX_ALIAS_REFERENCES");
    const nodes = checked(this.documentNodes, descriptor.nodes, yqCaps.maxDocumentNodes, "LIMIT_MAX_DOCUMENT_NODES");
    const valueBytes = checked(this.documentValueBytes, descriptor.compactBytes, yqCaps.maxValueBytes, "LIMIT_MAX_VALUE_BYTES");
    if (descriptor.maxDepth > yqCaps.maxDepth) throw limit("LIMIT_MAX_DEPTH");
    return { aliases, nodes, valueBytes };
  }

  commitAlias(projection: { readonly aliases: number; readonly nodes: number; readonly valueBytes: number }): void {
    this.aliases = projection.aliases;
    this.documentNodes = projection.nodes;
    this.documentValueBytes = projection.valueBytes;
  }

  admitStdout(bytes: number): void {
    this.stdoutBytes = checked(this.stdoutBytes, bytes, yqCaps.stdoutCapBytes, "LIMIT_MAX_OUTPUT_BYTES");
    this.combinedOutputBytes = checked(this.combinedOutputBytes, bytes, yqCaps.maxOutputBytes, "LIMIT_MAX_OUTPUT_BYTES");
  }

  canAdmitDiagnostic(bytes: number): boolean {
    return Number.isSafeInteger(bytes)
      && bytes >= 0
      && bytes <= yqCaps.diagnosticReserveBytes
      && bytes <= yqCaps.maxOutputBytes - this.combinedOutputBytes;
  }

  admitDiagnostic(bytes: number): void {
    if (!this.canAdmitDiagnostic(bytes)) throw limit("LIMIT_MAX_OUTPUT_BYTES");
    this.combinedOutputBytes += bytes;
  }
}

export interface AliasDescriptor {
  readonly nodes: number;
  readonly compactBytes: number;
  readonly maxDepth: number;
  readonly ordinaryUnits: number;
}

function addProjection(current: number, incoming: number): number {
  if (!Number.isSafeInteger(incoming) || incoming < 0 || incoming > Number.MAX_SAFE_INTEGER - current) {
    throw new RangeError("alias projection overflow");
  }
  return current + incoming;
}

async function payload(work: YqOwnedWork, text: string): Promise<number> {
  let codePoints = 0;
  let bytes = 0;
  for (const character of text) {
    codePoints++;
    bytes += Buffer.byteLength(character);
    if (codePoints === 256) {
      await work.charge(codePoints);
      work.assertOpen();
      codePoints = 0;
    }
  }
  if (codePoints > 0) {
    await work.charge(codePoints);
    work.assertOpen();
  }
  const units = bytes === 0 ? 0 : Math.ceil(bytes / 1024);
  if (units > 0) {
    await work.charge(units);
    work.assertOpen();
  }
  return units;
}

function jsonStringBytes(text: string): number {
  let bytes = 2;
  for (const character of text) {
    const point = character.codePointAt(0)!;
    if (point === 0x22 || point === 0x5c || point === 0x08 || point === 0x0c || point === 0x0a || point === 0x0d || point === 0x09) bytes += 2;
    else if (point < 0x20) bytes += 6;
    else bytes += Buffer.byteLength(character);
  }
  return bytes;
}

export async function estimateAlias(value: Json, work: YqOwnedWork): Promise<AliasDescriptor> {
  let nodes = 0;
  let compactBytes = 0;
  let maxDepth = 0;
  let ordinaryUnits = 0;
  const stack: { readonly value: Json; readonly depth: number }[] = [{ value, depth: 0 }];
  while (stack.length > 0) {
    const item = stack.pop()!;
    await work.charge(1);
    work.assertOpen();
    nodes = addProjection(nodes, 1);
    ordinaryUnits = addProjection(ordinaryUnits, 1);
    maxDepth = Math.max(maxDepth, item.depth);
    if (maxDepth > yqCaps.maxDepth) throw limit("LIMIT_MAX_DEPTH");
    const current = item.value;
    if (current === null || typeof current === "boolean") {
      compactBytes = addProjection(compactBytes, Buffer.byteLength(JSON.stringify(current)));
    } else if (typeof current === "number" || current instanceof Decimal) {
      const text = numberText(current);
      const units = await payload(work, text);
      work.assertOpen();
      ordinaryUnits = addProjection(ordinaryUnits, units);
      compactBytes = addProjection(compactBytes, Buffer.byteLength(text));
    } else if (typeof current === "string") {
      const units = await payload(work, current);
      work.assertOpen();
      ordinaryUnits = addProjection(ordinaryUnits, units);
      compactBytes = addProjection(compactBytes, jsonStringBytes(current));
    } else {
      const keys = Array.isArray(current) ? Object.keys(current) : objectKeys(current);
      if (keys.length > yqCaps.maxCollectionSize) throw limit("LIMIT_MAX_COLLECTION_SIZE");
      compactBytes = addProjection(compactBytes, 2 + Math.max(0, keys.length - 1));
      for (let index = keys.length - 1; index >= 0; index--) {
        const key = keys[index]!;
        if (!Array.isArray(current)) {
          const units = await payload(work, key);
          work.assertOpen();
          ordinaryUnits = addProjection(ordinaryUnits, units);
          compactBytes = addProjection(compactBytes, jsonStringBytes(key) + 1);
        }
        stack.push({ value: (current as Record<string, Json>)[key]!, depth: item.depth + 1 });
      }
    }
    if (compactBytes > yqCaps.maxValueBytes) throw limit("LIMIT_MAX_VALUE_BYTES");
  }
  return Object.freeze({ nodes, compactBytes, maxDepth, ordinaryUnits });
}

async function consumePayload(work: YqOwnedWork, reservation: ReturnType<YqOwnedWork["reserve"]>, text: string): Promise<void> {
  const bytes = Buffer.byteLength(text);
  const units = bytes === 0 ? 0 : Math.ceil(bytes / 1024);
  for (let unit = 0; unit < units; unit++) {
    await reservation.beforeUnit();
    work.assertOpen();
  }
}

export async function copyAlias(value: Json, ledger: YqLedger, work: YqOwnedWork): Promise<Json> {
  const descriptor = await estimateAlias(value, work);
  work.assertOpen();
  const projection = ledger.preflightAlias(descriptor);
  const reservation = work.reserve(descriptor.ordinaryUnits);
  ledger.commitAlias(projection);
  let completed = false;
  const copy = async (current: Json): Promise<Json> => {
    await reservation.beforeUnit();
    work.assertOpen();
    if (current === null || typeof current === "boolean") return current;
    if (typeof current === "number" || current instanceof Decimal) {
      await consumePayload(work, reservation, numberText(current));
      work.assertOpen();
      return current;
    }
    if (typeof current === "string") {
      await consumePayload(work, reservation, current);
      work.assertOpen();
      return current;
    }
    if (Array.isArray(current)) {
      const result: Json[] = [];
      for (const child of current) {
        const copied = await copy(child);
        work.assertOpen();
        result.push(copied);
      }
      return result;
    }
    const result = object();
    for (const key of objectKeys(current)) {
      await consumePayload(work, reservation, key);
      work.assertOpen();
      const copied = await copy(current[key]!);
      work.assertOpen();
      put(result, key, copied);
    }
    return result;
  };
  try {
    const result = await copy(value);
    work.assertOpen();
    reservation.finish();
    work.assertOpen();
    completed = true;
    return result;
  } finally {
    if (!completed) reservation.abandon();
  }
}

export function aliasFailure(code: "ALIAS_UNDEFINED" | "ALIAS_FORWARD" | "ALIAS_CURRENT_NODE" | "ALIAS_CYCLE"): YqError {
  return new YqError("alias", code, 5);
}
