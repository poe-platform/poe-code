import type { MediaBudgetTracker, MediaVideoFrame } from "@poe-code/mp4-ast";
import { yieldTurn } from "safe-bash-contracts/yield";
import { parseFilterExpression } from "./filter-expression.js";
import { scaleFrame } from "./scale.js";

export async function zoompan(
  frames: MediaVideoFrame[], argument: string, sar: number, budget: MediaBudgetTracker, signal?: AbortSignal
): Promise<{ frames: MediaVideoFrame[]; fps: number }> {
  const options: Record<string, string> = { zoom: "1", x: "0", y: "0", d: "90", s: "hd720", fps: "25" };
  const keys = Object.keys(options);
  const parts = argument ? argument.split(":") : [];
  if (parts.at(-1) === "") parts.pop();
  for (const [index, part] of parts.entries()) {
    const separator = part.indexOf("=");
    let key = separator < 0 ? keys[index] : part.slice(0, separator).trim();
    if (key === "z") key = "zoom";
    if (!key || !keys.includes(key)) throw new Error(`zoompan: unsupported option ${key ?? part}`);
    options[key] = (separator < 0 ? part : part.slice(separator + 1)).trim();
  }
  const dimensions = (options.s === "hd720" ? "1280x720" : options.s!).split("x").map(Number);
  const [width = 0, height = 0] = dimensions;
  if (dimensions.length !== 2 || ![width, height].every(value => Number.isSafeInteger(value) && value > 0) ||
      !Number.isSafeInteger(width * height * 4)) throw new Error("zoompan: invalid output size");
  const fps = parseFilterExpression(options.fps!, "zoompan", { ntsc: 30000 / 1001, pal: 25, film: 24 });
  if (!Number.isFinite(fps) || fps <= 0 || fps > 2147483647) throw new Error("zoompan: invalid frame rate");
  const output: MediaVideoFrame[] = [];
  const variables: Record<string, number> = {
    zoom: 1, pzoom: 1, x: 0, px: 0, y: 0, py: 0, duration: 0, pduration: 0,
    in_time: 0, it: 0, out_time: 0, time: 0, ot: 0, frame: 0,
    ow: width, out_w: width, oh: height, out_h: height, sar, hsub: 1, vsub: 1
  };
  const zoomRegisters = new Float64Array(10);
  const xRegisters = new Float64Array(10);
  const yRegisters = new Float64Array(10);
  for (const [index, source] of frames.entries()) {
    Object.assign(variables, {
      iw: source.width, in_w: source.width, ih: source.height, in_h: source.height,
      in: index, on: output.length, zoom: 1, x: 0, y: 0,
      a: source.width / source.height, dar: source.width / source.height * sar
    });
    // Duration is evaluated once per input; zoom and coordinates advance for every output.
    const duration = Math.trunc(parseFilterExpression(options.d!, "zoompan", variables, undefined, new Float64Array(10)));
    if (!Number.isFinite(duration) || duration < -2147483648 || duration > 2147483647) {
      throw new Error("zoompan: duration is outside the integer range");
    }
    variables.duration = duration;
    for (let frame = 0; frame < Math.max(1, duration); frame++) {
      await yieldTurn(signal);
      signal?.throwIfAborted();
      budget.recordFrame(width, height);
      budget.checkSamples(output.length + 1);
      budget.checkDuration((output.length + 1) / fps);
      Object.assign(variables, {
        frame, on: output.length, in_time: source.ptsSeconds, it: source.ptsSeconds,
        out_time: output.length / fps, time: output.length / fps, ot: output.length / fps
      });
      const zoom = Math.max(1, Math.min(10, parseFilterExpression(options.zoom!, "zoompan", variables, undefined, zoomRegisters)));
      variables.zoom = zoom;
      const cropWidth = Math.trunc(source.width / zoom);
      const cropHeight = Math.trunc(source.height / zoom);
      if (cropWidth <= 0 || cropHeight <= 0) throw new Error("zoompan: empty crop");
      variables.x = Math.max(0, Math.min(source.width - cropWidth,
        parseFilterExpression(options.x!, "zoompan", variables, undefined, xRegisters)));
      variables.y = Math.max(0, Math.min(source.height - cropHeight,
        parseFilterExpression(options.y!, "zoompan", variables, undefined, yRegisters)));
      const left = Math.trunc(variables.x);
      const top = Math.trunc(variables.y);
      const cropBytes = cropWidth * cropHeight * 4;
      budget.allocateMemory(cropBytes + width * height * 4 + 128);
      const cropped = new Uint8Array(cropBytes);
      for (let row = 0; row < cropHeight; row++) {
        if (row % 256 === 0) { await yieldTurn(signal); signal?.throwIfAborted(); budget.checkCpu(); }
        const start = ((top + row) * source.width + left) * 4;
        cropped.set(source.data.subarray(start, start + cropWidth * 4), row * cropWidth * 4);
      }
      const data = await scaleFrame(cropped, cropWidth, cropHeight, width, height, signal);
      budget.releaseMemory(cropBytes);
      output.push({ width, height, data, ptsSeconds: output.length / fps, durationSeconds: 1 / fps, keyframe: true });
    }
    variables.pzoom = variables.zoom!;
    variables.px = variables.x!;
    variables.py = variables.y!;
    variables.pduration = duration;
  }
  return { frames: output, fps };
}
