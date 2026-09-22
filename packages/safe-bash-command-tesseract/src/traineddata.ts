import { TesseractError } from './contracts.js';
export interface TraineddataComponent { readonly index: number; readonly offset: number; readonly length: number }
/** Container inspection only. Does not deserialize a network or admit recognition. No byte copies. */
export function inspectTraineddata(bytes: Uint8Array, limits: { readonly maxModelBytes: number; readonly maxComponents: number }, signal: AbortSignal): {
  readonly components: readonly TraineddataComponent[]; readonly littleEndian: boolean; readonly recognitionQualified: false;
} {
  if (signal.aborted) throw new TesseractError('cancelled', 'model inspection cancelled');
  for (const value of [limits.maxModelBytes, limits.maxComponents]) {
    if (!Number.isSafeInteger(value) || value < 1) throw new TesseractError('limit', 'invalid model limits');
  }
  if (bytes.byteLength > limits.maxModelBytes) throw new TesseractError('limit', 'exhausted modelBytes', 'modelBytes');
  const invalid = () => new TesseractError('invalid-model', 'malformed traineddata component table');
  if (bytes.byteLength < 4) throw invalid();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // Upstream heuristic uses the format maximum, not a caller's allocation cap.
  const littleEndian = view.getUint32(0, true) <= 1000;
  const count = view.getUint32(0, littleEndian);
  if (count < 1 || count > 24) throw invalid();
  if (count > limits.maxComponents) throw new TesseractError('limit', 'exhausted components', 'components');
  const headerBytes = 4 + count * 8;
  if (headerBytes > bytes.byteLength) throw invalid();
  const components: TraineddataComponent[] = [];
  let previous: { index: number; offset: number } | undefined;
  for (let index = 0; index < count; index += 1) {
    if (signal.aborted) throw new TesseractError('cancelled', 'model inspection cancelled');
    const raw = view.getBigInt64(4 + index * 8, littleEndian);
    if (raw === -1n) continue;
    if (raw < BigInt(headerBytes) || raw >= BigInt(bytes.byteLength)) throw invalid();
    const offset = Number(raw);
    if (previous) {
      if (offset <= previous.offset) throw invalid();
      components.push({ ...previous, length: offset - previous.offset });
    }
    previous = { index, offset };
  }
  if (previous) components.push({ ...previous, length: bytes.byteLength - previous.offset });
  return { components, littleEndian, recognitionQualified: false };
}
