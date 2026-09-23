import { command, CommandFailure, emit, type Settings } from "./shared.js";

function duration(arguments_: readonly string[]): number {
  if (!arguments_.length) throw new CommandFailure("missing operand");
  const base = 1000000000n;
  const maximum = BigInt(Number.MAX_SAFE_INTEGER);
  const columns = new Map<bigint, bigint>();
  for (const value of arguments_) {
    const match = /^[ \t\n\r\v\f]*\+?((?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?|0[xX](?:[\da-fA-F]+(?:\.[\da-fA-F]*)?|\.[\da-fA-F]+)(?:[pP][+-]?\d+)?)([smhd]?)$/.exec(value);
    if (!match) throw new CommandFailure(`invalid time interval: ${value}`);
    const hexadecimal = /^0[xX]([\da-fA-F]*)(?:\.([\da-fA-F]*))?(?:[pP]([+-]?\d+))?$/.exec(match[1]!);
    let digits: string, scale: bigint;
    if (hexadecimal) {
      const fraction = hexadecimal[2] ?? "";
      let coefficient = BigInt(`0x${hexadecimal[1]}${fraction}`);
      if (!coefficient) continue;
      const exponent = BigInt(hexadecimal[3] ?? "0") - 4n * BigInt(fraction.length);
      const bits = BigInt(coefficient.toString(2).length);
      if (bits + exponent > 44n) throw new CommandFailure("time interval exceeds supported finite range");
      // C floating-point hexadecimal operands below the subnormal range become zero.
      if (bits + exponent < -1074n) continue;
      if (exponent >= 0n) { coefficient <<= exponent; scale = 3n; }
      else { coefficient *= 5n ** -exponent; scale = exponent + 3n; }
      digits = coefficient.toString();
    } else {
      const parts = /^(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(match[1]!)!;
      const fraction = parts[2] ?? "";
      digits = `${parts[1]}${fraction}`.replace(/^0+/, "");
      scale = BigInt(parts[3] ?? "0") - BigInt(fraction.length) + 3n;
    }
    if (!digits) continue;
    const multiplier = match[2] === "d" ? 86400n : match[2] === "h" ? 3600n : match[2] === "m" ? 60n : 1n;
    const coefficient = (BigInt(digits) * multiplier).toString();
    if (BigInt(coefficient.length) + scale > 16n) throw new CommandFailure("time interval exceeds supported finite range");
    const shift = (scale % 9n + 9n) % 9n;
    let position = (scale - shift) / 9n;
    const aligned = coefficient + "0".repeat(Number(shift));
    for (let end = aligned.length; end > 0; end -= 9, position++) {
      const column = BigInt(aligned.slice(Math.max(0, end - 9), end));
      if (column) columns.set(position, (columns.get(position) ?? 0n) + column);
    }
  }
  let whole = 0n, fractional = false, carry = 0n, carryPosition = 0n;
  const collect = (value: bigint, position: bigint): void => {
    if (position < 0n) fractional ||= value !== 0n;
    else if (value) {
      if (position > 1n) throw new CommandFailure("time interval exceeds supported finite range");
      whole += value * base ** position;
      if (whole > maximum) throw new CommandFailure("time interval exceeds supported finite range");
    }
  };
  const ordered = [...columns].sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
  for (const [position, value] of ordered) {
    while (carry && carryPosition < position) {
      collect(carry % base, carryPosition++);
      carry /= base;
    }
    const combined = value + carry;
    collect(combined % base, position);
    carry = combined / base;
    carryPosition = position + 1n;
  }
  while (carry) {
    collect(carry % base, carryPosition++);
    carry /= base;
  }
  const rounded = whole + BigInt(fractional);
  if (rounded > maximum) throw new CommandFailure("time interval exceeds supported finite range");
  return Number(rounded);
}

function delay(milliseconds: number, signal: AbortSignal, configuration: Settings): Promise<void> {
  signal.throwIfAborted();
  if (milliseconds === 0) return Promise.resolve();
  const scheduler = configuration.scheduler;
  return new Promise<void>((resolve, reject) => {
    let handle: unknown;
    let armed = false;
    let settled = false;
    let started: number | undefined;
    let previous: number | undefined;
    const finish = (failed: boolean, reason?: unknown): void => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", aborted);
      try { if (armed) { armed = false; scheduler.clearTimeout(handle); } }
      catch (error) { reject(error); return; }
      if (failed) reject(reason);
      else resolve();
    };
    const aborted = (): void => finish(true, signal.reason);
    const schedule = (): void => {
      if (settled) return;
      try {
        signal.throwIfAborted();
        const now = scheduler.now();
        if (!Number.isFinite(now) || Math.abs(now) > Number.MAX_SAFE_INTEGER || (previous !== undefined && now < previous)) {
          throw new RangeError("sleep scheduler must supply finite monotonic milliseconds");
        }
        started ??= now;
        previous = now;
        const remaining = milliseconds - (now - started);
        if (remaining <= 0) { finish(false); return; }
        const timer = scheduler.setTimeout(() => { armed = false; schedule(); },
          Math.min(configuration.maxTimerMilliseconds, Math.max(1, Math.ceil(remaining))));
        if (settled) scheduler.clearTimeout(timer);
        else { handle = timer; armed = true; }
      } catch (error) { finish(true, error); }
    };
    signal.addEventListener("abort", aborted, { once: true });
    schedule();
  });
}

export function createSleepCommand(configuration: Settings) {
  return command("sleep", configuration, async context => {
    let informational: string | undefined;
    for (const argument of context.args) {
      if (argument === "--") break;
      if (argument === "--help" || argument === "--version") { informational = argument; break; }
      if (argument.startsWith("-") && argument !== "-") throw new CommandFailure(`invalid option: ${argument}`);
    }
    if (informational) {
      await emit(context, informational === "--help"
        ? "Usage: sleep NUMBER[smhd] ...\nSum finite nonnegative decimal or hexadecimal durations; cancellation clears pending timers.\n"
        : "sleep (safe-bash virtual command)\n", configuration.limits);
      return 0;
    }
    const terminator = context.args.indexOf("--");
    const operands = terminator < 0 ? context.args
      : [...context.args.slice(0, terminator), ...context.args.slice(terminator + 1)];
    await delay(duration(operands), context.signal, configuration);
    return 0;
  });
}
