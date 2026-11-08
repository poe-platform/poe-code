export interface FlagSchema {
  readonly short?: string | undefined;
  readonly long: string;
  readonly type: "boolean" | "string" | "string[]";
}

export interface ParsedArgs {
  readonly positionals: string[];
  readonly passthrough: string[];
  readonly flags: Map<string, boolean | string | string[]>;
  readonly help: boolean;
  readonly repoFlag: string | undefined;
}

export function parseCommandArgs(
  rawArgs: readonly string[],
  schemas: readonly FlagSchema[] = []
): ParsedArgs {
  const byLong = new Map<string, FlagSchema>();
  const byShort = new Map<string, FlagSchema>();
  const globalSchemas: FlagSchema[] = [
    { short: "R", long: "repo", type: "string" },
    { short: "h", long: "help", type: "boolean" },
    { long: "json", type: "string" },
    { short: "q", long: "jq", type: "string" },
    { short: "t", long: "template", type: "string" },
    { short: "w", long: "web", type: "boolean" },
    { short: "y", long: "yes", type: "boolean" },
  ];

  for (const s of [...globalSchemas, ...schemas]) {
    byLong.set(s.long, s);
    if (s.short) byShort.set(s.short, s);
  }

  const positionals: string[] = [];
  const passthrough: string[] = [];
  const flags = new Map<string, boolean | string | string[]>();

  const recordValue = (schema: FlagSchema, value: string | boolean) => {
    if (schema.type === "boolean") {
      flags.set(schema.long, Boolean(value));
      return;
    }
    const strVal = String(value);
    if (schema.type === "string[]") {
      const existing = flags.get(schema.long);
      if (Array.isArray(existing)) {
        existing.push(strVal);
      } else {
        flags.set(schema.long, [strVal]);
      }
    } else {
      flags.set(schema.long, strVal);
    }
  };

  let i = 0;
  while (i < rawArgs.length) {
    const token = rawArgs[i]!;
    if (token === "--") {
      passthrough.push(...rawArgs.slice(i + 1));
      break;
    }
    if (token.startsWith("--") && token.length > 2) {
      const eqIdx = token.indexOf("=");
      if (eqIdx !== -1) {
        const name = token.slice(2, eqIdx);
        const val = token.slice(eqIdx + 1);
        const schema = byLong.get(name) ?? { long: name, type: "string" };
        if (schema.type === "boolean") {
          recordValue(schema, val !== "false" && val !== "0");
        } else {
          recordValue(schema, val);
        }
        i++;
        continue;
      }
      const name = token.slice(2);
      if (name.startsWith("no-") && !byLong.has(name) && byLong.has(name.slice(3))) {
        const target = byLong.get(name.slice(3))!;
        recordValue(target, false);
        i++;
        continue;
      }
      const schema = byLong.get(name);
      if (!schema) {
        const next = rawArgs[i + 1];
        if (next !== undefined && !next.startsWith("-")) {
          recordValue({ long: name, type: "string" }, next);
          i += 2;
        } else {
          recordValue({ long: name, type: "boolean" }, true);
          i++;
        }
        continue;
      }
      if (schema.type === "boolean") {
        recordValue(schema, true);
        i++;
      } else {
        const next = rawArgs[i + 1];
        if (next === undefined) {
          throw new Error(`flag needs an argument: --${name}`);
        }
        recordValue(schema, next);
        i += 2;
      }
      continue;
    }

    if (token.startsWith("-") && token !== "-" && token.length > 1) {
      const eqIdx = token.indexOf("=");
      if (eqIdx === 2) {
        const shortName = token[1]!;
        const val = token.slice(3);
        const schema = byShort.get(shortName) ?? { long: shortName, type: "string" };
        recordValue(schema, val);
        i++;
        continue;
      }
      const chars = token.slice(1);
      let consumedNext = false;
      for (let cIdx = 0; cIdx < chars.length; cIdx++) {
        const ch = chars[cIdx]!;
        const schema = byShort.get(ch);
        if (!schema) {
          if (chars.length === 1 && rawArgs[i + 1] !== undefined && !rawArgs[i + 1]!.startsWith("-")) {
            recordValue({ long: ch, type: "string" }, rawArgs[i + 1]!);
            consumedNext = true;
            break;
          }
          recordValue({ long: ch, type: "boolean" }, true);
          continue;
        }
        if (schema.type === "boolean") {
          recordValue(schema, true);
        } else {
          const rest = chars.slice(cIdx + 1);
          if (rest.length > 0) {
            recordValue(schema, rest);
            break;
          }
          const next = rawArgs[i + 1];
          if (next === undefined) {
            throw new Error(`flag needs an argument: -${ch} in -${chars}`);
          }
          recordValue(schema, next);
          consumedNext = true;
          break;
        }
      }
      i += consumedNext ? 2 : 1;
      continue;
    }

    positionals.push(token);
    i++;
  }

  return {
    positionals,
    passthrough,
    flags,
    help: flags.get("help") === true,
    repoFlag: typeof flags.get("repo") === "string" ? (flags.get("repo") as string) : undefined,
  };
}

export function getStringFlag(parsed: ParsedArgs, name: string): string | undefined {
  const val = parsed.flags.get(name);
  if (typeof val === "string") return val;
  if (Array.isArray(val) && val.length > 0) return val[val.length - 1];
  return undefined;
}

export function getStringArrayFlag(parsed: ParsedArgs, name: string): string[] {
  const val = parsed.flags.get(name);
  if (val === undefined) return [];
  const rawList = Array.isArray(val) ? val : typeof val === "string" ? [val] : [];
  const out: string[] = [];
  for (const item of rawList) {
    for (const part of item.split(",")) {
      const trimmed = part.trim();
      if (trimmed.length > 0) out.push(trimmed);
    }
  }
  return out;
}

export function getRawStringArrayFlag(parsed: ParsedArgs, name: string): string[] {
  const val = parsed.flags.get(name);
  if (val === undefined) return [];
  if (Array.isArray(val)) return [...val];
  if (typeof val === "string") return [val];
  return [];
}

export function getBoolFlag(parsed: ParsedArgs, name: string, defaultValue = false): boolean {
  const val = parsed.flags.get(name);
  if (typeof val === "boolean") return val;
  if (typeof val === "string") return val !== "false" && val !== "0";
  return defaultValue;
}

export function getIntFlag(parsed: ParsedArgs, name: string, defaultValue: number): number {
  const val = getStringFlag(parsed, name);
  if (val === undefined) return defaultValue;
  const n = Number.parseInt(val, 10);
  if (!Number.isFinite(n) || n < 0) {
    throw new Error(`invalid value "${val}" for flag --${name}: expected non-negative integer`);
  }
  return n;
}
