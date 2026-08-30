import { NodeProfileError, nodeLimits } from "./types.js";
import { integer } from "./values.js";

export const phases = Object.freeze({ metadata: 1, uploadCredit: 2, upload: 3, result: 4, dataCredit: 5, data: 6, final: 7 });
export interface NodeFrame { readonly frame: number; readonly sequence: number; readonly phase: number; readonly total: number; readonly offset: number; readonly bytes: Uint8Array; }
export interface NodeChannel { readonly header: Int32Array; readonly payload: Uint8Array; wakes: number; }
export function channel(sab: SharedArrayBuffer): NodeChannel {
  if (sab.byteLength !== nodeLimits.sabBytes) throw new NodeProfileError("shared channel size");
  return { header: new Int32Array(sab, 0, 112), payload: new Uint8Array(sab, 448, 65536), wakes: 0 };
}
export function stop(channelValue: NodeChannel): void { Atomics.store(channelValue.header, 8, 1); Atomics.store(channelValue.header, 0, 3); Atomics.notify(channelValue.header, 0); }
export function stopped(channelValue: NodeChannel): void { if (Atomics.load(channelValue.header, 8) !== 0) throw new NodeProfileError("Worker channel stopped"); }
export function publish(channelValue: NodeChannel, state: 1 | 2, frame: NodeFrame): void {
  stopped(channelValue);
  integer(frame.frame, nodeLimits.frames, "frame"); integer(frame.sequence, nodeLimits.operations, "sequence"); integer(frame.phase, 7, "phase"); integer(frame.total, nodeLimits.operationBytes, "frame total"); integer(frame.offset, frame.total, "frame offset");
  if (frame.frame === 0 || frame.sequence === 0 || frame.phase === 0 || frame.bytes.byteLength > 65536) throw new NodeProfileError("frame fields");
  channelValue.payload.set(frame.bytes);
  for (const [index, value] of [[1, frame.frame], [2, frame.sequence], [3, frame.phase], [4, frame.total], [5, frame.offset], [6, frame.bytes.byteLength]] as const) Atomics.store(channelValue.header, index, value);
  Atomics.store(channelValue.header, 0, state); Atomics.notify(channelValue.header, 0);
}
export function acquire(channelValue: NodeChannel, state: 1 | 2, expectedFrame: number, sequence: number): NodeFrame {
  stopped(channelValue);
  if (Atomics.load(channelValue.header, 0) !== state) throw new NodeProfileError("channel owner");
  const frame = Atomics.load(channelValue.header, 1); const actualSequence = Atomics.load(channelValue.header, 2); const phase = Atomics.load(channelValue.header, 3); const total = Atomics.load(channelValue.header, 4); const offset = Atomics.load(channelValue.header, 5); const count = Atomics.load(channelValue.header, 6);
  if (frame !== expectedFrame || actualSequence !== sequence || frame < 1 || frame > nodeLimits.frames || sequence < 1 || sequence > nodeLimits.operations || phase < 1 || phase > 7 || total < 0 || total > nodeLimits.operationBytes || offset < 0 || offset > total || count < 0 || count > 65536) throw new NodeProfileError("received frame fields");
  return { frame, sequence, phase, total, offset, bytes: Uint8Array.from(channelValue.payload.subarray(0, count)) };
}
export function waitReply(channelValue: NodeChannel): void {
  while (Atomics.load(channelValue.header, 0) !== 2) { stopped(channelValue); if (++channelValue.wakes > nodeLimits.wakes) throw new NodeProfileError("channel wakes"); Atomics.wait(channelValue.header, 0, 1, 100); }
  stopped(channelValue);
}
export function encodeMetadata(value: unknown): Uint8Array {
  const encoded = JSON.stringify(value);
  if (encoded.length > nodeLimits.metadataBytes || Buffer.byteLength(encoded) > nodeLimits.metadataBytes) throw new NodeProfileError("wire metadata");
  return new TextEncoder().encode(encoded);
}
export function decodeMetadata(bytes: Uint8Array): unknown { if (bytes.byteLength > nodeLimits.metadataBytes) throw new NodeProfileError("wire metadata"); return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown; }
