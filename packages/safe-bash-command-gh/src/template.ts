import { createYqQuerySession } from "safe-bash-query-engine";
type YqInput = Parameters<ReturnType<typeof createYqQuerySession>["run"]>[0];

export function selectJsonFields(
  item: Record<string, unknown>,
  requestedFields: readonly string[],
  availableFields: readonly string[]
): Record<string, unknown> {
  for (const field of requestedFields) {
    if (!availableFields.includes(field)) {
      throw new Error(
        `Unknown JSON field: "${field}"\nAvailable fields:\n  ${availableFields.join("\n  ")}`
      );
    }
  }
  const out: Record<string, unknown> = {};
  for (const field of requestedFields) {
    out[field] = item[field] ?? null;
  }
  return out;
}

export async function evaluateJqExpression(
  data: unknown,
  expression: string,
  signal: AbortSignal,
  maxOutputBytes = 32 * 1024 * 1024
): Promise<string> {
  const session = createYqQuerySession({ signal });
  session.compileOnce(expression);
  try {
    const lines: string[] = [];
    for await (const value of session.run(data as YqInput)) {
      if (typeof value === "string") {
        lines.push(value);
      } else {
        lines.push(
          await session.ownedWork.stringifyJson(value, {
            pretty: false,
            maxBytes: maxOutputBytes,
            limitName: "maxOutputBytes",
          })
        );
      }
    }
    return lines.join("\n") + (lines.length > 0 ? "\n" : "");
  } finally {
    await session.close();
  }
}

function resolvePathValue(ctx: unknown, path: string): unknown {
  const trimmed = path.trim();
  if (trimmed === "." || trimmed === "") return ctx;
  const normalized = trimmed.startsWith(".") ? trimmed.slice(1) : trimmed;
  if (!normalized) return ctx;
  const parts = normalized.split(".");
  let current: unknown = ctx;
  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    if (Array.isArray(current)) {
      const idx = Number.parseInt(part, 10);
      current = Number.isFinite(idx) ? current[idx] : undefined;
    } else if (typeof current === "object") {
      current = (current as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }
  return current;
}

function isTruthy(val: unknown): boolean {
  if (val === null || val === undefined || val === false || val === 0 || val === "") return false;
  if (Array.isArray(val)) return val.length > 0;
  if (typeof val === "object") return Object.keys(val as object).length > 0;
  return true;
}

function tokenizeTemplateExpr(expr: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let inQuotes: string | null = null;
  for (let i = 0; i < expr.length; i++) {
    const ch = expr[i]!;
    if (inQuotes) {
      if (ch === "\\" && i + 1 < expr.length) {
        const next = expr[++i]!;
        current += next === "n" ? "\n" : next === "t" ? "\t" : next;
      } else if (ch === inQuotes) {
        tokens.push(`"${current}"`);
        current = "";
        inQuotes = null;
      } else {
        current += ch;
      }
    } else if (ch === '"' || ch === "'" || ch === "`") {
      if (current) {
        tokens.push(current);
        current = "";
      }
      inQuotes = ch;
    } else if (/\s/u.test(ch)) {
      if (current) {
        tokens.push(current);
        current = "";
      }
    } else {
      current += ch;
    }
  }
  if (current) tokens.push(current);
  return tokens;
}

function evalArgToken(token: string, ctx: unknown, vars: Readonly<Record<string, unknown>>): unknown {
  if (token.startsWith('"') && token.endsWith('"')) {
    return token.slice(1, -1);
  }
  if (token === "true") return true;
  if (token === "false") return false;
  if (token === "nil" || token === "null") return null;
  if (/^-?\d+(\.\d+)?$/u.test(token)) return Number(token);
  if (token.startsWith("$")) {
    const varPath = token.slice(1);
    const dotIdx = varPath.indexOf(".");
    if (dotIdx === -1) return vars[varPath];
    const base = vars[varPath.slice(0, dotIdx)];
    return resolvePathValue(base, varPath.slice(dotIdx));
  }
  if (token === "." || token.startsWith(".")) {
    return resolvePathValue(ctx, token);
  }
  return resolvePathValue(ctx, token);
}

function evalSingleCall(
  tokens: readonly string[],
  pipedValue: unknown,
   hasPiped: boolean,
  ctx: unknown,
  vars: Readonly<Record<string, unknown>>,
  tableRows: string[][]
): unknown {
  if (tokens.length === 0) return hasPiped ? pipedValue : "";
  const head = tokens[0]!;
  const rawArgs = tokens.slice(1).map((t) => evalArgToken(t, ctx, vars));
  const args = hasPiped ? [...rawArgs, pipedValue] : rawArgs;

  switch (head) {
    case "tablerow": {
      tableRows.push(args.map((a) => (a === null || a === undefined ? "" : String(a))));
      return "";
    }
    case "tablerender": {
      if (tableRows.length === 0) return "";
      const rendered = tableRows.map((r) => r.join("\t")).join("\n") + "\n";
      tableRows.length = 0;
      return rendered;
    }
    case "pluck": {
      const key = String(args[0] ?? "");
      const arr = Array.isArray(args[1]) ? args[1] : [];
      return arr.map((item) =>
        item && typeof item === "object" ? (item as Record<string, unknown>)[key] : undefined
      );
    }
    case "join": {
      const sep = String(args[0] ?? ", ");
      const arr = Array.isArray(args[1]) ? args[1] : [];
      return arr.map((x) => (x === null || x === undefined ? "" : String(x))).join(sep);
    }
    case "upper":
      return String(args[0] ?? "").toUpperCase();
    case "lower":
      return String(args[0] ?? "").toLowerCase();
    case "truncate": {
      const len = Number(args[0] ?? 80);
      const str = String(args[1] ?? "");
      return str.length > len ? str.slice(0, Math.max(0, len - 3)) + "..." : str;
    }
    case "timeago":
    case "timefmt":
      return String(args[args.length - 1] ?? "");
    case "color":
    case "autocolor":
      return String(args[args.length - 1] ?? "");
    case "hyperlink":
      return String(args[1] ?? args[0] ?? "");
    case "json":
      return JSON.stringify(args[0] ?? ctx);
    case "len":
    case "length": {
      const v = args[0];
      if (Array.isArray(v) || typeof v === "string") return v.length;
      if (v && typeof v === "object") return Object.keys(v as object).length;
      return 0;
    }
    case "eq":
      return args[0] === args[1];
    case "ne":
      return args[0] !== args[1];
    case "not":
      return !isTruthy(args[0]);
    default: {
      if (tokens.length === 1) {
        return evalArgToken(head, ctx, vars);
      }
      return args.map((a) => (a === null || a === undefined ? "" : String(a))).join(" ");
    }
  }
}

function evaluatePipeline(
  expr: string,
  ctx: unknown,
  vars: Readonly<Record<string, unknown>>,
  tableRows: string[][]
): unknown {
  const stages = expr.split("|").map((s) => s.trim());
  let current: unknown = undefined;
  let hasPiped = false;
  for (const stage of stages) {
    const tokens = tokenizeTemplateExpr(stage);
    current = evalSingleCall(tokens, current, hasPiped, ctx, vars, tableRows);
    hasPiped = true;
  }
  return current;
}

function findMatchingEnd(template: string, startIndex: number): {
  readonly elseIndex: number;
  readonly endIndex: number;
  readonly endCloseIndex: number;
} {
  let depth = 1;
  let elseIndex = -1;
  let cursor = startIndex;
  while (cursor < template.length) {
    const open = template.indexOf("{{", cursor);
    if (open === -1) break;
    const close = template.indexOf("}}", open + 2);
    if (close === -1) break;
    const rawTag = template
      .slice(open + 2, close)
      .replace(/^-|-$/gu, "")
      .trim();
    if (rawTag.startsWith("range ") || rawTag.startsWith("if ") || rawTag.startsWith("with ")) {
      depth++;
    } else if (rawTag === "else" && depth === 1 && elseIndex === -1) {
      elseIndex = open;
    } else if (rawTag === "end") {
      depth--;
      if (depth === 0) {
        return { elseIndex, endIndex: open, endCloseIndex: close + 2 };
      }
    }
    cursor = close + 2;
  }
  return { elseIndex: -1, endIndex: template.length, endCloseIndex: template.length };
}

function renderTemplateBlock(
  template: string,
  ctx: unknown,
  vars: Record<string, unknown>,
  tableRows: string[][]
): string {
  let output = "";
  let i = 0;
  while (i < template.length) {
    const open = template.indexOf("{{", i);
    if (open === -1) {
      output += template.slice(i);
      break;
    }
    let prefix = template.slice(i, open);
    const trimLeft = template.slice(open + 2, open + 3) === "-";
    if (trimLeft) prefix = prefix.replace(/\s+$/u, "");
    output += prefix;

    const close = template.indexOf("}}", open + 2);
    if (close === -1) {
      output += template.slice(open);
      break;
    }
    const trimRight = template.slice(close - 1, close) === "-";
    const rawInner = template
      .slice(open + 2 + (trimLeft ? 1 : 0), close - (trimRight ? 1 : 0))
      .trim();

    let nextIdx = close + 2;
    if (trimRight) {
      while (nextIdx < template.length && /\s/u.test(template[nextIdx]!)) nextIdx++;
    }

    if (rawInner.startsWith("range ")) {
      const matched = findMatchingEnd(template, nextIdx);
      const bodySlice =
        matched.elseIndex !== -1
          ? template.slice(nextIdx, matched.elseIndex)
          : template.slice(nextIdx, matched.endIndex);
      const elseSlice =
        matched.elseIndex !== -1
          ? template.slice(template.indexOf("}}", matched.elseIndex) + 2, matched.endIndex)
          : "";

      const rangeExpr = rawInner.slice("range ".length).trim();
      let valVar: string | undefined;
      let idxVar: string | undefined;
      let targetExpr = rangeExpr;
      const assignIdx = rangeExpr.indexOf(":=");
      if (assignIdx !== -1) {
        const lhs = rangeExpr
          .slice(0, assignIdx)
          .split(",")
          .map((s) => s.trim().replace(/^\$/u, ""));
        if (lhs.length === 2) {
          idxVar = lhs[0];
          valVar = lhs[1];
        } else if (lhs.length === 1) {
          valVar = lhs[0];
        }
        targetExpr = rangeExpr.slice(assignIdx + 2).trim();
      }
      const listVal = evaluatePipeline(targetExpr, ctx, vars, tableRows);
      if (Array.isArray(listVal) && listVal.length > 0) {
        for (let idx = 0; idx < listVal.length; idx++) {
          const item = listVal[idx];
          const childVars = { ...vars };
          if (idxVar) childVars[idxVar] = idx;
          if (valVar) childVars[valVar] = item;
          output += renderTemplateBlock(bodySlice, item, childVars, tableRows);
        }
      } else if (elseSlice) {
        output += renderTemplateBlock(elseSlice, ctx, vars, tableRows);
      }
      i = matched.endCloseIndex;
      continue;
    }

    if (rawInner.startsWith("if ") || rawInner.startsWith("with ")) {
      const isWith = rawInner.startsWith("with ");
      const condExpr = rawInner.slice(isWith ? 5 : 3).trim();
      const matched = findMatchingEnd(template, nextIdx);
      const bodySlice =
        matched.elseIndex !== -1
          ? template.slice(nextIdx, matched.elseIndex)
          : template.slice(nextIdx, matched.endIndex);
      const elseSlice =
        matched.elseIndex !== -1
          ? template.slice(template.indexOf("}}", matched.elseIndex) + 2, matched.endIndex)
          : "";
      const condVal = evaluatePipeline(condExpr, ctx, vars, tableRows);
      if (isTruthy(condVal)) {
        output += renderTemplateBlock(bodySlice, isWith ? condVal : ctx, vars, tableRows);
      } else if (elseSlice) {
        output += renderTemplateBlock(elseSlice, ctx, vars, tableRows);
      }
      i = matched.endCloseIndex;
      continue;
    }

    const value = evaluatePipeline(rawInner, ctx, vars, tableRows);
    if (value !== undefined && value !== null) {
      output += typeof value === "object" ? JSON.stringify(value) : String(value);
    }
    i = nextIdx;
  }
  return output;
}

export function evaluateGoTemplate(data: unknown, templateSource: string): string {
  const unescaped = templateSource
    .replace(/\\n/gu, "\n")
    .replace(/\\t/gu, "\t");
  const tableRows: string[][] = [];
  let result = renderTemplateBlock(unescaped, data, {}, tableRows);
  if (tableRows.length > 0) {
    result += tableRows.map((r) => r.join("\t")).join("\n") + "\n";
  }
  return result;
}

export async function formatCommandOutput(options: {
  readonly data: unknown;
  readonly availableFields?: readonly string[] | undefined;
  readonly jsonFlag?: string | undefined;
  readonly jqFlag?: string | undefined;
  readonly templateFlag?: string | undefined;
  readonly signal: AbortSignal;
  readonly maxOutputBytes?: number | undefined;
}): Promise<string | undefined> {
  const { data, availableFields, jsonFlag, jqFlag, templateFlag, signal, maxOutputBytes } = options;
  if (jsonFlag === undefined && jqFlag === undefined && templateFlag === undefined) {
    return undefined;
  }

  let projected: unknown = data;
  if (jsonFlag !== undefined) {
    const fields = jsonFlag
      .split(",")
      .map((f) => f.trim())
      .filter((f) => f.length > 0);
    if (availableFields) {
      if (Array.isArray(data)) {
        projected = data.map((item) =>
          selectJsonFields(item as Record<string, unknown>, fields, availableFields)
        );
      } else if (data && typeof data === "object") {
        projected = selectJsonFields(data as Record<string, unknown>, fields, availableFields);
      }
    }
  }

  if (jqFlag !== undefined) {
    return evaluateJqExpression(projected, jqFlag, signal, maxOutputBytes);
  }
  if (templateFlag !== undefined) {
    const out = evaluateGoTemplate(projected, templateFlag);
    return out.endsWith("\n") ? out : `${out}\n`;
  }
  return `${JSON.stringify(projected, null, 2)}\n`;
}
