import { randomInt } from "node:crypto";

import { createSeededRandom } from "./interp/globals/math.js";
import type { SafeJSSnapshot } from "./restore.js";
import type { RunRandom } from "./run.js";

export type ReplayableRandom = RunRandom & {
  restore: (state: number) => void;
};

export function createReplayableRandom(
  options: {
    seed?: number;
    snapshot?: SafeJSSnapshot;
  } = {}
): ReplayableRandom {
  const snapshot = options.snapshot;
  const saved = snapshot?.random;
  let initialState = options.seed;
  if (saved !== undefined) {
    const hasLoopState =
      typeof snapshot?.loopIterations === "object" &&
      snapshot.loopIterations !== null &&
      Object.keys(snapshot.loopIterations).length > 0;
    const replaysFromStart =
      snapshot?.replay !== undefined ||
      (Array.isArray(snapshot?.pendingAwaits) &&
        snapshot.pendingAwaits.length > 0 &&
        !hasLoopState);
    initialState = replaysFromStart
      ? (saved.initialState ?? saved.seed)
      : (saved.resumeState ?? saved.state);
  }
  const generator = createSeededRandom(initialState ?? randomInt(4_294_967_296));
  return { seed: saved?.seed ?? generator.snapshot(), ...generator };
}
