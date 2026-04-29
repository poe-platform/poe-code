import { createSeededRandom } from "../interp/globals/math.js";

export type TimeModuleOptions = {
  seed?: number;
};

export function makeTimeModule(options: TimeModuleOptions = {}): {
  random: () => number;
  now: () => number;
  uuid: () => string;
} {
  const random =
    options.seed === undefined ? () => Math.random() : createSeededRandom(options.seed).next;

  return {
    random,
    now: () => Date.now(),
    uuid: () => crypto.randomUUID()
  };
}
