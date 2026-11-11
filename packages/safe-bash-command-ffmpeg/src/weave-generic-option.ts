import { parseFilterExpression } from "./filter-expression.js";

// Scheduling and hardware reservations do not change woven pixels.
export function validateWeaveGenericOption(key: string, option: string, filter: string): void {
  if (key === "thread_type") {
    const flags = option.trim();
    let position = 0;
    do {
      if (flags[position] === "+" || flags[position] === "-") position++;
      const start = position;
      if (flags[position] === "+" || flags[position] === "-") position++;
      while (position < flags.length && flags[position] !== "+" && flags[position] !== "-") position++;
      const bits = parseFilterExpression(flags.slice(start, position), filter, {
        slice: 1, default: 1, min: 0, max: 2147483647, none: 0, all: -1
      });
      if (!Number.isInteger(bits) || bits < -2147483648 || bits > 4294967295) {
        throw new RangeError(`${filter}: invalid thread_type`);
      }
    } while (position < flags.length);
    return;
  }
  const minimum = key === "extra_hw_frames" ? -1 : 0;
  const number = parseFilterExpression(option, filter, {
    default: minimum, min: minimum, max: 2147483647, none: 0, all: -1,
    PI: Math.PI, E: Math.E, PHI: (1 + Math.sqrt(5)) / 2
  });
  if (!Number.isFinite(number) || number < minimum || number > 2147483647) {
    throw new RangeError(`${filter}: invalid ${key}`);
  }
}
