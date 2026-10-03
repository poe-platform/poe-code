import { parseAllDocuments } from "yaml";
import { languageFor, type Language, type Pattern } from "@poe-code/ts-ast";
export interface SearchRule {
  id?: string;
  language?: Language;
  rule: Pattern;
  fix?: string;
  message?: string;
  severity?: string;
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("expected a rule object");
  return value as Record<string, unknown>;
}
function pattern(value: unknown, depth = 0): Pattern {
  if (depth > 64) throw new Error("rule nesting limit exceeded");
  if (typeof value === "string") return value;
  const rule = object(value);
  if (!Object.keys(rule).length) throw new Error("empty rule");
  for (const [key, v] of Object.entries(rule)) {
    if (["pattern", "kind", "regex"].includes(key)) {
      if (typeof v !== "string") throw new Error(`invalid ${key}`);
    } else if (["all", "any"].includes(key)) {
      if (!Array.isArray(v) || !v.length) throw new Error(`invalid ${key}`);
      v.forEach((p) => pattern(p, depth + 1));
    } else if (["not", "inside", "has", "follows", "precedes"].includes(key)) pattern(v, depth + 1);
    else throw new Error(`unsupported rule field: ${key}`);
  }
  return rule as Pattern;
}
export function parseRules(source: string): SearchRule[] {
  return parseAllDocuments(source).flatMap((doc) => {
    if (doc.errors.length) throw new Error(doc.errors[0]!.message);
    const data: unknown = doc.toJS({ maxAliasCount: 50 });
    return (Array.isArray(data) ? data : [data]).map((value) => {
      const row = object(value);
      for (const key of Object.keys(row))
        if (!["id", "language", "rule", "fix", "message", "severity", "note"].includes(key))
          throw new Error(`unsupported rule field: ${key}`);
      if (typeof row.id !== "string" || typeof row.language !== "string")
        throw new Error("rules require id and language");
      const result: SearchRule = {
        id: row.id,
        language: languageFor(row.language.toLowerCase()),
        rule: pattern(row.rule)
      };
      for (const key of ["fix", "message", "severity"] as const)
        if (row[key] !== undefined) {
          if (typeof row[key] !== "string") throw new Error(`invalid ${key}`);
          result[key] = row[key];
        }
      return result;
    });
  });
}
