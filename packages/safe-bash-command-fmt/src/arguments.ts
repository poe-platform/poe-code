import { FmtError, defaultFmtLimits, fmtBaseline, validateFmtLimits, validateFmtProfile, type FmtOptions, type FmtLimits, type FmtProfile } from './contracts.js';
import { ownedBytes } from './bytes.js';
import { quote } from './quoting.js';
export interface FmtArgumentOptions { readonly limits?: FmtLimits; readonly profile?: FmtProfile; readonly posixlyCorrect?: boolean; readonly unicodeQuotes?: boolean }
type Settings = { -readonly [Key in keyof FmtOptions]: FmtOptions[Key] } & { files: { name: string; bytes: Uint8Array }[] };
function optionError(message: string): never { throw new FmtError('OPTION', message, true); }

function widthValue(text: string, maximum: number, unicode: boolean, profile: FmtProfile, goal = false): number {
  let offset = 0;
  while (text.charCodeAt(offset) === 32 || text.charCodeAt(offset) >= 9 && text.charCodeAt(offset) <= 13) offset++;
  if (text[offset] === "+") offset++;
  const start = offset;
  let number = 0;
  while (text.charCodeAt(offset) >= 48 && text.charCodeAt(offset) <= 57) {
    number = Math.min(1073741824, number * 10 + text.charCodeAt(offset++) - 48);
  }
  if (offset === start || offset !== text.length || number > maximum) {
    const range = offset === text.length && offset !== start && number > maximum;
    const overflow = profile === 'gnu-coreutils-8.30-C-bytes' ? number > 1073741823 : goal;
    throw new FmtError("WIDTH", `invalid width: ${quote(Uint8Array.from(text, unit => unit.charCodeAt(0)), false, unicode)}${range ? overflow ? ": Value too large for defined data type" : ": Numerical result out of range" : ""}`);
  }
  return number;
}

export function parseFmtArguments(input: readonly Uint8Array[], configuration: FmtArgumentOptions = {}): FmtOptions {
  const limits = configuration.limits ?? defaultFmtLimits;
  validateFmtLimits(limits);
  const profile = configuration.profile ?? fmtBaseline.profile;
  validateFmtProfile(profile);
  if (input.length > 4096) throw new FmtError("LIMIT", "argument count limit exceeded");
  let size = 0;
  const bytes = input.map(value => {
    const copy = ownedBytes(value, limits.argumentBytes - size); size += copy.length; return copy;
  });
  const names = bytes.map(value => new TextDecoder("utf-8", { ignoreBOM: true }).decode(value));
  const args = bytes.map(value => Array.from(value, byte => String.fromCharCode(byte)).join(""));
  const settings: Settings = { profile, width: 75, goal: 70, crown: false, tagged: false, split: false, uniform: false, prefix: new Uint8Array(), leading: 0, fullPrefix: 0, files: [] };
  let width: string | undefined;
  let goal: string | undefined;
  let stopped = false;
  const long: Readonly<Record<string, string>> = { "crown-margin": "c", prefix: "p", "split-only": "s", "tagged-paragraph": "t", "uniform-spacing": "u", width: "w", goal: "g", help: "help", version: "version" };
  let index = 0;
  const first = args[0];
  if (first?.startsWith("-") && first.charCodeAt(1) >= 48 && first.charCodeAt(1) <= 57) { width = first.slice(1); index++; }
  for (; index < args.length; index++) {
    const argument = args[index]!;
    if (stopped || !argument.startsWith("-") || argument === "-") {
      settings.files.push({ name: names[index]!, bytes: bytes[index]! });
      if (configuration.posixlyCorrect === true) stopped = true;
      continue;
    }
    if (argument === "--") { stopped = true; continue; }
    const expanded: { key: string; value?: string; position: number; valueOffset: number }[] = [];
    if (argument.startsWith("--")) {
      const equals = argument.indexOf("=");
      const name = argument.slice(2, equals < 0 ? undefined : equals);
      const matches = Object.keys(long).filter(key => key.startsWith(name));
      const selected = Object.hasOwn(long, name) ? name : matches.length === 1 ? matches[0] : undefined;
      if (!selected) {
        if (matches.length > 1) optionError(`option '${argument}' is ambiguous; possibilities: ${matches.map(key => `'--${key}'`).join(" ")}`);
        optionError(`unrecognized option '${argument}'`);
      }
      const key = long[selected]!;
      let value: string | undefined;
      let position = index;
      if ("pwg".includes(key)) {
        value = equals < 0 ? args[++index] : argument.slice(equals + 1);
        position = index;
        if (value === undefined) optionError(`option '--${selected}' requires an argument`);
      } else if (equals >= 0) optionError(`option '--${selected}' doesn't allow an argument`);
      expanded.push({ key, ...(value === undefined ? {} : { value }), position, valueOffset: equals < 0 ? 0 : equals + 1 });
    } else {
      for (let offset = 1; offset < argument.length; offset++) {
        const key = argument[offset]!;
        if (key >= "0" && key <= "9") optionError(`invalid option -- ${key}; -WIDTH is recognized only when it is the first\noption; use -w N instead`);
        if (!"cstuwpg".includes(key)) optionError(`invalid option -- '${key}'`);
        let value: string | undefined;
        let valueOffset = 0;
        if ("pwg".includes(key)) {
          if (offset + 1 < argument.length) valueOffset = offset + 1;
          value = argument.slice(offset + 1) || args[++index];
          if (value === undefined) optionError(`option requires an argument -- '${key}'`);
          offset = argument.length;
        }
        expanded.push({ key, ...(value === undefined ? {} : { value }), position: index, valueOffset });
      }
    }
    for (const option of expanded) {
      switch (option.key) {
        case "c": settings.crown = true; break;
        case "t": settings.tagged = true; break;
        case "s": settings.split = true; break;
        case "u": settings.uniform = true; break;
        case "w": width = option.value!; break;
        case "g": goal = option.value!; break;
        case "help": case "version": settings.information = option.key; return settings;
        case "p": {
          const prefixBytes = bytes[option.position]!.subarray(option.valueOffset);
          let start = 0;
          let end = prefixBytes.indexOf(0);
          if (end < 0) end = prefixBytes.length;
          while (start < end && prefixBytes[start] === 32) start++;
          settings.leading = start;
          settings.fullPrefix = end - start;
          while (end > start && prefixBytes[end - 1] === 32) end--;
          settings.prefix = new Uint8Array(prefixBytes.subarray(start, end));
          break;
        }
      }
    }
  }
  const unicode = configuration.unicodeQuotes ?? false;
  if (width !== undefined) settings.width = widthValue(width, 2500, unicode, profile);
  if (goal !== undefined) {
    settings.goal = widthValue(goal, settings.width, unicode, profile, true);
    if (width === undefined) settings.width = settings.goal + 10;
  } else settings.goal = Math.trunc(settings.width * 187 / 200);
  if (!settings.files.length) settings.files.push({ name: "-", bytes: Uint8Array.of(45) });
  return settings;
}
