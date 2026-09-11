import type { Budget } from "../budget.js";
import { sandboxGetProperty } from "../guest-proxy-get.js";
import { retainValues } from "../resources.js";
import { setSandboxPrototype } from "../object-model.js";
import { sandboxNumber, sandboxString } from "../string-coercion.js";
import type { SandboxCallContext, SandboxValue } from "../values.js";

const unitNanoseconds: Record<string,bigint> = {
  hour:3600000000000n, minute:60000000000n, second:1000000000n,
  millisecond:1000000n, microsecond:1000n, nanosecond:1n
};

export async function roundTemporalInstant(epoch: bigint, options: SandboxValue, budget: Budget, context?: SandboxCallContext): Promise<bigint> {
  if (typeof options === "string") {
    options = {smallestUnit:options};
    setSandboxPrototype(options,null);
  }
  else if (options === null || typeof options !== "object") throw new TypeError("Instant rounding requires a string or options object.");
  let current: SandboxValue;
  const release = retainValues(budget,()=>[options,current]);
  try {
    current = await sandboxGetProperty(options,"roundingIncrement",options,budget,context);
    const increment = current === undefined ? 1 : Math.trunc(await sandboxNumber(current,budget,context));
    if (!Number.isFinite(increment) || increment < 1 || increment > 1000000000) throw new RangeError("Invalid Temporal rounding increment.");
    current = await sandboxGetProperty(options,"roundingMode",options,budget,context);
    const mode = current === undefined ? "halfExpand" : await sandboxString(current,budget,context);
    if (!["ceil","floor","expand","trunc","halfCeil","halfFloor","halfExpand","halfTrunc","halfEven"].includes(mode))
      throw new RangeError("Invalid Temporal rounding mode.");
    current = await sandboxGetProperty(options,"smallestUnit",options,budget,context);
    if (current === undefined) throw new RangeError("Instant rounding requires smallestUnit.");
    const text = await sandboxString(current,budget,context);
    const unit = text.endsWith("s") ? text.slice(0,-1) : text;
    if (!Object.hasOwn(unitNanoseconds,unit)) throw new RangeError("Invalid Instant rounding unit.");
    const unitLength = unitNanoseconds[unit];
    const incrementBigInt = BigInt(increment);
    const maximum = 86400000000000n / unitLength;
    if (incrementBigInt > maximum || maximum % incrementBigInt !== 0n) throw new RangeError("Rounding increment must divide a day.");
    const step = incrementBigInt * unitLength;
    // Floor division keeps the remainder positive, implementing Temporal's
    // RoundNumberToIncrementAsIfPositive even for epochs before 1970.
    let lower = epoch / step;
    if (epoch % step < 0n) lower--;
    const remainder = epoch - lower * step;
    if (remainder === 0n) return epoch;
    let up = mode === "ceil" || mode === "expand";
    if (mode.startsWith("half")) {
      const twice = remainder * 2n;
      up = twice > step || (twice === step &&
        (mode === "halfCeil" || mode === "halfExpand" || (mode === "halfEven" && lower % 2n !== 0n)));
    }
    return (lower + (up ? 1n : 0n)) * step;
  } finally { release(); }
}
