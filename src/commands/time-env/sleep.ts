import { command, CommandFailure, emit, type Settings } from "./shared.js";

function duration(arguments_: readonly string[]): number {
  if (!arguments_.length) throw new CommandFailure("missing operand");
  let total = 0n;
  for (const value of arguments_) {
    const match = /^\+?((?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)([smhd]?)$/.exec(value);
    if (!match) throw new CommandFailure(`invalid time interval: ${value}`);
    const parts = /^(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(match[1]!)!;
    const fraction = parts[2] ?? "";
    const digits = `${parts[1]}${fraction}`.replace(/^0+/, "");
    if (!digits) continue;
    const scale = Number(parts[3] ?? "0") - fraction.length;
    const multiplier = match[2] === "d" ? 86400n : match[2] === "h" ? 3600n : match[2] === "m" ? 60n : 1n;
    if (digits.length + scale > 13) throw new CommandFailure("time interval exceeds supported finite range");
    if (digits.length + scale < -15) total += 1n;
    else {
      const coefficient = BigInt(digits) * multiplier * 1000000000n;
      if (scale >= 0) total += coefficient * 10n ** BigInt(scale);
      else {
        const divisor = 10n ** BigInt(-scale);
        total += (coefficient + divisor - 1n) / divisor;
      }
    }
    if (total > BigInt(Number.MAX_SAFE_INTEGER) * 1000000n) throw new CommandFailure("time interval exceeds supported finite range");
  }
  return Number((total + 999999n) / 1000000n);
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
        ? "Usage: sleep NUMBER[smhd] ...\nSum finite nonnegative decimal durations; cancellation clears pending timers.\n"
        : "sleep (safe-bash virtual command)\n", configuration.limits);
      return 0;
    }
    await delay(duration(context.args), context.signal, configuration);
    return 0;
  });
}
