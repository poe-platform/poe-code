import { scaleVideoPicture, type MediaBudgetTracker, type MediaVideoFrame } from "@poe-code/mp4-ast";
import { yieldTurn } from "safe-bash-contracts/yield";
import { parseFilterExpression } from "./filter-expression.js";
import { validateWeaveGenericOption } from "./weave-generic-option.js";

// Match numbering and motion thresholds follow FFmpeg's fieldmatch filter.
const P = 0, C = 1, N = 2, B = 3, U = 4;
type FieldFrame = MediaVideoFrame & { interlaced?: boolean; topFieldFirst?: boolean };
type Plane = { width: number; height: number; offset: number };

export async function fieldmatch(
  frames: FieldFrame[], argument: string, budget: MediaBudgetTracker, signal?: AbortSignal
): Promise<FieldFrame[]> {
  const specs: Record<string, { value: number; min: number; max: number; names?: Record<string, number> }> = {
    order: { value: -1, min: -1, max: 1, names: { auto: -1, bff: 0, tff: 1 } },
    mode: { value: 1, min: 0, max: 5, names: { pc: 0, pc_n: 1, pc_u: 2, pc_n_ub: 3, pcn: 4, pcn_ub: 5 } },
    ppsrc: { value: 0, min: 0, max: 0 },
    field: { value: -1, min: -1, max: 1, names: { auto: -1, bottom: 0, top: 1 } },
    mchroma: { value: 1, min: 0, max: 1 },
    y0: { value: 0, min: 0, max: 2147483647 },
    y1: { value: 0, min: 0, max: 2147483647 },
    scthresh: { value: 12, min: 0, max: 100 },
    combmatch: { value: 1, min: 0, max: 2, names: { none: 0, sc: 1, full: 2 } },
    combdbg: { value: 0, min: 0, max: 0, names: { none: 0 } },
    cthresh: { value: 9, min: -1, max: 255 },
    chroma: { value: 0, min: 0, max: 0 },
    blockx: { value: 16, min: 4, max: 512 },
    blocky: { value: 16, min: 4, max: 512 },
    combpel: { value: 80, min: 0, max: 2147483647 }
  };
  const options: Record<string, number> = Object.fromEntries(Object.entries(specs).map(([key, spec]) => [key, spec.value]));
  const parts = argument ? argument.split(":") : [];
  if (parts.at(-1) === "") parts.pop();
  let position = 0;
  for (const part of parts) {
    const separator = part.indexOf("=");
    const key = separator < 0 ? Object.keys(specs)[position++]! : part.slice(0, separator).trim();
    const raw = (separator < 0 ? part : part.slice(separator + 1)).trim();
    if (["threads", "thread_type", "extra_hw_frames"].includes(key)) {
      validateWeaveGenericOption(key, raw, "fieldmatch");
      continue;
    }
    const spec = specs[key];
    if (!spec) throw new Error(`fieldmatch: unsupported option ${key}`);
    if (separator >= 0) position = Object.keys(specs).indexOf(key) + 1;
    const value = parseFilterExpression(raw, "fieldmatch", {
      ...spec.names, default: spec.value, min: spec.min, max: spec.max,
      ...(key === "mchroma" || key === "ppsrc" || key === "chroma" ? { true: 1, false: 0, yes: 1, no: 0, on: 1, off: 0 } : {}),
      PI: Math.PI, E: Math.E, PHI: (1 + Math.sqrt(5)) / 2
    });
    if (!Number.isFinite(value) || value < spec.min || value > spec.max) throw new RangeError(`fieldmatch: invalid ${key}`);
    const lower = Math.floor(value);
    options[key] = key === "scthresh" ? value : value - lower === 0.5 ? lower + (lower % 2 !== 0 ? 1 : 0) : Math.round(value);
  }
  const order = options.order!, field = options.field!, mode = options.mode!;
  const mchroma = options.mchroma!, y0 = options.y0!, y1 = options.y1!;
  const scthresh = options.scthresh!, combmatch = options.combmatch!, cthresh = options.cthresh!;
  const blockx = options.blockx!, blocky = options.blocky!, combpel = options.combpel!;
  if ((blockx & (blockx - 1)) || (blocky & (blocky - 1)) || combpel > blockx * blocky) {
    throw new Error("fieldmatch: blocks must be powers of two and contain at least combpel pixels");
  }
  if (!frames.length) return [];
  const first = frames[0]!;
  const native = first.native;
  if (!native || ![0, 4, 5, 12, 13, 14].includes(native.format) || frames.some(frame =>
    frame.width !== first.width || frame.height !== first.height || frame.native?.rgba !== frame.data ||
    frame.native?.width !== frame.width || frame.native?.height !== frame.height || frame.native?.format !== native.format)) {
    throw new Error("fieldmatch: requires matching retained 8-bit planar YUV frames");
  }
  const hsub = [0, 4, 12, 13].includes(native.format) ? 2 : 1;
  const vsub = [0, 12].includes(native.format) ? 2 : 1;
  const planes: Plane[] = [];
  let offset = 0;
  for (let plane = 0; plane < 3; plane++) {
    const width = Math.ceil(first.width / (plane ? hsub : 1));
    const height = Math.ceil(first.height / (plane ? vsub : 1));
    planes.push({ width, height, offset });
    offset += width * height;
  }
  const size = offset;
  const xblocks = Math.floor((first.width + blockx / 2) / blockx) + 1;
  const yblocks = Math.floor((first.height + blocky / 2) / blocky) + 1;
  // Reuse scratch buffers across all comparisons and frames.
  const diffSize = Math.ceil(first.width / 16) * 16 * (Math.floor(first.height / 2) + 4);
  budget.allocateMemory(diffSize + first.width * first.height * 2 + xblocks * yblocks * 16);
  const diff = new Uint8Array(diffSize);
  const map = new Uint8Array(first.width * first.height);
  const mask = new Uint8Array(first.width * first.height);
  const blocks = new Uint32Array(xblocks * yblocks * 4);
  let work = 0;
  const checkpoint = async () => { await yieldTurn(signal); signal?.throwIfAborted(); budget.checkCpu(); };
  const output: FieldFrame[] = [];
  for (let index = 0; index < frames.length; index++) {
    await checkpoint();
    const current = frames[index]!;
    const previous = frames[Math.max(0, index - 1)]!;
    const next = frames[Math.min(frames.length - 1, index + 1)]!;
    const parity = order < 0 ? current.interlaced ? Number(Boolean(current.topFieldFirst)) : 1 : order;
    const selectedField = field < 0 ? parity : field;
    const matches = selectedField === parity ? [P, C, N, B, U] : [N, C, P, U, B];
    const source = (match: number) => (match === P || match === B ? previous : match === N || match === U ? next : current).native!.pixels;
    const base = (match: number) => match < B ? 2 - selectedField : 1 + selectedField;
    const compare = async (a: number, b: number) => {
      const normal = [0, 0], motion = [0, 0], large = [0, 0];
      for (const [plane, { width, height, offset }] of planes.entries()) {
        if (plane && !mchroma) break;
        map.fill(0);
        diff.fill(0);
        // FFmpeg uses a half-luma-width aligned scratch pitch for chroma,
        // including YUV444. Preserve its overlap when the chroma row is wider.
        const pitch = Math.ceil((plane ? Math.floor(first.width / 2) : first.width) / 16) * 16;
        const aBase = base(a), bBase = base(b);
        const aPixels = source(a), bPixels = source(b), pixels = current.native!.pixels;
        const shift = aBase === 2 ? 0 : 2;
        for (let row = 0; row < Math.floor(height / 2); row++) {
          for (let x = 0; x < width; x++) {
            diff[row * pitch + x] = Math.abs(aPixels[offset + (aBase + shift - 2 + row * 2) * width + x]! -
              bPixels[offset + (bBase + shift - 2 + row * 2) * width + x]!);
          }
          if (++work % 64 === 0) await checkpoint();
        }
        for (let y = 2; y < height - 2; y += 2) {
          const row = y / 2;
          for (let x = 1; x < width - 1; x++) {
            const d = diff[row * pitch + x]!;
            if (d <= 3) continue;
            let count = 0;
            for (let u = x - 1; u <= x + 1 && count < 2; u++) {
              for (let v = -1; v <= 1; v++) count += Number(diff[(row + v) * pitch + u]! > 3);
            }
            if (count <= 1) continue;
            const at = (aBase + shift + y - 2) * width + x;
            map[at] = 1;
            if (d <= 19) continue;
            count = 0;
            let upper = false, lower = false;
            for (let u = x - 1; u <= x + 1 && count < 6; u++) {
              if (diff[(row - 1) * pitch + u]! > 19) { count++; upper = true; }
              if (diff[row * pitch + u]! > 19) count++;
              if (diff[(row + 1) * pitch + u]! > 19) { count++; lower = true; }
            }
            if (count <= 3) continue;
            if (upper && lower) map[at] = 3;
            else {
              let upper2 = false, lower2 = false;
              for (let u = Math.max(x - 4, 0); u < Math.min(x + 5, width); u++) {
                if (y !== 2 && diff[(row - 2) * pitch + u]! > 19) upper2 = true;
                if (diff[(row - 1) * pitch + u]! > 19) upper = true;
                if (diff[(row + 1) * pitch + u]! > 19) lower = true;
                if (y !== height - 4 && diff[(row + 2) * pitch + u]! > 19) lower2 = true;
              }
              if ((upper && (lower || upper2)) || (lower && (upper || lower2))) map[at] = 3;
              else if (count > 5) map[at] = 5;
            }
          }
          if (++work % 64 === 0) await checkpoint();
        }
        const startx = 8 / (plane ? hsub : 1);
        for (let y = 2; y < height - 2; y += 2) {
          if (y0 !== y1 && y >= Math.floor(y0 / (plane ? vsub : 1)) && y <= Math.floor(y1 / (plane ? vsub : 1))) continue;
          const row = aBase + y - 2;
          for (let x = startx; x < width - startx; x++) {
            const flags = map[row * width + x]! | map[(row + 2) * width + x]!;
            if (!flags) continue;
            const center = pixels[offset + (row - 1) * width + x]! + 4 * pixels[offset + (row + 1) * width + x]! +
              pixels[offset + (row + 3) * width + x]!;
            for (let candidate = 0; candidate < 2; candidate++) {
              const data = candidate ? bPixels : aPixels;
              const candidateRow = (candidate ? bBase : aBase) + y - 2;
              const error = Math.abs(3 * (data[offset + candidateRow * width + x]! + data[offset + (candidateRow + 2) * width + x]!) - center);
              if (error > 23 && (flags & 1)) normal[candidate]! += error;
              if (error > 42 && (flags & 2)) motion[candidate]! += error;
              if (error > 42 && (flags & 4)) large[candidate]! += error;
            }
          }
          if (++work % 64 === 0) await checkpoint();
        }
      }
      if (motion[0]! < 500 && motion[1]! < 500 && Math.max(...large) >= 500 && Math.max(...large) > 3 * Math.min(...large)) {
        motion[0] = large[0]!; motion[1] = large[1]!;
      }
      const [n1, n2] = normal.map(value => Math.trunc(Math.fround(Math.fround(Math.fround(value) / 6) + 0.5))) as [number, number];
      const [m1, m2] = motion.map(value => Math.trunc(Math.fround(Math.fround(Math.fround(value) / 6) + 0.5))) as [number, number];
      const c1 = Math.fround(Math.max(n1, n2) / Math.max(Math.min(n1, n2), 1));
      const c2 = Math.fround(Math.max(m1, m2) / Math.max(Math.min(m1, m2), 1));
      const mr = Math.fround(Math.max(m1, m2) / Math.max(n1, n2, 1));
      const useMotion = (Math.max(m1, m2) >= 500 && Math.min(m1, m2) * 2 < Math.max(m1, m2)) ||
        (Math.max(m1, m2) >= 1000 && Math.min(m1, m2) * 3 < Math.max(m1, m2) * 2) ||
        (Math.max(m1, m2) >= 2000 && Math.min(m1, m2) * 5 < Math.max(m1, m2) * 4) ||
        (Math.max(m1, m2) >= 4000 && c2 > c1) ||
        (mr > 0.005 && Math.max(m1, m2) > 150 && Math.min(m1, m2) * 2 < Math.max(m1, m2));
      return (useMotion ? m1 > m2 : n1 > n2) ? b : a;
    };
    // Read candidate fields directly; only allocate pixels for the chosen output.
    const sample = (match: number, plane: Plane, x: number, y: number) => {
      const replace = match < B ? selectedField : 1 - selectedField;
      const pixels = y % 2 === replace ? source(match) : current.native!.pixels;
      return pixels[plane.offset + y * plane.width + x]!;
    };
    const scores = new Map<number, number>();
    const score = async (match: number) => {
      const cached = scores.get(match);
      if (cached !== undefined) return cached;
      const plane = planes[0]!;
      mask.fill(0); blocks.fill(0);
      const { width, height } = plane;
      for (let y = 0; y < height; y++) {
        const before = y === 0 ? 1 : y - 1, after = y === height - 1 ? height - 2 : y + 1;
        const before2 = y < 2 ? y + 2 : y - 2, after2 = y >= height - 2 ? y - 2 : y + 2;
        for (let x = 0; x < width; x++) {
          const value = sample(match, plane, x, y);
          const above = sample(match, plane, x, Math.max(0, Math.min(height - 1, before)));
          const below = sample(match, plane, x, Math.max(0, Math.min(height - 1, after)));
          if (cthresh < 0 || (Math.abs(value - above) > cthresh && Math.abs(value - below) > cthresh &&
            Math.abs(4 * value - 3 * (above + below) + sample(match, plane, x, Math.max(0, Math.min(height - 1, before2))) +
              sample(match, plane, x, Math.max(0, Math.min(height - 1, after2)))) > cthresh * 6)) mask[y * width + x] = 1;
        }
        if (++work % 64 === 0) await checkpoint();
      }
      let maximum = 0;
      for (let y = 1; y < height - 1; y++) {
        for (let x = 0; x < width; x++) {
          if (!mask[(y - 1) * width + x] || !mask[y * width + x] || !mask[(y + 1) * width + x]) continue;
          const row1 = Math.floor(y / blocky) * xblocks * 4, row2 = Math.floor((y + blocky / 2) / blocky) * xblocks * 4;
          const col1 = Math.floor(x / blockx) * 4, col2 = Math.floor((x + blockx / 2) / blockx) * 4;
          for (const at of [row1 + col1, row1 + col2 + 1, row2 + col1 + 2, row2 + col2 + 3]) {
            blocks[at]!++;
            maximum = Math.max(maximum, blocks[at]!);
          }
        }
        if (++work % 64 === 0) await checkpoint();
      }
      scores.set(match, maximum);
      return maximum;
    };
    let match = await compare(C, matches[P]!);
    if (mode >= 4) match = await compare(match, matches[N]!);
    let sceneChange = false;
    if (combmatch === 1) {
      let before = 0, after = 0;
      for (let pixel = 0; pixel < first.width * first.height; pixel++) {
        before += Math.abs(previous.native!.pixels[pixel]! - current.native!.pixels[pixel]!);
        after += Math.abs(next.native!.pixels[pixel]! - current.native!.pixels[pixel]!);
        if (++work % 16384 === 0) await checkpoint();
      }
      sceneChange = Math.max(before, after) > Math.trunc(first.width * first.height * 255 * scthresh / 100);
    }
    if (combmatch === 2 || (combmatch === 1 && sceneChange)) {
      const alternatives = mode === 0 || mode === 4 ? [match === matches[P] ? C : matches[P]!]
        : mode === 1 ? [matches[N]!] : mode === 2 ? [matches[U]!]
          : mode === 3 ? [matches[N]!, matches[U]!, matches[B]!] : [matches[U]!, matches[B]!];
      for (const alternative of alternatives) {
        const a = await score(match), b = await score(alternative);
        if ((b * 3 < a || (b * 2 < a && a > combpel)) && Math.abs(b - a) >= 30 && b < combpel) match = alternative;
      }
    }
    const interlaced = (scores.get(match) ?? -1) >= combpel;
    if (interlaced && combmatch === 2) match = C;
    const result = { ...current, interlaced, ...(interlaced ? { topFieldFirst: selectedField === 1 } : {}) };
    if (match !== C) {
      budget.allocateMemory(size + current.data.byteLength);
      const pixels = new Uint8Array(size);
      for (const plane of planes) {
        for (let y = 0; y < plane.height; y++) {
          const replace = match < B ? selectedField : 1 - selectedField;
          const data = y % 2 === replace ? source(match) : current.native!.pixels;
          const start = plane.offset + y * plane.width;
          pixels.set(data.subarray(start, start + plane.width), start);
          if (++work % 64 === 0) await checkpoint();
        }
      }
      result.native = { ...current.native!, pixels };
      result.data = scaleVideoPicture(result, result.width, result.height)!;
      result.native = { ...result.native, rgba: result.data };
    }
    output.push(result);
  }
  budget.releaseMemory(diffSize + first.width * first.height * 2 + xblocks * yblocks * 16);
  return output;
}
