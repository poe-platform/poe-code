import { scaleVideoPicture, type MediaBudgetTracker, type MediaVideoFrame } from "@poe-code/mp4-ast";
import { yieldTurn } from "safe-bash-contracts/yield";
import { formatYuv } from "./format-yuv.js";
import { parseFilterExpression } from "./filter-expression.js";

interface Field {
  frame: MediaVideoFrame;
  parity: number;
  difference: Int32Array;
  comb: Int32Array;
  variation: Int32Array;
  affinity: number | undefined;
  breaks: number;
  checked: boolean;
}

export async function pullup(
  frames: (MediaVideoFrame & { interlaced?: boolean; topFieldFirst?: boolean })[],
  argument: string, budget: MediaBudgetTracker, signal?: AbortSignal
): Promise<MediaVideoFrame[]> {
  const options = { jl: 1, jr: 1, jt: 4, jb: 4, sb: 0, mp: 0 };
  const defaults = { ...options };
  const names = Object.keys(options) as (keyof typeof options)[];
  const arguments_ = argument ? argument.split(":") : [];
  if (arguments_.at(-1) === "") arguments_.pop();
  let position = 0;
  for (const item of arguments_) {
    const equals = item.indexOf("=");
    const key = equals < 0 ? names[position++] : item.slice(0, equals).trim();
    if (!names.includes(key as keyof typeof options)) throw new Error(`pullup: unsupported option ${key}`);
    const name = key as keyof typeof options;
    const min = name === "sb" ? -1 : name === "jt" || name === "jb" ? 1 : 0;
    const max = name === "mp" ? 2 : name === "sb" ? 1 : 2147483647;
    const value = parseFilterExpression((equals < 0 ? item : item.slice(equals + 1)).trim(), "pullup", {
      default: defaults[name], min, max, PI: Math.PI, E: Math.E, PHI: (1 + Math.sqrt(5)) / 2,
      ...(name === "mp" ? { y: 0, u: 1, v: 2 } : {})
    });
    if (!Number.isFinite(value) || value < min || value > max) throw new RangeError(`pullup: invalid ${name}`);
    const lower = Math.floor(value);
    options[name] = value - lower === 0.5 ? lower + Math.abs(lower % 2) : Math.round(value);
  }

  const output: MediaVideoFrame[] = [];
  const queue: Field[] = [];
  let previous: Field | undefined;
  let work = 0;
  for (const input of frames) {
    await yieldTurn(signal); signal?.throwIfAborted(); budget.checkCpu();
    let frame: MediaVideoFrame = input;
    if (!frame.native || frame.native.rgba !== frame.data || frame.native.width !== frame.width ||
        frame.native.height !== frame.height || ![0, 4, 5, 8, 12, 13, 14].includes(frame.native.format)) {
      budget.allocateMemory(frame.width * frame.height * 7);
      frame = await formatYuv(frame, "yuv444p", signal);
    }
    const native = frame.native!;
    if (native.format === 8 && options.mp !== 0) throw new Error("pullup: input format does not have such plane");
    const hs = [0, 4, 12, 13].includes(native.format) ? 2 : 1;
    const vs = [0, 12].includes(native.format) ? 2 : 1;
    const width = Math.ceil(frame.width / (options.mp ? hs : 1));
    const height = Math.ceil(frame.height / (options.mp ? vs : 1));
    const offset = options.mp ? frame.width * frame.height +
      (options.mp - 1) * Math.ceil(frame.width / hs) * Math.ceil(frame.height / vs) : 0;
    const columns = Math.max(0, Math.floor((width - 8 * (options.jl + options.jr)) / 8));
    const rows = Math.max(0, Math.floor((height - 2 * (options.jt + options.jb)) / 8));
    const blocks = columns * rows;
    if (queue.some(field => field.frame.width !== frame.width || field.frame.height !== frame.height || field.frame.native!.format !== native.format)) {
      throw new Error("pullup: consecutive frames must have matching dimensions and pixel formats");
    }
    const firstParity = input.interlaced && !input.topFieldFirst ? 1 : 0;
    for (const parity of [firstParity, firstParity ^ 1]) {
      // Field order can change at a cut. Consecutive fields of equal parity cannot pair.
      if (queue.at(-1)?.parity === parity) continue;
      budget.allocateMemory(blocks * 12 + 128);
      const field: Field = { frame, parity, difference: new Int32Array(blocks), comb: new Int32Array(blocks),
        variation: new Int32Array(blocks), affinity: undefined, breaks: 0, checked: false };
      const last = queue.at(-1);
      const sameParity = queue.at(-2);
      const top = parity ? last?.frame.native!.pixels : native.pixels;
      const bottom = parity ? native.pixels : last?.frame.native!.pixels;
      for (let by = 0, block = 0; by < rows; by++) {
        for (let bx = 0; bx < columns; bx++, block++) {
          if (++work % 128 === 0) { await yieldTurn(signal); signal?.throwIfAborted(); budget.checkCpu(); }
          const start = offset + (2 * options.jt + by * 8) * width + (options.jl + bx) * 8;
          let difference = 0, comb = 0, variation = 0;
          for (let y = 0; y < 4; y++) {
            for (let x = 0; x < 8; x++) {
              const p = start + y * 2 * width + x;
              const sample = native.pixels[p + parity * width]!;
              if (sameParity) difference += Math.abs(sample - sameParity.frame.native!.pixels[p + parity * width]!);
              if (y < 3) variation += Math.abs(sample - native.pixels[p + (parity + 2) * width]!);
              if (top && bottom) comb += Math.abs(2 * top[p]! - bottom[p - width]! - bottom[p + width]!) +
                Math.abs(2 * bottom[p + width]! - top[p]! - top[p + 2 * width]!);
            }
          }
          field.difference[block] = difference;
          field.comb[block] = comb;
          field.variation[block] = variation * 4;
        }
      }
      queue.push(field);
    }

    // Keep two fields of lookahead. A discarded singleton may expose a complete pair.
    for (let attempt = 0; attempt < 2 && queue.length >= 4; attempt++) {
      for (let i = 0; i < queue.length - 1; i++) {
        const field = queue[i]!, next = queue[i + 1]!;
        if (!field.checked && i + 3 < queue.length) {
          let left = 0, right = 0;
          for (let b = 0; b < blocks; b++) {
            if (++work % 128 === 0) { await yieldTurn(signal); signal?.throwIfAborted(); budget.checkCpu(); }
            const delta = queue[i + 2]!.difference[b]! - queue[i + 3]!.difference[b]!;
            left = Math.max(left, delta);
            right = Math.max(right, -delta);
          }
          if (left + right >= 128) {
            if (left > 4 * right) next.breaks |= 1;
            if (right > 4 * left) queue[i + 2]!.breaks |= 2;
          }
          field.checked = true;
        }
        if (field.affinity !== undefined) continue;
        const before = i ? queue[i - 1] : previous;
        let left = 0, right = 0;
        for (let b = 0; b < blocks; b++) {
          if (++work % 128 === 0) { await yieldTurn(signal); signal?.throwIfAborted(); budget.checkCpu(); }
          const variance = field.variation[b]!;
          const lc = Math.max(0, field.comb[b]! - 2 * Math.min(variance, before?.variation[b] ?? 0));
          const rc = Math.max(0, next.comb[b]! - 2 * Math.min(variance, next.variation[b]!));
          left = Math.max(left, lc - rc);
          right = Math.max(right, rc - lc);
        }
        field.affinity = left + right < 64 ? 0 : right > 6 * left ? -1 : left > 6 * right ? 1 : 0;
      }
      const [a, b, c] = queue as [Field, Field, Field, ...Field[]];
      let boundary = 0;
      for (let i = 0; i < 3; i++) {
        if ((queue[i]!.breaks & 2) || (queue[i + 1]!.breaks & 1)) { boundary = i + 1; break; }
      }
      if (boundary === 1 && options.sb < 0) boundary = 0;
      let count = 2;
      if (a.affinity === -1) count = 1;
      else if (boundary === 1) count = options.sb < 1 && a.affinity === 1 && b.affinity === -1 ? 2 : 1;
      else if (boundary === 2) count = b.affinity === 1 ? 1 : 2;
      else if (boundary === 3) count = c.affinity === 1 ? 2 : 3;
      else if (b.affinity === 1) count = 1;
      else if (b.affinity !== -1 && c.affinity === -1) count = a.affinity === 1 ? 3 : 1;
      const partner = count === 3 && (b.affinity || (a.frame === b.frame ? -1 : 1)) === 1 ? c : a;
      if (previous) budget.releaseMemory(previous.variation.byteLength * 3 + 128);
      previous = queue[count - 1];
      queue.splice(0, count);
      for (let i = 0; i < count - 1; i++) budget.releaseMemory(blocks * 12 + 128);
      if (count === 1) continue;

      const top = (partner.parity ? b : partner).frame.native!;
      const bottom = (partner.parity ? partner : b).frame.native!;
      budget.recordFrame(frame.width, frame.height);
      budget.allocateMemory(native.pixels.length + frame.width * frame.height * 4 + 128);
      const pixels = new Uint8Array(native.pixels.length);
      for (let plane = 0, start = 0; plane < (native.format === 8 ? 1 : 3); plane++) {
        const stride = Math.ceil(frame.width / (plane ? hs : 1));
        const planeHeight = Math.ceil(frame.height / (plane ? vs : 1));
        for (let y = 0; y < planeHeight; y++) {
          if (++work % 128 === 0) { await yieldTurn(signal); signal?.throwIfAborted(); budget.checkCpu(); }
          const p = start + y * stride;
          pixels.set((y % 2 ? bottom : top).pixels.subarray(p, p + stride), p);
        }
        start += stride * planeHeight;
      }
      const woven = { ...input, native: { ...native, pixels } };
      const data = scaleVideoPicture(woven, frame.width, frame.height)!;
      output.push({ ...woven, data, native: { ...woven.native, rgba: data } });
      break;
    }
  }
  for (const field of [...queue, ...(previous ? [previous] : [])]) budget.releaseMemory(field.variation.byteLength * 3 + 128);
  return output;
}
