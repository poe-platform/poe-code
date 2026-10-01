import { JqError, JqLimitError, type Budget, type Json } from "./limits.js";
import { isNumber, numberValue } from "./numbers.js";

export function fromDateIso8601(input: Json): number {
  if (typeof input !== "string") throw new JqError("strptime/1 requires string inputs and arguments");
  const mismatch = () => new JqError(`date ${JSON.stringify(input)} does not match format "%Y-%m-%dT%H:%M:%SZ"`);
  const parts = input.split("T");
  if (parts.length !== 2 || !parts[1]!.endsWith("Z")) throw mismatch();
  const date = parts[0]!.split("-");
  const time = parts[1]!.slice(0, -1).split(":");
  const fields = [...date, ...time];
  if (date.length !== 3 || time.length !== 3 || fields.some((field, index) => field.length === 0
    || field.length > (index === 0 ? 4 : 2) || [...field].some(character => !"0123456789".includes(character)))) throw mismatch();
  const [year, month, day, hour, minute, second] = fields.map(Number) as [number, number, number, number, number, number];
  if (month < 1 || month > 12 || day > 31 || hour > 23 || minute > 59 || second > 60) throw mismatch();
  if (year < 1900) throw new JqError("invalid gmtime representation");
  // Like jq's mktime, UTC normalizes day overflow and leap seconds.
  return Date.UTC(year, month - 1, day, hour, minute, second) / 1000;
}

export function toDateIso8601(input: Json): string {
  if (!isNumber(input)) throw new JqError("strftime/1 requires parsed datetime inputs");
  const date = new Date(Math.trunc(numberValue(input)) * 1000);
  if (!Number.isFinite(date.getTime())) throw new JqError("error converting number of seconds since epoch to datetime");
  const year = String(date.getUTCFullYear()).padStart(4, "0");
  const fields = [date.getUTCMonth() + 1, date.getUTCDate(), date.getUTCHours(), date.getUTCMinutes(), date.getUTCSeconds()]
    .map(value => String(value).padStart(2, "0"));
  return `${year}-${fields[0]}-${fields[1]}T${fields[2]}:${fields[3]}:${fields[4]}Z`;
}

const weekdays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const compoundFormats: Readonly<Record<string, string>> = { F: "%Y-%m-%d", D: "%m/%d/%y", R: "%H:%M", T: "%H:%M:%S", r: "%I:%M:%S %p", c: "%a %b %e %T %Y", x: "%m/%d/%y", X: "%T", "+": "%a %b %e %T %Z %Y" };

function utcDate(fields: readonly number[]): Date {
  const date = new Date(0);
  date.setUTCFullYear(fields[0]!, fields[1]!, fields[2]!);
  date.setUTCHours(fields[3]!, fields[4]!, Math.trunc(fields[5]!), 0);
  return date;
}

function datetime(input: Json, name: string): number[] {
  if (!Array.isArray(input) || input.length < 8 || input.slice(0, 8).some(value => !isNumber(value))) throw new JqError(`${name} requires parsed datetime inputs`);
  return input.slice(0, 8).map(value => {
    if (!isNumber(value)) throw new JqError(`${name} requires parsed datetime inputs`);
    return Math.trunc(numberValue(value));
  });
}

export function gmtime(input: Json): number[] {
  if (!isNumber(input)) throw new JqError("gmtime() requires numeric inputs");
  const seconds = numberValue(input);
  const date = new Date(Math.trunc(seconds) * 1000);
  if (!Number.isFinite(date.getTime())) throw new JqError("error converting number of seconds since epoch to datetime");
  const fields = [date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), date.getUTCHours(), date.getUTCMinutes(), date.getUTCSeconds() + seconds - Math.floor(seconds), date.getUTCDay()];
  const start = utcDate([fields[0]!, 0, 1, 0, 0, 0]);
  fields.push(Math.floor((date.getTime() - start.getTime()) / 86400000));
  return fields;
}

export function mktime(input: Json): number {
  const fields = datetime(input, "mktime");
  const seconds = utcDate(fields).getTime() / 1000;
  if (!Number.isFinite(seconds) || fields[0]! < 1900 || seconds === -1) throw new JqError("invalid gmtime representation");
  if (seconds === -2) throw new JqError("mktime not supported on this platform");
  return seconds;
}

export function strftime(input: Json, format: Json, budget: Budget): string {
  if (typeof format !== "string") throw new JqError("strftime/1 requires a string format");
  const fields = isNumber(input) ? gmtime(input) : datetime(input, "strftime/1");
  const [year, month, day, hour, minute, second, weekday, yearday] = fields as [number, number, number, number, number, number, number, number];
  const pad = (value: number, width = 2, fill = "0") => String(Math.trunc(value)).padStart(width, fill);
  const date = utcDate(fields);
  const thursday = new Date(date);
  thursday.setUTCDate(date.getUTCDate() + 3 - ((date.getUTCDay() + 6) % 7));
  const isoYear = thursday.getUTCFullYear();
  const isoWeek = 1 + Math.floor((thursday.getTime() - utcDate([isoYear, 0, 1, 0, 0, 0]).getTime()) / 604800000);
  const directives: Readonly<Record<string, string>> = {
    Y: pad(year, 4), y: pad(year % 100), C: pad(Math.floor(year / 100)), m: pad(month + 1), d: pad(day), e: pad(day, 2, " "),
    H: pad(hour), k: pad(hour, 2, " "), I: pad(hour % 12 || 12), l: pad(hour % 12 || 12, 2, " "), M: pad(minute), S: pad(second),
    p: hour < 12 ? "AM" : "PM", P: hour < 12 ? "am" : "pm", a: weekdays[weekday]?.slice(0, 3) ?? "?", A: weekdays[weekday] ?? "?",
    b: months[month]?.slice(0, 3) ?? "?", h: months[month]?.slice(0, 3) ?? "?", B: months[month] ?? "?", j: pad(yearday + 1, 3),
    w: String(weekday), u: String(weekday || 7), U: pad(Math.floor((yearday + 7 - weekday) / 7)), W: pad(Math.floor((yearday + 7 - ((weekday + 6) % 7)) / 7)),
    G: pad(isoYear, 4), g: pad(isoYear % 100), V: pad(isoWeek), s: String(date.getTime() / 1000), z: "+0000", Z: "UTC", "%": "%", n: "\n", t: "\t",
  };
  const fragments: string[] = [];
  let bytes = 2;
  const emit = (text: string): void => {
    bytes += budget.value(text) - 2;
    if (bytes > budget.limits.maxValueBytes) throw new JqLimitError("maxValueBytes");
    fragments.push(text);
  };
  const append = (source: string): void => {
    for (let index = 0; index < source.length; index++) {
      budget.step();
      if (source[index] !== "%") {
        const character = String.fromCodePoint(source.codePointAt(index)!);
        emit(character);
        index += character.length - 1;
      }
      else {
        let directive = source[++index] ?? "%";
        if (directive === "E" || directive === "O") directive = source[++index] ?? "%";
        if (Object.hasOwn(compoundFormats, directive)) append(compoundFormats[directive]!);
        else emit(directives[directive] ?? directive);
      }
    }
  };
  append(format);
  return fragments.join("");
}

export function strptime(input: Json, format: Json, budget: Budget): Json[] {
  if (typeof input !== "string" || typeof format !== "string") throw new JqError("strptime/1 requires string inputs and arguments");
  const mismatch = () => new JqError(`date ${JSON.stringify(input)} does not match format ${JSON.stringify(format)}`);
  const fields = [1900, 0, 0, 0, 0, 0, 0, -1];
  let position = 0;
  let afternoon: boolean | undefined;
  let ordinal: number | undefined;
  let century: number | undefined;
  let shortYear: number | undefined;
  let week: { number: number; monday: boolean } | undefined;
  let hasDate = false;
  let zoneMinutes: number | undefined;
  const whitespace = (character: string) => " \t\r\n\v\f".includes(character);
  const skipSpace = () => { while (position < input.length && whitespace(input[position]!)) { budget.step(); position++; } };
  const numeric = (width: number, min: number, max: number): number => {
    skipSpace();
    const start = position;
    while (position - start < width && position < input.length && "0123456789".includes(input[position]!)) position++;
    const value = Number(input.slice(start, position));
    if (position === start || value < min || value > max) throw mismatch();
    return value;
  };
  const named = (names: readonly string[]): number => {
    for (let index = 0; index < names.length; index++) {
      const name = names[index]!.toLowerCase();
      for (const text of [name, name.slice(0, 3)]) if (input.slice(position, position + text.length).toLowerCase() === text) { position += text.length; return index; }
    }
    throw mismatch();
  };
  const consume = (source: string): void => {
    for (let index = 0; index < source.length; index++) {
      budget.step();
      const character = source[index]!;
      if (whitespace(character)) { skipSpace(); continue; }
      if (character !== "%") { if (input[position++] !== character) throw mismatch(); continue; }
      let directive = source[++index];
      if (directive === "E" || directive === "O") directive = source[++index];
      if (directive && Object.hasOwn(compoundFormats, directive)) { consume(compoundFormats[directive]!); continue; }
      switch (directive) {
        case "%": if (input[position++] !== "%") throw mismatch(); break;
        case "Y": fields[0] = numeric(4, 0, 9999); break;
        case "y": shortYear = numeric(2, 0, 99); fields[0] = (shortYear <= 68 ? 2000 : 1900) + shortYear; break;
        case "C": century = numeric(2, 0, 99); break;
        case "m": hasDate = true; fields[1] = numeric(2, 1, 12) - 1; break;
        case "d": case "e": hasDate = true; fields[2] = numeric(2, 1, 31); break;
        case "H": case "k": fields[3] = numeric(2, 0, 23); break;
        case "I": case "l": fields[3] = numeric(2, 1, 12) % 12; break;
        case "M": fields[4] = numeric(2, 0, 59); break;
        case "S": fields[5] = numeric(2, 0, 60); break;
        case "s": {
          const seconds = numeric(16, 0, Number.MAX_SAFE_INTEGER);
          fields.splice(0, 8, ...gmtime(seconds)); hasDate = true; break;
        }
        case "U": case "W": week = { number: numeric(2, 0, 53), monday: directive === "W" }; break;
        case "j": ordinal = numeric(3, 1, 366) - 1; break;
        case "a": case "A": fields[6] = named(weekdays); break;
        case "b": case "B": case "h": hasDate = true; fields[1] = named(months); break;
        case "w": fields[6] = numeric(1, 0, 6); break;
        case "u": fields[6] = numeric(1, 1, 7) % 7; break;
        case "p": {
          const text = input.slice(position, position + 2).toLowerCase();
          if (text !== "am" && text !== "pm") throw mismatch();
          afternoon = text === "pm"; position += 2; break;
        }
        case "n": case "t": skipSpace(); break;
        case "z": {
          if (input[position] === "Z") { position++; zoneMinutes = 0; break; }
          if (input[position] !== "+" && input[position] !== "-") throw mismatch();
          const sign = input[position++] === "-" ? -1 : 1;
          const hours = numeric(2, 0, 23);
          if (input[position] === ":") position++;
          zoneMinutes = sign * (hours * 60 + numeric(2, 0, 59)); break;
        }
        case "Z": {
          while (position < input.length && "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz".includes(input[position]!)) { budget.step(); position++; }
          break;
        }
        default: throw mismatch();
      }
    }
  };
  consume(format);
  if (century !== undefined) fields[0] = century * 100 + (shortYear ?? 0);
  if (afternoon) fields[3]! += 12;
  if (week) {
    const janFirst = utcDate([fields[0]!, 0, 1, 0, 0, 0]).getUTCDay();
    const shift = week.monday ? 6 : 0;
    ordinal = week.number * 7 + ((fields[6]! + shift) % 7) - ((janFirst + shift) % 7);
    if ((janFirst + shift) % 7 === 0) ordinal -= 7;
  }
  if (ordinal !== undefined) {
    hasDate = true;
    const date = utcDate([fields[0]!, 0, ordinal + 1, 0, 0, 0]);
    fields[1] = date.getUTCMonth(); fields[2] = date.getUTCDate();
  }
  const date = utcDate(fields);
  if (hasDate) fields[6] = date.getUTCDay();
  fields[7] = Math.floor((utcDate([fields[0]!, fields[1]!, fields[2]!, 0, 0, 0]).getTime() - utcDate([fields[0]!, 0, 1, 0, 0, 0]).getTime()) / 86400000);
  if (zoneMinutes !== undefined) fields.splice(0, 8, ...gmtime(date.getTime() / 1000 - zoneMinutes * 60));
  const result: Json[] = fields;
  if (position < input.length) {
    if (!whitespace(input[position]!)) throw mismatch();
    result.push(input.slice(position));
  }
  return result;
}
