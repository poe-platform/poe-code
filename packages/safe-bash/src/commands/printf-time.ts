import { TimeZone } from "safe-bash-calendar-engine/time-env/calendar";
import { formatDate } from "safe-bash-calendar-engine/time-env/format";
import { CommandFailure, settings } from "safe-bash-calendar-engine/time-env/shared";
import { yieldTurn } from "../contracts/yield.js";
import { UsageError } from "./internal.js";

/** Bash strftime with deterministic C and en_US locale formats. */
export async function printfTime(format: string, seconds: bigint, env: Readonly<Record<string, string>>, signal: AbortSignal): Promise<string> {
  const locale = env.LC_ALL || env.LC_TIME || env.LANG || "C";
  const us = locale.split(".")[0] === "en_US";
  const parts: string[] = [];
  let size = 0;
  const append = (part: string): void => {
    size += part.length;
    if (size > 1_000_000) throw new UsageError("time format is too large");
    parts.push(part);
  };
  for (let offset = 0; offset < format.length;) {
    if (offset % 1024 === 0) await yieldTurn(signal);
    const character = format[offset++]!;
    if (character !== "%") { append(character); continue; }
    let flags = "";
    while (offset < format.length && "-_0".includes(format[offset]!)) {
      const flag = format[offset++]!;
      if (!flags.includes(flag)) flags += flag;
      if (offset % 1024 === 0) await yieldTurn(signal);
    }
    if (format[offset] === "E" || format[offset] === "O") offset++;
    const code = format[offset++];
    if (code === undefined || code === "%") append("%%");
    else if (code === "+") append("%a %b %e %H:%M:%S %Z %Y");
    else if (code === "v") append("%e-%b-%Y");
    else if (us && code === "x") append("%m/%d/%Y");
    else if (us && code === "X") append("%r");
    else if (us && code === "c") append("%a %d %b %Y %r %Z");
    else if ("aAbBcCdeDFgGhHIjklmMnprRsStTuUVwWxXyYzZ".includes(code)) append(`%${flags}${code}`);
    else append(code);
  }
  try {
    const value = formatDate(parts.join(""), seconds * 1_000_000_000n, new TimeZone(env.TZ ?? "UTC"),
      settings({ limits: { maxOutputBytes: 1_000_000, maxFormatWidth: 1_000_000 } }).limits);
    return value.slice(0, -1);
  } catch (error) {
    if (error instanceof CommandFailure) throw new UsageError(error.message);
    throw error;
  }
}
