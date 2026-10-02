import { timezoneNames, timezoneProfiles } from "./timezone-data.js";

type TransitionRule = readonly [month: number, week: number, weekday: number, seconds: number];
export type TimezoneProfile = readonly [
  initial: number,
  transitions: readonly (readonly [seconds: number, offset: number])[],
  future: number | readonly [standard: number, daylight: number, start: TransitionRule, end: TransitionRule]
];
const names = new Map(Object.entries(timezoneNames).map(([name, index]) => [name.toLowerCase(), index]));

/** Offset facts from the pinned native TZif profile, independent of host ICU. */
export function timezoneOffset(name: string, milliseconds: number, tick: () => void): number | undefined {
  tick();
  const index = names.get(name.toLowerCase());
  if (index === undefined) return undefined;
  const [initial, transitions, future] = timezoneProfiles[index]!;
  const seconds = milliseconds / 1000;
  let low = 0, high = transitions.length;
  while (low < high) {
    tick(); const middle = Math.floor((low + high) / 2);
    if (transitions[middle]![0] <= seconds) low = middle + 1; else high = middle;
  }
  if (transitions.length && low < transitions.length) return low ? transitions[low - 1]![1] : initial;
  if (typeof future === "number") return future;
  const [standard, daylight, startRule, endRule] = future;
  const year = new Date(milliseconds).getUTCFullYear();
  const transition = (rule: TransitionRule, offset: number): number => {
    tick();
    // Reduce to a Gregorian 400-year cycle so even boundary-year transitions
    // outside JavaScript's Date range can be compared to an admitted instant.
    const era = Math.floor(year / 400), date = new Date(0);
    date.setUTCFullYear(year - era * 400, rule[0] - 1, 1);
    let day = 1 + (rule[2] - date.getUTCDay() + 7) % 7 + (rule[1] - 1) * 7;
    date.setUTCMonth(rule[0], 0);
    if (day > date.getUTCDate()) day -= 7;
    date.setUTCFullYear(year - era * 400, rule[0] - 1, day);
    return date.getTime() / 1000 + era * 146097 * 86400 + rule[3] - offset;
  };
  const start = transition(startRule, standard), end = transition(endRule, daylight);
  const inDaylight = start < end ? seconds >= start && seconds < end : seconds >= start || seconds < end;
  return inDaylight ? daylight : standard;
}
