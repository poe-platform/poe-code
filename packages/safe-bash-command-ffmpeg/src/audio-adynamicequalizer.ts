import type { MediaBudgetTracker } from "@poe-code/mp4-ast";
import { yieldTurn } from "safe-bash-contracts/yield";
import { parseFilterExpression } from "./filter-expression.js";

export async function listenDynamicEqualizer(
  channels: readonly (Float32Array | Float64Array)[], sampleRate: number, filter: string,
  budget: MediaBudgetTracker, signal?: AbortSignal
): Promise<Float32Array[]> {
  const options = { dfrequency: 1000, dqfactor: 1 };
  let mode = 0;
  const argument = filter.includes("=") ? filter.slice(filter.indexOf("=") + 1) : "";
  for (const option of argument ? argument.split(":") : []) {
    const separator = option.indexOf("=");
    const key = option.slice(0, separator).trim();
    const value = option.slice(separator + 1).trim();
    if (separator < 0) throw new Error("adynamicequalizer: expected named options");
    if (key === "mode") {
      mode = parseFilterExpression(value, "adynamicequalizer", { listen: -1 });
    } else if (key === "dfrequency" || key === "dqfactor") {
      const number = parseFilterExpression(value, "adynamicequalizer", {});
      const min = key === "dfrequency" ? 2 : 0.001;
      const max = key === "dfrequency" ? 1000000 : 1000;
      if (!value || !Number.isFinite(number) || number < min || number > max) {
        throw new Error(`adynamicequalizer: invalid ${key}`);
      }
      options[key] = number;
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
