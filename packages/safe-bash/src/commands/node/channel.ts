import { NodeProfileError, nodeLimits, type NodeLimits } from "./types.js";
import { integer } from "./values.js";

export const phases = Object.freeze({ metadata: 1, uploadCredit: 2, upload: 3, result: 4, dataCredit: 5, data: 6, final: 7, metadataCredit: 8, resultCredit: 9 });
export interface NodeFrame { readonly frame: number; readonly sequence: number; readonly phase: number; readonly total: number; readonly offset: number; readonly bytes: Uint8Array; }
export interface NodeChannel { readonly header: Int32Array; readonly payload: Uint8Array; readonly numbers: Float64Array; readonly limits: NodeLimits; wakes: number; }
export function channel(sab: SharedArrayBuffer, limits: NodeLimits = nodeLimits): NodeChannel {
  if (sab.byteLength !== nodeLimits.sabBytes) throw new NodeProfileError("shared channel size");
  return { limits, numbers: new Float64Array(sab, 64, 6), header: new Int32Array(sab, 0, 112), payload: new Uint8Array(sab, 448, 65536), wakes: 0 };
}
export function stop(channelValue: NodeChannel): void { Atomics.store(channelValue.header, 8, 1); Atomics.store(channelValue.header, 0, 3); Atomics.notify(channelValue.header, 0); }
export function stopped(channelValue: NodeChannel): void { if (Atomics.load(channelValue.header, 8) !== 0) throw new NodeProfileError("Worker channel stopped"); }
export function publish(channelValue: NodeChannel, state: 1 | 2, frame: NodeFrame): void {
  stopped(channelValue);
  integer(frame.frame, channelValue.limits.frames, "frame"); integer(frame.sequence, channelValue.limits.operations, "sequence"); integer(frame.phase, 9, "phase"); integer(frame.total, [phases.metadata, phases.metadataCredit, phases.result, phases.resultCredit].some(value => value === frame.phase) ? channelValue.limits.metadataBytes : channelValue.limits.operationBytes, "frame total"); integer(frame.offset, frame.total, "frame offset");
  if (frame.frame === 0 || frame.sequence === 0 || frame.phase === 0 || frame.bytes.byteLength > 65536) throw new NodeProfileError("frame fields");
  channelValue.payload.set(frame.bytes);
  for (const [index, value] of [[1, frame.frame], [2, frame.sequence], [3, frame.phase], [4, frame.total], [5, frame.offset], [6, frame.bytes.byteLength]] as const) channelValue.numbers[index - 1] = value;
  Atomics.store(channelValue.header, 0, state); Atomics.notify(channelValue.header, 0);
}
export function acquire(channelValue: NodeChannel, state: 1 | 2, expectedFrame: number, sequence: number): NodeFrame {
  stopped(channelValue);
  if (Atomics.load(channelValue.header, 0) !== state) throw new NodeProfileError("channel owner");
  const frame = channelValue.numbers[0]!; const actualSequence = channelValue.numbers[1]!; const phase = channelValue.numbers[2]!; const total = channelValue.numbers[3]!; const offset = channelValue.numbers[4]!; const count = channelValue.numbers[5]!;
  for (const value of [frame, actualSequence, phase, total, offset, count]) integer(value, Infinity, "received frame integer");
  if (frame !== expectedFrame || actualSequence !== sequence || frame < 1 || frame > channelValue.limits.frames || sequence < 1 || sequence > channelValue.limits.operations || phase < 1 || phase > 9 || total < 0 || total > ([phases.metadata, phases.metadataCredit, phases.result, phases.resultCredit].some(value => value === phase) ? channelValue.limits.metadataBytes : channelValue.limits.operationBytes) || offset < 0 || offset > total || count < 0 || count > 65536) throw new NodeProfileError("received frame fields");
  return { frame, sequence, phase, total, offset, bytes: Uint8Array.from(channelValue.payload.subarray(0, count)) };
}
export function waitReply(channelValue: NodeChannel): void {
  while (Atomics.load(channelValue.header, 0) !== 2) { stopped(channelValue); if (++channelValue.wakes > channelValue.limits.wakes) throw new NodeProfileError("channel wakes"); Atomics.wait(channelValue.header, 0, 1, 100); }
  stopped(channelValue);
}
export function encodeMetadata(value: unknown, limits: NodeLimits = nodeLimits): Uint8Array {
  const encoded = JSON.stringify(value);
  if (encoded.length > limits.metadataBytes || Buffer.byteLength(encoded) > limits.metadataBytes) throw new NodeProfileError("wire metadata");
  return new TextEncoder().encode(encoded);
}
export function decodeMetadata(bytes: Uint8Array, limits: NodeLimits = nodeLimits): unknown { if (bytes.byteLength > limits.metadataBytes) throw new NodeProfileError("wire metadata"); return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown; }
