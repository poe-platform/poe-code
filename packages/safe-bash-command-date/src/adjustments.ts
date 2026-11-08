import { boundedInstant, floorDivide, nanosecondsPerSecond, TimeZone, utcMilliseconds } from "safe-bash-calendar-engine/time-env/calendar";
import { CommandFailure } from "safe-bash-calendar-engine/time-env/shared";

export function isEpochSeconds(value: string): boolean {
  let index = value[0] === "+" || value[0] === "-" ? 1 : 0;
  const start = index;
  while (index < value.length && value[index]! >= "0" && value[index]! <= "9") index++;
  if (index === start) return false;
  if (value[index] === ".") {
    const fraction = ++index;
    while (index < value.length && value[index]! >= "0" && value[index]! <= "9") index++;
    if (fraction === index) return false;
  }
  return index === value.length;
}

export interface DateAdjustment {
  readonly unit: string;
  readonly amount: number;
  readonly relative: boolean;
}

export function parseAdjustment(value: string): DateAdjustment {
  const unit = value.slice(-1);
  const number = value.slice(0, -1);
  if (!unit || !"ymwdHMS".includes(unit) || !isEpochSeconds(number) || number.includes(".")) {
    throw new CommandFailure(`invalid date adjustment: ${value}`);
  }
  const amount = Number(number);
  const relative = number[0] === "+" || number[0] === "-";
  if (!Number.isSafeInteger(amount)) throw new CommandFailure(`date adjustment is outside the supported range: ${value}`);
  if (!relative) {
    const ranges: Record<string, readonly [number, number]> = { y: [0, 9999], m: [1, 12], w: [0, 6], d: [1, 31], H: [0, 23], M: [0, 59], S: [0, 59] };
    const [min, max] = ranges[unit]!;
    if (amount < min || amount > max) throw new CommandFailure(`invalid date adjustment: ${value}`);
  }
  return { unit, amount: !relative && unit === "y" && amount <= 1900 ? amount + (amount < 69 ? 2000 : 1900) : amount, relative };
}

export function adjustDate(instant: bigint, adjustments: readonly DateAdjustment[], zone: TimeZone): bigint {
  for (const { unit, amount, relative } of adjustments) {
    if (relative && "HMS".includes(unit)) {
      const scale = unit === "H" ? 3600n : unit === "M" ? 60n : 1n;
      instant = boundedInstant(instant + BigInt(amount) * scale * nanosecondsPerSecond);
      continue;
    }
    const fields = zone.fields(instant);
    const date = new Date(utcMilliseconds(fields));
    const fraction = instant - floorDivide(instant, nanosecondsPerSecond) * nanosecondsPerSecond;
    if (unit === "y" || unit === "m") {
      // BSD month/year changes clamp the day to the destination month's last day.
      date.setUTCDate(1);
      if (unit === "y") date.setUTCFullYear(relative ? fields.year + amount : amount);
      else date.setUTCMonth(relative ? fields.month - 1 + amount : amount - 1);
      const next = new Date(date.getTime());
      next.setUTCMonth(next.getUTCMonth() + 1, 0);
      date.setUTCDate(Math.min(fields.day, next.getUTCDate()));
    } else if (unit === "w") date.setUTCDate(fields.day + (relative ? amount * 7 : amount - date.getUTCDay()));
    else if (unit === "d") date.setUTCDate(relative ? fields.day + amount : amount);
    else if (unit === "H") date.setUTCHours(amount);
    else if (unit === "M") date.setUTCMinutes(amount);
    else date.setUTCSeconds(amount);
    if (!Number.isFinite(date.getTime())) throw new CommandFailure("date adjustment is outside the supported range");
    if (!relative && unit === "d" && date.getUTCMonth() + 1 !== fields.month) throw new CommandFailure("invalid calendar date adjustment");
    instant = zone.instant({ year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate(),
      hour: date.getUTCHours(), minute: date.getUTCMinutes(), second: date.getUTCSeconds() }, fraction, "compatible");
  }
  return instant;
}
