import type { MediaBudgetTracker } from "@poe-code/mp4-ast";
import { yieldTurn } from "safe-bash-contracts/yield";
import { parseFilterExpression } from "./filter-expression.js";

export async function listenDynamicEqualizer(
  channels: readonly (Float32Array | Float64Array)[], sampleRate: number, filter: string,
  budget: MediaBudgetTracker, signal?: AbortSignal
): Promise<Float32Array[]> {
  const options = { dfrequency: 1000, dqfactor: 1 };
  const ranges = {
    threshold: [0, 100], dfrequency: [2, 1000000], dqfactor: [0.001, 1000],
    tfrequency: [2, 1000000], tqfactor: [0.001, 1000], attack: [0.01, 2000],
    release: [0.01, 2000], ratio: [0, 30], makeup: [0, 1000], range: [1, 2000]
  };
  const names = [...Object.keys(ranges), "mode"];
  let positionalIndex = 0;
  let mode = 0;
  const argument = filter.includes("=") ? filter.slice(filter.indexOf("=") + 1) : "";
  for (const option of argument ? argument.split(":") : []) {
    const separator = option.indexOf("=");
    const key = separator < 0 ? names[positionalIndex++] : option.slice(0, separator).trim();
    const value = option.slice(separator + 1).trim();
    if (key === "mode") {
      mode = parseFilterExpression(value, "adynamicequalizer", { listen: -1 });
    } else if (key && Object.hasOwn(ranges, key)) {
      const number = parseFilterExpression(value, "adynamicequalizer", {});
      const [min, max] = ranges[key as keyof typeof ranges];
      if (!value || !Number.isFinite(number) || number < min! || number > max!) {
        throw new Error(`adynamicequalizer: invalid ${key}`);
      }
      // Only detection frequency and Q affect the listen signal.
      if (key === "dfrequency" || key === "dqfactor") options[key] = number;
    } else {
      throw new Error(`adynamicequalizer: unsupported option ${key}`);
    }
  }
  if (mode !== -1) {
    throw new Error("adynamicequalizer: only mode=listen is supported");
  }

  // The native detector is a state-variable band-pass filter with float
  // coefficients and state on the PCM input path. Round each float operation.
  const f = Math.fround;
  const frequency = f(Math.min(options.dfrequency, sampleRate * 0.5));
  const g = f(Math.tan(f(Math.PI * frequency / sampleRate)));
  const k = f(1 / f(options.dqfactor));
  const a0 = f(1 / f(1 + f(g * f(g + k))));
  const a1 = f(g * a0);
  const a2 = f(g * a1);
  budget.allocateMemory(channels.reduce((sum, channel) => sum + channel.length * 4, 0));
  const output = channels.map(channel => new Float32Array(channel.length));
  let work = 0;
  for (const [c, channel] of channels.entries()) {
    let state0 = 0;
    let state1 = 0;
    for (let i = 0; i < channel.length; i++) {
      if (work++ % 4096 === 0) {
        await yieldTurn(signal);
        signal?.throwIfAborted();
        budget.checkCpu();
      }
      const delta = f(f(channel[i]!) - state1);
      const band = f(f(a0 * state0) + f(a1 * delta));
      const low = f(f(state1 + f(a1 * state0)) + f(a2 * delta));
      state0 = f(f(2 * band) - state0);
      state1 = f(f(2 * low) - state1);
      output[c]![i] = f(k * band);
    }
  }
  return output;
}
