/** Primitive fields keep dynamic bindings independent when shell state is forked. */
export interface DynamicVariableState {
  randomSeed?: number;
  randomDisabled?: boolean;
  secondsOrigin?: number;
  secondsDisabled?: boolean;
}

export function writeDynamicVariable(state: DynamicVariableState, name: string, value: string): void {
  if (name !== "RANDOM" && name !== "SECONDS") return;
  const number = Number.parseInt(value, 10) || 0;
  if (name === "RANDOM" && !state.randomDisabled) {
    state.randomSeed = (number >>> 0) % 2147483647 || 1;
  } else if (name === "SECONDS" && !state.secondsDisabled) {
    state.secondsOrigin = Date.now() - number * 1000;
  }
}

export function readDynamicVariable(state: DynamicVariableState, name: string): string | undefined {
  if (name === "RANDOM" && !state.randomDisabled) {
    // Park–Miller's bounded integer state gives repeatable seeded sequences.
    const seed = ((state.randomSeed ?? 1) * 16807) % 2147483647;
    state.randomSeed = seed;
    return String((seed ^ (seed >>> 16)) & 32767);
  }
  if (name === "SECONDS" && !state.secondsDisabled) {
    state.secondsOrigin ??= Date.now();
    return String(Math.floor((Date.now() - state.secondsOrigin) / 1000));
  }
  return undefined;
}
