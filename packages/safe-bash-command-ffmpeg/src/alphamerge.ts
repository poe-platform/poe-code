import type { MediaBudgetTracker, MediaVideoFrame } from "@poe-code/mp4-ast";
import { yieldTurn } from "safe-bash-contracts/yield";

export function parseAlphamergeGraph(graph: string, maps: string[]) {
  let expression = graph.trim();
  const labels: string[] = [];
  while (expression.startsWith("[")) {
    const end = expression.indexOf("]");
    if (end < 0) return undefined;
    labels.push(expression.slice(1, end));
    expression = expression.slice(end + 1).trim();
  }
  const name = expression.split("=", 1)[0]!.split("[", 1)[0]!.split(",", 1)[0]!.split("@", 1)[0]!.trim();
  if (name !== "alphamerge") return undefined;
  if (expression.endsWith("]")) {
    const start = expression.lastIndexOf("[");
    const output = expression.slice(start);
    if (start < 0 || output === "[]" || maps.length !== 1 || maps[0] !== output) {
      throw new Error("alphamerge: output label must be mapped exactly once");
    }
    expression = expression.slice(0, start).trim();
  } else if (maps.length) throw new Error("alphamerge: unsupported output map");
  if (expression !== "alphamerge") throw new Error("alphamerge: only default filter options are supported");
  if (!labels.length) labels.push("0:v", "1:v");
  if (labels.length !== 2) throw new Error("alphamerge: expected two video inputs");
  return labels.map(label => {
    const [input, selector, ordinal = "0", ...extra] = label.split(":");
    if (selector !== "v" || extra.length || ![input, ordinal].every(value =>
      value && [...value].every(char => char >= "0" && char <= "9") && Number.isSafeInteger(Number(value)))) {
      throw new Error(`alphamerge: invalid video input label ${label}`);
    }
    return { input: Number(input), ordinal: Number(ordinal) };
  });
}

export async function alphamerge(
  frames: MediaVideoFrame[], mattes: MediaVideoFrame[], budget: MediaBudgetTracker, signal?: AbortSignal
): Promise<MediaVideoFrame[]> {
  const output: MediaVideoFrame[] = [];
  let matteIndex = 0;
  for (const frame of frames) {
    await yieldTurn(signal);
    while (mattes[matteIndex + 1] && mattes[matteIndex + 1]!.ptsSeconds <= frame.ptsSeconds + 1e-9) matteIndex++;
    const matte = mattes[matteIndex];
    if (!matte || frame.ptsSeconds < matte.ptsSeconds - 1e-9) {
      output.push(frame);
      continue;
    }
    if (frame.width !== matte.width || frame.height !== matte.height) {
      throw new Error("alphamerge: inputs must have matching dimensions");
    }
    budget.recordFrame(frame.width, frame.height);
    budget.allocateMemory(frame.data.byteLength);
    const data = frame.data.slice();
    for (let pixel = 0; pixel < frame.width * frame.height; pixel++) {
      if (pixel % 4096 === 0) budget.checkCpu();
      data[pixel * 4 + 3] = matte.data[pixel * 4]!;
    }
    // The original native planes contain the old alpha and must not reach encoders.
    const merged = { ...frame, data };
    delete merged.native;
    output.push(merged);
  }
  return output;
}
