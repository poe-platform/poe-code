import { UsageError, type WalkBudget } from "./io.js";

export type Charset = "ASCII" | "UTF-8";

export function explicitCharset(value: string): Charset {
  const normalized = value.toUpperCase();
  if (normalized === "UTF-8" || normalized === "UTF8") return "UTF-8";
  if (normalized === "ASCII" || normalized === "US-ASCII") return "ASCII";
  throw new UsageError("supported charsets: ASCII, US-ASCII, UTF-8, UTF8");
}

export function environmentCharset(budget: WalkBudget, branches = true): Charset {
  const { env } = budget.context;
  const ownValue = (name: string): string | undefined => {
    if (!Object.hasOwn(env, name)) return undefined;
    const value = env[name];
    if (value === undefined) return undefined;
    budget.check(value.length, budget.limits.maxPathBytes, "path/name");
    budget.step(value.length + 1);
    budget.text(value);
    return value;
  };
  const configured = branches ? ownValue("TREE_CHARSET") : undefined;
  if (configured !== undefined) {
    const normalized = configured.toUpperCase();
    return normalized === "UTF-8" || normalized === "UTF8" ? "UTF-8" : "ASCII";
  }
  for (const name of ["LC_ALL", "LC_CTYPE", "LANG"]) {
    const locale = ownValue(name);
    if (locale) {
      const modifier = locale.indexOf("@");
      const name = modifier < 0 ? locale : locale.slice(0, modifier);
      const encoding = name.slice(name.indexOf(".") + 1).toUpperCase();
      return encoding === "UTF-8" || encoding === "UTF8" ? "UTF-8" : "ASCII";
    }
  }
  return "ASCII";
}
