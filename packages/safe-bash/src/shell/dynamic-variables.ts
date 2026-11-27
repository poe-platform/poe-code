export function initializeIdentityVariables(variables: Record<string, string>): void {
  variables.UID ??= "1000";
  variables.EUID ??= variables.UID;
  variables.PPID = "0";
  variables.OSTYPE ??= "linux-gnu";
  variables.HOSTTYPE ??= "x86_64";
  variables.MACHTYPE ??= `${variables.HOSTTYPE}-pc-${variables.OSTYPE}`;
  variables.HOSTNAME ??= "sandbox";
  const level = Number(variables.SHLVL ?? 0);
  variables.SHLVL = String(Number.isSafeInteger(level) ? Math.max(0, level + 1) : 1);
}

export const dynamicVariableNames: ReadonlySet<string> = new Set([
  "RANDOM", "SECONDS", "EPOCHSECONDS", "EPOCHREALTIME", "SRANDOM",
]);

/** Primitive fields keep dynamic bindings independent when shell state is forked. */
export interface DynamicVariableState {
  arg0?: string;
  bashArgv0Disabled?: boolean;
  randomSeed?: number;
  randomDisabled?: boolean;
  secondsOrigin?: number;
  secondsDisabled?: boolean;
  epochSecondsDisabled?: boolean;
  epochRealtimeDisabled?: boolean;
  srandomDisabled?: boolean;
}

export function writeDynamicVariable(state: DynamicVariableState, name: string, value: string): void {
  if (name === "BASH_ARGV0" && !state.bashArgv0Disabled) state.arg0 = value;
  if (name !== "RANDOM" && name !== "SECONDS") return;
  const number = Number.parseInt(value, 10) || 0;
  if (name === "RANDOM" && !state.randomDisabled) {
    state.randomSeed = (number >>> 0) % 2147483647 || 1;
  } else if (name === "SECONDS" && !state.secondsDisabled) {
    state.secondsOrigin = Date.now() - number * 1000;
  }
}

export function readDynamicVariable(state: DynamicVariableState, name: string): string | undefined {
  if (name === "EPOCHSECONDS" && !state.epochSecondsDisabled) {
    return String(Math.floor(Date.now() / 1000));
  }
  if (name === "EPOCHREALTIME" && !state.epochRealtimeDisabled) {
    const now = Date.now();
    return `${Math.floor(now / 1000)}.${String(now % 1000).padStart(3, "0")}000`;
  }
  if (name === "SRANDOM" && !state.srandomDisabled) {
    return String(globalThis.crypto.getRandomValues(new Uint32Array(1))[0]);
  }
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
