import type { MediaBudgetTracker, MediaVideoFrame } from "@poe-code/mp4-ast";
import { yieldTurn } from "safe-bash-contracts/yield";
import { parseFilterExpression } from "./filter-expression.js";

export async function colorcontrast(
  frames: MediaVideoFrame[], argument: string, pixelFormat: string | undefined,
  budget: MediaBudgetTracker, signal?: AbortSignal
): Promise<MediaVideoFrame[]> {
  const options = { rc: 0, gm: 0, by: 0, rcw: 0, gmw: 0, byw: 0, pl: 0 };
  const keys = ["rc", "gm", "by", "rcw", "gmw", "byw", "pl"] as const;
  let position = 0, enable: string | undefined;
  if (argument.endsWith(":")) argument = argument.slice(0, -1);
  for (const part of argument ? argument.split(":") : []) {
    const separator = part.indexOf("=");
    const key = separator < 0 ? keys[position++] : part.slice(0, separator).trim();
    const text = (separator < 0 ? part : part.slice(separator + 1)).trim();
    if (key === "enable") { enable = text; continue; }
    if (key !== "rc" && key !== "gm" && key !== "by" && key !== "rcw" && key !== "gmw" && key !== "byw" && key !== "pl") {
      throw new Error(`colorcontrast: unsupported option ${key ?? part}`);
    }
    const min = key === "rc" || key === "gm" || key === "by" ? -1 : 0;
    const value = parseFilterExpression(text, "colorcontrast", {
      min, max: 1, default: 0, PI: Math.PI, E: Math.E, PHI: (1 + Math.sqrt(5)) / 2
    });
    if (!text || !Number.isFinite(value) || value < min || value > 1) {
      throw new RangeError(`colorcontrast: ${key} must be between ${min} and 1`);
    }
    options[key] = Math.fround(value);
  }
  if (pixelFormat !== undefined && !["rgb24", "bgr24", "rgba", "bgra", "gbrp", "gbrap"].includes(pixelFormat)) {
    throw new Error("colorcontrast: requires 8-bit RGB input");
  }
  const { rcw, gmw, byw, pl } = options;
  const f = Math.fround;
  const rc = f(options.rc * 0.5), gm = f(options.gm * 0.5), by = f(options.by * 0.5);
  const sum = f(f(gmw + byw) + rcw), scale = f(1 / sum);
  const registers = new Float64Array(10);
  const output: MediaVideoFrame[] = [];
  for (const [n, frame] of frames.entries()) {
    await yieldTurn(signal); signal?.throwIfAborted(); budget.checkCpu();
    let enabled = true;
    if (enable !== undefined) {
      const variables = { n, t: frame.ptsSeconds, w: frame.width, h: frame.height, pos: frame.offset ?? NaN, NAN: NaN, INF: Infinity };
      parseFilterExpression(enable, "colorcontrast enable", variables, undefined, registers);
      enabled = Math.abs(parseFilterExpression(enable, "colorcontrast enable", variables, undefined, registers)) >= 0.5;
    }
    if (!enabled || sum <= 2 ** -23) { output.push(frame); continue; }
    budget.allocateMemory(frame.data.byteLength);
    const data = frame.data.slice();
    for (let offset = 0; offset < data.length; offset += 4) {
      if (offset % 65536 === 0) { await yieldTurn(signal); signal?.throwIfAborted(); budget.checkCpu(); }
      const r = data[offset]!, g = data[offset + 1]!, b = data[offset + 2]!;
      const gd = f((g - (b + r) * 0.5) * gm);
      const bd = f((b - (r + g) * 0.5) * by);
      const rd = f((r - (g + b) * 0.5) * rc);
      // Round each operation to native float precision before truncating the final sample.
      const nr = Math.max(0, Math.min(255, f(f(f(f(f(r - gd) * gmw) + f(f(r - bd) * byw)) + f(f(r + rd) * rcw)) * scale)));
      const ng = Math.max(0, Math.min(255, f(f(f(f(f(g + gd) * gmw) + f(f(g - bd) * byw)) + f(f(g - rd) * rcw)) * scale)));
      const nb = Math.max(0, Math.min(255, f(f(f(f(f(b - gd) * gmw) + f(f(b + bd) * byw)) + f(f(b - rd) * rcw)) * scale)));
      const lightness = f((Math.max(r, g, b) + Math.min(r, g, b)) /
        f(f(Math.max(nr, ng, nb) + Math.min(nr, ng, nb)) + 2 ** -23));
      data[offset] = Math.max(0, Math.min(255, f(nr + f(f(f(nr * lightness) - nr) * pl))));
      data[offset + 1] = Math.max(0, Math.min(255, f(ng + f(f(f(ng * lightness) - ng) * pl))));
      data[offset + 2] = Math.max(0, Math.min(255, f(nb + f(f(f(nb * lightness) - nb) * pl))));
    }
    output.push({ ...frame, data });
  }
  return output;
}
