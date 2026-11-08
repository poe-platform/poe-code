import { scaleVideoPicture, type MediaVideoFrame, type MediaBudgetTracker } from "@poe-code/mp4-ast";
import { yieldTurn } from "safe-bash-contracts/yield";

export type SignalFrame = MediaVideoFrame & { filterMetadata?: Record<string, string> };

export async function signalstats(
  frames: SignalFrame[], broadcast: boolean, color: readonly number[] | undefined,
  budget: MediaBudgetTracker, signal?: AbortSignal
): Promise<SignalFrame[]> {
  const output: SignalFrame[] = [];
  let previous: Uint8Array[] | undefined;
  for (const frame of frames) {
    const size = frame.width * frame.height;
    budget.allocateMemory(size * 12 + 5 * 360 * 4);
    let native = frame.native;
    if (!native || native.rgba !== frame.data || native.width !== frame.width || native.height !== frame.height ||
        ![0, 4, 5, 12, 13, 14].includes(native.format)) {
      const pixels = new Uint8Array(size * 3);
      for (let i = 0; i < size; i++) {
        if (i % 4096 === 0) { await yieldTurn(signal); signal?.throwIfAborted(); budget.checkCpu(); }
        const r = frame.data[i*4]!, g = frame.data[i*4+1]!, b = frame.data[i*4+2]!;
        // swscale's limited-range BT.601 RGB24 to YUV444 conversion.
        pixels[i] = (8414*r + 16519*g + 3208*b + (16<<15) + 16640) >> 15;
        pixels[size+i] = (-4865*r - 9528*g + 14392*b + (128<<15) + 16640) >> 15;
        pixels[2*size+i] = (14392*r - 12061*g - 2332*b + (128<<15) + 16640) >> 15;
      }
      native = { pixels, rgba: frame.data, width: frame.width, height: frame.height, format: 5, colorspace: 5, fullRange: 0 };
    }
    const hs = [0, 4, 12, 13].includes(native.format) ? 2 : 1;
    const vs = [0, 12].includes(native.format) ? 2 : 1;
    const cw = Math.ceil(frame.width / hs), cs = cw * Math.ceil(frame.height / vs);
    const planes = [native.pixels.subarray(0, size), native.pixels.subarray(size, size+cs), native.pixels.subarray(size+cs, size+2*cs)];
    const histograms = Array.from({ length: 5 }, () => new Uint32Array(360));
    const diffs = [0, 0, 0], masks = [0, 0, 0];
    for (const [p, plane] of planes.entries()) {
      for (let i = 0; i < plane.length; i++) {
        if (i % 4096 === 0) { await yieldTurn(signal); signal?.throwIfAborted(); budget.checkCpu(); }
        const value = plane[i]!;
        histograms[p]![value]!++;
        masks[p]! |= value;
        diffs[p]! += Math.abs(value - (previous?.[p]?.[i] ?? value));
        if (p === 1) {
          const u = value - 128, v = planes[2]![i]! - 128;
          histograms[3]![Math.trunc(Math.fround(Math.hypot(u, v)))]!++;
          const hue = Math.floor(Math.fround(180 / Math.PI * Math.fround(Math.atan2(u, v)) + 180)) % 360;
          histograms[4]![hue]!++;
        }
      }
    }
    const metadata = { ...frame.filterMetadata };
    const set = (key: string, value: number) => { metadata[`lavfi.signalstats.${key}`] = String(Number(value.toPrecision(6))); };
    const roundEven = (n: number) => n % 1 === 0.5 ? 2 * Math.round(n / 2) : Math.round(n);
    for (const [p, name] of ["Y", "U", "V", "SAT", "HUE"].entries()) {
      const count = p === 0 ? size : cs;
      let min = -1, max = 0, low = -1, high = -1, median = -1, sum = 0, accumulated = 0;
      for (const [value, frequency] of histograms[p]!.entries()) {
        if (frequency) { if (min < 0) min = value; max = value; }
        sum += value * frequency;
        accumulated += frequency;
        if (low < 0 && accumulated >= roundEven(count * 0.1)) low = value;
        if (high < 0 && accumulated >= roundEven(count * 0.9)) high = value;
        if (median < 0 && accumulated > count / 2) median = value;
      }
      if (p === 4) { set("HUEMED", median); set("HUEAVG", sum/count); }
      else { set(name+"MIN", min); set(name+"LOW", low); set(name+"AVG", sum/count); set(name+"HIGH", high); set(name+"MAX", max); }
    }
    for (const [p, name] of ["Y", "U", "V"].entries()) {
      set(name+"DIF", diffs[p]! / planes[p]!.length);
      let bits = 0;
      for (let mask = masks[p]!; mask; mask >>>= 1) bits += mask & 1;
      set(name+"BITDEPTH", bits);
    }
    previous = planes;
    let pixels = native.pixels;
    if (color) pixels = new Uint8Array(pixels);
    let outside = 0;
    for (let i = 0; i < size; i++) {
      if (i % 4096 === 0) { await yieldTurn(signal); signal?.throwIfAborted(); budget.checkCpu(); }
      const c = Math.floor(Math.floor(i / frame.width) / vs) * cw + Math.floor((i % frame.width) / hs);
      const y = planes[0]![i]!, u = planes[1]![c]!, v = planes[2]![c]!;
      if (y < 16 || y > 235 || u < 16 || u > 240 || v < 16 || v > 240) {
        outside++;
        if (color) { pixels[i] = color[0]!; pixels[size+c] = color[1]!; pixels[size+cs+c] = color[2]!; }
      }
    }
    if (broadcast || color) set("BRNG", outside / size);
    native = { ...native, pixels };
    const data = scaleVideoPicture({ ...frame, native }, frame.width, frame.height)!;
    output.push({ ...frame, data, native: { ...native, rgba: data }, filterMetadata: metadata });
  }
  return output;
}
