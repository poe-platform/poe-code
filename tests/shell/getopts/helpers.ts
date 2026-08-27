import type { GetoptsScanOptions, GetoptsScanResult, GetoptsWork } from "../../../src/shell/getopts.js";

export function options(work: Partial<GetoptsWork> = {}, reportErrors = true): GetoptsScanOptions {
  return { reportErrors, work: { maxArguments: 100, maxBytes: 100_000, maxSteps: 200_000, yieldEvery: 256, checkpoint: () => undefined, ...work } };
}

export function view(result: GetoptsScanResult): Omit<GetoptsScanResult, "state"> {
  const { state: _state, ...rest } = result;
  return rest;
}
