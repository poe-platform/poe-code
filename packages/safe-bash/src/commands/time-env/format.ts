import { checkSize, CommandFailure, type TimeEnvLimits } from "./shared.js";
import { floorDivide, monthNames, nanosecondsPerSecond, TimeZone, utcMilliseconds, weekdayNames } from "./calendar.js";

function offsetText(offset: number, colons: number): { value: string; width: number } {
  const sign = offset < 0 ? "-" : "+";
  const total = Math.abs(offset);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor(total % 3600 / 60).toString().padStart(2, "0");
  const seconds = (total % 60).toString().padStart(2, "0");
  if (colons === 0) return { value: `${sign}${hours * 100 + Number(minutes)}`, width: 5 };
  if (colons === 2 || (colons === 3 && seconds !== "00")) return { value: `${sign}${hours}:${minutes}:${seconds}`, width: 9 };
  if (colons === 1 || minutes !== "00") return { value: `${sign}${hours}:${minutes}`, width: 6 };
  return { value: `${sign}${hours}`, width: 3 };
}

export function formatDate(format: string, instant: bigint, zone: TimeZone, limits: TimeEnvLimits): string {
  const fields = zone.fields(instant);
  const midnight = utcMilliseconds({ ...fields, hour: 0, minute: 0, second: 0 });
  const weekday = new Date(midnight).getUTCDay();
  const ordinal = Math.floor((midnight - utcMilliseconds({ ...fields, month: 1, day: 1, hour: 0, minute: 0, second: 0 })) / 86400000) + 1;
  const thursday = new Date(midnight + (3 - (weekday + 6) % 7) * 86400000);
  const isoYear = thursday.getUTCFullYear();
  const isoWeek = 1 + Math.floor((thursday.getTime() - utcMilliseconds({ year: isoYear, month: 1, day: 1, hour: 0, minute: 0, second: 0 })) / 604800000);
  const nano = (instant - floorDivide(instant, nanosecondsPerSecond) * nanosecondsPerSecond).toString().padStart(9, "0");
  const number = (value: number, width = 2, padding = "0"): string => value.toString().padStart(width, padding);
  const time = `${number(fields.hour)}:${number(fields.minute)}:${number(fields.second)}`;
  const hour12 = fields.hour % 12 || 12;
  const meridian = fields.hour < 12 ? "AM" : "PM";
  const pieces: string[] = [];
  let size = 0;
  const append = (value: string): void => {
    size += Buffer.byteLength(value);
    checkSize(size + 1, limits.maxOutputBytes, "output");
    pieces.push(value);
  };
  for (let offset = 0; offset < format.length;) {
    const next = format.indexOf("%", offset);
    if (next < 0) { append(format.slice(offset)); break; }
    append(format.slice(offset, next));
    offset = next + 1;
    let padding: string | undefined, upper = false, swap = false;
    while (offset < format.length && "-_0^#".includes(format[offset]!)) {
      const flag = format[offset++]!;
      if (flag === "^") upper = true;
      else if (flag === "#") swap = true;
      else padding = flag === "-" ? "" : flag === "_" ? " " : "0";
    }
    let widthText = "";
    while (offset < format.length && /[0-9]/.test(format[offset]!)) widthText += format[offset++];
    const width = widthText ? Number(widthText) : undefined;
    if (width !== undefined) checkSize(width, limits.maxFormatWidth, "format width");
    let colons = 0;
    while (format[offset] === ":") { colons++; offset++; }
    const modifier = format[offset] === "E" || format[offset] === "O" ? format[offset++] : undefined;
    const code = format[offset++];
    if (!code || colons > 3 || (colons && code !== "z")) throw new CommandFailure("unsupported date format directive");
    if (code === "%" && (padding !== undefined || upper || swap || width !== undefined || modifier)) {
      throw new CommandFailure("only an unmodified %% literal is supported");
    }
    if (modifier && !(modifier === "E" ? "cCxXyY" : "deHImMSuUVwWy").includes(code)) throw new CommandFailure(`unsupported date format modifier: %${modifier}${code}`);
    let value: string, defaultWidth = 0, defaultPadding = "0";
    switch (code) {
      case "%": value = "%"; break;
      case "a": value = weekdayNames[weekday]!.slice(0, 3); break;
      case "A": value = weekdayNames[weekday]!; break;
      case "b": case "h": value = monthNames[fields.month - 1]!.slice(0, 3); break;
      case "B": value = monthNames[fields.month - 1]!; break;
      case "c": value = `${weekdayNames[weekday]!.slice(0, 3)} ${monthNames[fields.month - 1]!.slice(0, 3)} ${number(fields.day, 2, " ")} ${time} ${number(fields.year, 4)}`; break;
      case "C": value = String(Math.floor(fields.year / 100)); defaultWidth = 2; break;
      case "d": case "e": value = String(fields.day); defaultWidth = 2; if (code === "e") defaultPadding = " "; break;
      case "D": value = `${number(fields.month)}/${number(fields.day)}/${number(fields.year % 100, 2, padding ?? "0")}`; break;
      case "x": value = `${number(fields.month)}/${number(fields.day)}/${number(fields.year % 100)}`; break;
      case "F": {
        const yearWidth = width === undefined && padding === undefined ? 4 : Math.max(0, (width ?? 0) - 6);
        const year = padding === "" ? String(fields.year) : number(fields.year, yearWidth, padding ?? "0");
        append(`${year}-${number(fields.month)}-${number(fields.day)}`); continue;
      }
      case "g": value = String(Math.abs(isoYear % 100)); defaultWidth = 2; break;
      case "G": value = String(isoYear); defaultWidth = 4; break;
      case "H": case "k": value = String(fields.hour); defaultWidth = 2; if (code === "k") defaultPadding = " "; break;
      case "I": case "l": value = String(hour12); defaultWidth = 2; if (code === "l") defaultPadding = " "; break;
      case "j": value = String(ordinal); defaultWidth = 3; break;
      case "m": value = String(fields.month); defaultWidth = 2; break;
      case "M": value = String(fields.minute); defaultWidth = 2; break;
      case "n": value = "\n"; break;
      case "N": {
        const precision = width ?? 9;
        const digits = nano.slice(0, precision).replace(/0+$/, "") || "0";
        const length = padding === "" ? digits.length : precision;
        checkSize(size + length + 1, limits.maxOutputBytes, "output");
        append(padding === "" ? digits : digits.padEnd(precision, padding ?? "0")); continue;
      }
      case "p": value = meridian; break;
      case "P": value = meridian.toLowerCase(); break;
      case "q": value = String(Math.ceil(fields.month / 3)); defaultWidth = 1; break;
      case "r": value = `${number(hour12)}:${number(fields.minute)}:${number(fields.second)} ${meridian}`; break;
      case "R": value = `${number(fields.hour)}:${number(fields.minute)}`; break;
      case "s": value = floorDivide(instant, nanosecondsPerSecond).toString(); defaultWidth = 1; break;
      case "S": value = String(fields.second); defaultWidth = 2; break;
      case "t": value = "\t"; break;
      case "T": case "X": value = time; break;
      case "u": value = String(weekday || 7); defaultWidth = 1; break;
      case "U": value = String(Math.floor((ordinal - 1 + 7 - weekday) / 7)); defaultWidth = 2; break;
      case "V": value = String(isoWeek); defaultWidth = 2; break;
      case "w": value = String(weekday); defaultWidth = 1; break;
      case "W": value = String(Math.floor((ordinal - 1 + 7 - (weekday + 6) % 7) / 7)); defaultWidth = 2; break;
      case "y": value = String(fields.year % 100); defaultWidth = 2; break;
      case "Y": value = String(fields.year); defaultWidth = 4; break;
      case "z": { const offset = offsetText(fields.offset, colons); value = offset.value; defaultWidth = offset.width; break; }
      case "Z": value = fields.zone; break;
      default: throw new CommandFailure(`unsupported date format directive: %${code}`);
    }
    if (code === "P" || (swap && "pZ".includes(code))) value = value.toLowerCase();
    else if (upper || (swap && "aAbBh".includes(code))) value = value.toUpperCase();
    const fill = padding ?? (defaultWidth || code === "z" ? defaultPadding : " ");
    const minimum = width ?? defaultWidth;
    if (fill && minimum > value.length) value = /^[+-]/.test(value) && fill === "0"
      ? `${value[0]}${value.slice(1).padStart(minimum - 1, fill)}` : value.padStart(minimum, fill);
    append(value);
  }
  return pieces.join("") + "\n";
}
