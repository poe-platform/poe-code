import type { MediaVideoFrame, MediaBudgetTracker } from "@poe-code/mp4-ast";
import { yieldTurn } from "safe-bash-contracts/yield";
import { parseFilterExpression } from "./filter-expression.js";
import { parseFilterBoolean } from "./filter-boolean.js";

export async function colorbalance(
  frames: MediaVideoFrame[], argument: string, budget: MediaBudgetTracker, signal?: AbortSignal
): Promise<MediaVideoFrame[]> {
  const keys = ["rs", "gs", "bs", "rm", "gm", "bm", "rh", "gh", "bh", "pl"];
  const coefficients = Array<number>(9).fill(0);
  let preserveLightness = false;
  let position = 0;
  const parts = argument ? argument.split(":") : [];
  if (parts.at(-1) === "") parts.pop();
  for (const part of parts) {
    const separator = part.indexOf("=");
    const key = separator < 0 ? keys[position] : part.slice(0, separator).trim();
    if (separator < 0) position++;
    else position = position === 0 ? 1 : 0;
    const text = (separator < 0 ? part : part.slice(separator + 1)).trim();
    const index = key === undefined ? -1 : keys.indexOf(key);
    if (index < 0) throw new Error(`colorbalance: unsupported option ${key}`);
    if (key === "pl") {
      preserveLightness = parseFilterBoolean(text, "colorbalance: invalid pl boolean");
      continue;
    }
    const value = parseFilterExpression(text, "colorbalance", {
      min: -1, max: 1, default: 0, PI: Math.PI, E: Math.E, PHI: (1 + Math.sqrt(5)) / 2
    });
    if (!text || !Number.isFinite(value) || value < -1 || value > 1) {
      throw new RangeError(`colorbalance: ${key} must be between -1 and 1`);
    }
    coefficients[index] = Math.fround(value);
  }

  const output: MediaVideoFrame[] = [];
  const rgb = [0, 0, 0];
  for (const frame of frames) {
    budget.allocateMemory(frame.data.byteLength);
    const data = new Uint8Array(frame.data.length);
    for (let offset = 0; offset < data.length; offset += 4) {
      if (offset % 65536 === 0) { await yieldTurn(signal); signal?.throwIfAborted(); budget.checkCpu(); }
      for (let channel = 0; channel < 3; channel++) rgb[channel] = Math.fround(frame.data[offset + channel]! / 255);
      // FFmpeg weights the tones using max + min, before halving for HSL lightness.
      // Keep float arithmetic and nearest-even quantization to match its pixel kernel.
      const lightness = Math.fround(Math.max(...rgb) + Math.min(...rgb));
      const boundary = Math.fround(0.333);
      const scale = Math.fround(0.7);
      const shadows = Math.fround(Math.max(0, Math.min(1, Math.fround(Math.fround(boundary - lightness) * 4 + 0.5))) * scale);
      const midtones = Math.fround(Math.fround(
        Math.max(0, Math.min(1, Math.fround(Math.fround(lightness - boundary) * 4 + 0.5))) *
        Math.max(0, Math.min(1, Math.fround(Math.fround(Math.fround(1 - lightness) - boundary) * 4 + 0.5)))
      ) * scale);
      const highlights = Math.fround(Math.max(0, Math.min(1, Math.fround(Math.fround(Math.fround(lightness + boundary) - 1) * 4 + 0.5))) * scale);
      for (let channel = 0; channel < 3; channel++) {
        let value = Math.fround(rgb[channel]! + Math.fround(coefficients[channel]! * shadows));
        value = Math.fround(value + Math.fround(coefficients[channel + 3]! * midtones));
        value = Math.fround(value + Math.fround(coefficients[channel + 6]! * highlights));
        rgb[channel] = Math.max(0, Math.min(1, value));
      }
      if (preserveLightness) {
        const max = Math.max(...rgb), min = Math.min(...rgb);
        const range = Math.fround(max - min);
        const l = Math.fround(lightness * 0.5);
        let hue = 0;
        if (range !== 0) {
          const channel = rgb.indexOf(max);
          hue = Math.fround(60 * Math.fround(channel * 2 + Math.fround(
            Math.fround(rgb[(channel + 1) % 3]! - rgb[(channel + 2) % 3]!) / range
          )));
          if (hue < 0) hue = Math.fround(hue + 360);
        }
        const saturation = max === 1 || min === 0 ? 0 : Math.fround(range /
          Math.fround(1 - Math.abs(Math.fround(2 * l - 1))));
        const amplitude = Math.fround(saturation * Math.min(l, Math.fround(1 - l)));
        for (let channel = 0; channel < 3; channel++) {
          const k = Math.fround(Math.fround((channel === 0 ? 0 : channel === 1 ? 8 : 4) + Math.fround(hue / 30)) % 12);
          const shape = Math.max(-1, Math.min(Math.fround(k - 3), Math.fround(9 - k), 1));
          rgb[channel] = Math.max(0, Math.min(1, Math.fround(l - Math.fround(amplitude * shape))));
        }
      }
      for (let channel = 0; channel < 3; channel++) {
        const value = Math.fround(rgb[channel]! * 255);
        const lower = Math.floor(value);
        data[offset + channel] = value - lower === 0.5 ? lower + lower % 2 : Math.round(value);
      }
      data[offset + 3] = frame.data[offset + 3]!;
    }
    const balanced = { ...frame, data };
    delete balanced.native;
    output.push(balanced);
  }
  return output;
}
