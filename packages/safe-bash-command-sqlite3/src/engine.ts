import { yieldTurn } from "safe-bash-contracts/yield";
import { runSynchronously, runCooperatively, stepMap, stepFlatMap, stepFilter, stepSort, stepReduce, type SqlSteps, type StepResult } from "./execution.js";
import {
  type SqlValue,
  type StoredTableMeta,
  readSqliteDatabaseBytes,
  writeSqliteDatabaseBytes
} from "./btree.js";

export function serializeSqlJson(value: unknown, preserveRealType = true): string {
  if (value instanceof JsonText && preserveRealType) return value.valueOf();
  if (value instanceof String) return JSON.stringify(value.valueOf());
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Number) {
    const number = value.valueOf();
    if (!Number.isFinite(number)) return "null";
    const text = String(number);
    return preserveRealType && Number.isInteger(number) && !text.includes("e") ? `${text}.0` : text;
  }
  if (Array.isArray(value)) return `[${value.map((item) => serializeSqlJson(item, preserveRealType)).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value).map(([key, item]) => `${JSON.stringify(key)}:${serializeSqlJson(item, preserveRealType)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export type { SqlValue };

export class JsonText extends String {}

export interface QueryResultSet {
  columns: string[];
  rows: SqlValue[][];
}

export interface ColumnDef {
  name: string;
  type: string;
  notNull: boolean;
  primaryKey: boolean;
  autoIncrement: boolean;
  unique: boolean;
  defaultExpr?: string | undefined;
  checkExpr?: string | undefined;
  collate?: string | undefined;
  generatedExpr?: string | undefined;
}

export interface IndexDef {
  name: string;
  tableName: string;
  unique: boolean;
  columns: string[];
  collations?: string[];
  sql: string;
}

export interface ViewDef {
  name: string;
  columns?: string[] | undefined;
  selectSql: string;
  sql: string;
}

export interface TriggerDef {
  name: string;
  timing: "BEFORE" | "AFTER" | "INSTEAD OF";
  event: "INSERT" | "UPDATE" | "DELETE";
  tableName: string;
  whenExpr?: string | undefined;
  bodySql: string;
  sql: string;
}

export interface TableRow {
  rowid: number;
  data: Record<string, SqlValue>;
}

interface ForeignKeyDef {
  columns: string[];
  table: string;
  target: string[];
  onDelete: string;
  onUpdate: string;
}

export interface TableDef {
  name: string;
  sql: string;
  columns: ColumnDef[];
  rows: TableRow[];
  nextRowId: number;
  maxAutoInc: number;
  withoutRowId: boolean;
  strict: boolean;
  primaryKeyCols: string[];
  primaryKeyOrder?: { desc: boolean; collation: string | undefined }[] | undefined;
  uniqueColSets: string[][];
  fts5?: boolean | undefined;
  foreignKeys?: ForeignKeyDef[] | undefined;
}

// This bounded subset follows unicode61 for ASCII input. Reject other input
// instead of silently approximating Unicode categories or FTS query operators.
function* ftsTokens(text: string, query: boolean): SqlSteps<string[]> {
  const words: string[] = [];
  let word = "";
  for (const char of text + " ") {
    yield;
    const code = char.charCodeAt(0);
    const letter = code >= 65 && code <= 90 || code >= 97 && code <= 122;
    const digit = code >= 48 && code <= 57;
    if (code > 127 || query && !letter && !digit && !" \t\r\n".includes(char)) {
      throw new Error("unsupported FTS5 input: only ASCII text and bare alphanumeric query terms are supported");
    }
    if (letter || digit) word += char;
    else if (word) {
      if (query && ["AND", "OR", "NOT", "NEAR"].includes(word)) throw new Error("unsupported FTS5 query operator");
      words.push(word.toLowerCase());
      word = "";
    }
  }
  if (query && !words.length) throw new Error("unsupported FTS5 empty query");
  return words;
}

function tableStorageColumns(table: TableDef): ColumnDef[] {
  if (!table.withoutRowId) return table.columns;
  const keys = table.primaryKeyCols.map((name) => name.toLowerCase());
  return [
    ...keys.map((name) => table.columns.find((column) => column.name.toLowerCase() === name)!),
    ...table.columns.filter((column) => !keys.includes(column.name.toLowerCase()))
  ];
}

interface SnapshotState {
  tables: Map<string, TableDef>;
  indexes: Map<string, IndexDef>;
  views: Map<string, ViewDef>;
  triggers: Map<string, TriggerDef>;
  userVersion: number;
  applicationId: number;
  schemaCookie: number;
}

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder("utf-8", { fatal: false });

class SqliteConstraintError extends Error {}

function cloneSqlValue(v: SqlValue): SqlValue {
  if (v instanceof Uint8Array) {
    return new Uint8Array(v);
  }
  if (v instanceof Number) {
    return new Number(v.valueOf());
  }
  return v;
}

function cloneTableDef(t: TableDef): TableDef {
  return {
    fts5: t.fts5,
    foreignKeys: t.foreignKeys?.map(key => ({ ...key, columns: [...key.columns], target: [...key.target] })),
    name: t.name,
    sql: t.sql,
    columns: t.columns.map((c) => ({ ...c })),
    rows: t.rows.map((r) => {
      const data: Record<string, SqlValue> = {};
      for (const [k, v] of Object.entries(r.data)) {
        data[k] = cloneSqlValue(v);
      }
      return { rowid: r.rowid, data };
    }),
    nextRowId: t.nextRowId,
    maxAutoInc: t.maxAutoInc,
    withoutRowId: t.withoutRowId,
    strict: t.strict,
    primaryKeyCols: [...t.primaryKeyCols],
    primaryKeyOrder: t.primaryKeyOrder?.map((key) => ({ ...key })),
    uniqueColSets: t.uniqueColSets.map((u) => [...u])
  };
}

// --- SQL Tokenizer ---
export interface Token {
  type: "word" | "string" | "ident" | "number" | "blob" | "op" | "punct" | "param";
  value: string;
  raw: string;
}

export function splitSqlStatements(sql: string): string[] {
  const statements: string[] = [];
  let start = 0;
  let i = 0;
  let inTriggerBegin = 0;
  let afterCreateTrigger = false;

  while (i < sql.length) {
    const ch = sql[i]!;
    if (ch === "-" && sql[i + 1] === "-") {
      i += 2;
      while (i < sql.length && sql[i] !== "\n") {
        i += 1;
      }
      continue;
    }
    if (ch === "/" && sql[i + 1] === "*") {
      i += 2;
      while (i < sql.length && !(sql[i] === "*" && sql[i + 1] === "/")) {
        i += 1;
      }
      i += 2;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") {
      const quote = ch;
      i += 1;
      while (i < sql.length) {
        if (sql[i] === quote) {
          if (sql[i + 1] === quote) {
            i += 2;
            continue;
          }
          i += 1;
          break;
        }
        i += 1;
      }
      continue;
    }
    if (ch === "[") {
      i += 1;
      while (i < sql.length && sql[i] !== "]") {
        i += 1;
      }
      i += 1;
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      let j = i;
      while (j < sql.length && /[A-Za-z0-9_$]/.test(sql[j]!)) {
        j += 1;
      }
      const word = sql.slice(i, j).toUpperCase();
      if (word === "TRIGGER") {
        afterCreateTrigger = true;
      } else if (afterCreateTrigger && word === "BEGIN") {
        inTriggerBegin += 1;
      } else if (inTriggerBegin > 0 && word === "CASE") {
        inTriggerBegin += 1;
      } else if (inTriggerBegin > 0 && word === "END") {
        inTriggerBegin -= 1;
        if (inTriggerBegin === 0) {
          afterCreateTrigger = false;
        }
      }
      i = j;
      continue;
    }
    if (ch === ";" && inTriggerBegin === 0) {
      const stmt = sql.slice(start, i).trim();
      if (stmt.length > 0) {
        statements.push(stmt);
      }
      start = i + 1;
      afterCreateTrigger = false;
    }
    i += 1;
  }
  const tail = sql.slice(start).trim();
  if (tail.length > 0) {
    statements.push(tail);
  }
  return statements;
}

export function tokenizeSql(sql: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < sql.length) {
    const ch = sql[i]!;
    if (/\s/.test(ch)) {
      i += 1;
      continue;
    }
    if (ch === "-" && sql[i + 1] === "-") {
      i += 2;
      while (i < sql.length && sql[i] !== "\n") {
        i += 1;
      }
      continue;
    }
    if (ch === "/" && sql[i + 1] === "*") {
      i += 2;
      while (i < sql.length && !(sql[i] === "*" && sql[i + 1] === "/")) {
        i += 1;
      }
      i += 2;
      continue;
    }
    if ((ch === "x" || ch === "X") && sql[i + 1] === "'") {
      let j = i + 2;
      while (j < sql.length && sql[j] !== "'") {
        j += 1;
      }
      const hex = sql.slice(i + 2, j);
      tokens.push({ type: "blob", value: hex, raw: sql.slice(i, j + 1) });
      i = j + 1;
      continue;
    }
    if (ch === "'") {
      let j = i + 1;
      let val = "";
      while (j < sql.length) {
        if (sql[j] === "'") {
          if (sql[j + 1] === "'") {
            val += "'";
            j += 2;
            continue;
          }
          break;
        }
        val += sql[j]!;
        j += 1;
      }
      tokens.push({ type: "string", value: val, raw: sql.slice(i, j + 1) });
      i = j + 1;
      continue;
    }
    if (ch === '"' || ch === "`") {
      const q = ch;
      let j = i + 1;
      let val = "";
      while (j < sql.length) {
        if (sql[j] === q) {
          if (sql[j + 1] === q) {
            val += q;
            j += 2;
            continue;
          }
          break;
        }
        val += sql[j]!;
        j += 1;
      }
      tokens.push({ type: "ident", value: val, raw: sql.slice(i, j + 1) });
      i = j + 1;
      continue;
    }
    if (ch === "[") {
      let j = i + 1;
      while (j < sql.length && sql[j] !== "]") {
        j += 1;
      }
      tokens.push({ type: "ident", value: sql.slice(i + 1, j), raw: sql.slice(i, j + 1) });
      i = j + 1;
      continue;
    }
    if (ch === "?" || ((ch === ":" || ch === "@" || ch === "$") && /[A-Za-z0-9_]/.test(sql[i + 1] ?? ""))) {
      let j = i + 1;
      while (j < sql.length && /[A-Za-z0-9_]/.test(sql[j]!)) {
        j += 1;
      }
      tokens.push({ type: "param", value: sql.slice(i, j), raw: sql.slice(i, j) });
      i = j;
      continue;
    }
    if (/[0-9]/.test(ch) || (ch === "." && /[0-9]/.test(sql[i + 1] ?? ""))) {
      let j = i;
      if (ch === "0" && (sql[i + 1] === "x" || sql[i + 1] === "X")) {
        j += 2;
        while (j < sql.length && /[0-9a-fA-F]/.test(sql[j]!)) {
          j += 1;
        }
      } else {
        while (j < sql.length && /[0-9]/.test(sql[j]!)) {
          j += 1;
        }
        if (sql[j] === ".") {
          j += 1;
          while (j < sql.length && /[0-9]/.test(sql[j]!)) {
            j += 1;
          }
        }
        if (sql[j] === "e" || sql[j] === "E") {
          j += 1;
          if (sql[j] === "+" || sql[j] === "-") {
            j += 1;
          }
          while (j < sql.length && /[0-9]/.test(sql[j]!)) {
            j += 1;
          }
        }
      }
      const raw = sql.slice(i, j);
      tokens.push({ type: "number", value: raw, raw });
      i = j;
      continue;
    }
    if (/[A-Za-z_\u0080-\uffff]/.test(ch)) {
      let j = i + 1;
      while (j < sql.length && /[A-Za-z0-9_$\u0080-\uffff]/.test(sql[j]!)) {
        j += 1;
      }
      const raw = sql.slice(i, j);
      tokens.push({ type: "word", value: raw, raw });
      i = j;
      continue;
    }
    const three = sql.slice(i, i + 3);
    if (three === "->>") {
      tokens.push({ type: "op", value: three, raw: three });
      i += 3;
      continue;
    }
    const two = sql.slice(i, i + 2);
    if (["||", "!=", "<>", "<=", ">=", "==", "<<", ">>", "->"].includes(two)) {
      tokens.push({ type: "op", value: two, raw: two });
      i += 2;
      continue;
    }
    if (["(", ")", ",", ";", "."].includes(ch)) {
      tokens.push({ type: "punct", value: ch, raw: ch });
      i += 1;
      continue;
    }
    tokens.push({ type: "op", value: ch, raw: ch });
    i += 1;
  }
  return tokens;
}

// --- Expression AST ---
export type ExprNode =
  | { kind: "literal"; value: SqlValue }
  | { kind: "column"; table?: string | undefined; name: string; doubleQuoted?: boolean }
  | { kind: "star"; table?: string | undefined }
  | { kind: "param"; name: string; index: number }
  | { kind: "unary"; op: string; expr: ExprNode }
  | { kind: "binary"; op: string; left: ExprNode; right: ExprNode }
  | { kind: "collate"; expr: ExprNode; collation: string }
  | { kind: "between"; expr: ExprNode; low: ExprNode; high: ExprNode; not: boolean }
  | { kind: "in_list"; expr: ExprNode; list: ExprNode[]; not: boolean }
  | { kind: "in_subquery"; expr: ExprNode; subquerySql: string; not: boolean }
  | { kind: "is_null"; expr: ExprNode; not: boolean }
  | { kind: "case"; base?: ExprNode | undefined; branches: { when: ExprNode; then: ExprNode }[]; elseExpr?: ExprNode | undefined }
  | { kind: "cast"; expr: ExprNode; targetType: string }
  | {
      kind: "func";
      name: string;
      args: ExprNode[];
      distinct?: boolean | undefined;
      star?: boolean | undefined;
      filterWhere?: ExprNode | undefined;
      over?: {
        partitionBy: ExprNode[];
        orderBy: { expr: ExprNode; desc: boolean; nulls?: "FIRST" | "LAST" | undefined | undefined }[];
        frameBounds?: { start: number; end: number } | undefined;
      } | undefined;
    }
  | { kind: "subquery"; sql: string; exists?: boolean; notExists?: boolean };

interface ExprEvaluation {
  group: Record<string, SqlValue>[];
  window?: { rowIdx: number; results: Map<ExprNode, SqlValue[]> };
}

function isAggregateFunction(expr: ExprNode): boolean {
  if (expr.kind !== "func" || expr.over) return false;
  const name = expr.name.toUpperCase();
  return ["COUNT", "SUM", "TOTAL", "AVG", "MIN", "MAX", "GROUP_CONCAT", "STRING_AGG", "JSON_GROUP_ARRAY", "JSON_GROUP_OBJECT"].includes(name)
    && !((name === "MIN" || name === "MAX") && expr.args.length > 1);
}

function expressionChildren(expr: ExprNode): ExprNode[] {
  switch (expr.kind) {
    case "unary":
    case "collate":
    case "is_null":
    case "cast":
    case "in_subquery":
      return [expr.expr];
    case "binary":
      return [expr.left, expr.right];
    case "between":
      return [expr.expr, expr.low, expr.high];
    case "in_list":
      return [expr.expr, ...expr.list];
    case "func":
      return expr.args;
    case "case":
      return [
        ...(expr.base ? [expr.base] : []),
        ...expr.branches.flatMap((branch) => [branch.when, branch.then]),
        ...(expr.elseExpr ? [expr.elseExpr] : [])
      ];
    default:
      return [];
  }
}

function reconstructTokensSql(tokens: Token[]): string {
  let out = "";
  for (let i = 0; i < tokens.length; i += 1) {
    const t = tokens[i]!;
    const prev = tokens[i - 1];
    const noSpaceBefore =
      t.value === "," ||
      t.value === ")" ||
      t.value === "." ||
      t.value === ";" ||
      prev?.value === "(" ||
      prev?.value === ".";
    if (i > 0 && !noSpaceBefore) {
      out += " ";
    }
    out += t.raw;
  }
  return out;
}

class ExprParser {
  public pos = 0;
  private paramCounter = 0;
  constructor(public tokens: Token[]) {}

  peek(offset = 0): Token | undefined {
    return this.tokens[this.pos + offset];
  }

  matchWord(word: string): boolean {
    const t = this.peek();
    if (t && t.type === "word" && t.value.toUpperCase() === word.toUpperCase()) {
      this.pos += 1;
      return true;
    }
    return false;
  }

  isWord(word: string, offset = 0): boolean {
    const t = this.peek(offset);
    return Boolean(t && t.type === "word" && t.value.toUpperCase() === word.toUpperCase());
  }

  matchValue(val: string): boolean {
    const t = this.peek();
    if (t && t.value === val) {
      this.pos += 1;
      return true;
    }
    return false;
  }

  parseExpression(): ExprNode {
    return this.parseOr();
  }

  private parseOr(): ExprNode {
    let left = this.parseAnd();
    while (this.matchWord("OR")) {
      const right = this.parseAnd();
      left = { kind: "binary", op: "OR", left, right };
    }
    return left;
  }

  private parseAnd(): ExprNode {
    let left = this.parseNot();
    while (this.matchWord("AND")) {
      const right = this.parseNot();
      left = { kind: "binary", op: "AND", left, right };
    }
    return left;
  }

  private parseNot(): ExprNode {
    if (this.matchWord("NOT")) {
      if (this.isWord("EXISTS")) {
        this.pos += 1;
        const subSql = this.consumeParenthesizedSql();
        return { kind: "subquery", sql: subSql, exists: true, notExists: true };
      }
      return { kind: "unary", op: "NOT", expr: this.parseNot() };
    }
    return this.parseComparison();
  }

  private parseComparison(): ExprNode {
    let left = this.parseBitwise();

    while (true) {
      let negated = false;
      const savePos = this.pos;
      if (this.matchWord("NOT")) {
        negated = true;
      }

      if (this.matchWord("BETWEEN")) {
        const low = this.parseBitwise();
        this.matchWord("AND");
        const high = this.parseBitwise();
        left = { kind: "between", expr: left, low, high, not: negated };
        continue;
      }

      if (this.matchWord("IN")) {
        if (this.matchValue("(")) {
          if (this.isWord("SELECT") || this.isWord("WITH") || this.isWord("VALUES")) {
            this.pos -= 1;
            const subSql = this.consumeParenthesizedSql();
            left = { kind: "in_subquery", expr: left, subquerySql: subSql, not: negated };
          } else {
            const list: ExprNode[] = [];
            if (!this.matchValue(")")) {
              do {
                list.push(this.parseExpression());
              } while (this.matchValue(","));
              this.matchValue(")");
            }
            left = { kind: "in_list", expr: left, list, not: negated };
          }
        } else {
          // IN table_name
          const tblTok = this.tokens[this.pos++];
          const tblName = tblTok?.value ?? "";
          left = { kind: "in_subquery", expr: left, subquerySql: `SELECT * FROM "${tblName}"`, not: negated };
        }
        continue;
      }

      if (this.matchWord("LIKE") || this.matchWord("GLOB") || this.matchWord("REGEXP") || this.matchWord("MATCH")) {
        const opWord = this.tokens[this.pos - 1]!.value.toUpperCase();
        let right = this.parseBitwise();
        if (this.matchWord("ESCAPE")) {
          const esc = this.parseBitwise();
          right = { kind: "func", name: "__like_escape__", args: [right, esc] };
        }
        const node: ExprNode = { kind: "binary", op: opWord, left, right };
        left = negated ? { kind: "unary", op: "NOT", expr: node } : node;
        continue;
      }

      if (negated) {
        this.pos = savePos;
      }

      if (this.matchWord("IS")) {
        const isNot = this.matchWord("NOT");
        if (this.matchWord("NULL") || this.matchWord("NULLS")) {
          left = { kind: "is_null", expr: left, not: isNot };
          continue;
        }
        if (this.matchWord("DISTINCT")) {
          this.matchWord("FROM");
          const right = this.parseBitwise();
          left = { kind: "binary", op: isNot ? "IS" : "IS NOT", left, right };
          continue;
        }
        const right = this.parseBitwise();
        left = { kind: "binary", op: isNot ? "IS NOT" : "IS", left, right };
        continue;
      }

      if (this.matchWord("ISNULL")) {
        left = { kind: "is_null", expr: left, not: false };
        continue;
      }
      if (this.matchWord("NOTNULL")) {
        left = { kind: "is_null", expr: left, not: true };
        continue;
      }

      const tok = this.peek();
      if (tok && tok.type === "op" && ["=", "==", "!=", "<>", "<", "<=", ">", ">="].includes(tok.value)) {
        this.pos += 1;
        const right = this.parseBitwise();
        left = { kind: "binary", op: tok.value, left, right };
        continue;
      }
      break;
    }

    return left;
  }

  private parseBitwise(): ExprNode {
    let left = this.parseAdditive();
    while (true) {
      const tok = this.peek();
      if (tok && tok.type === "op" && ["<<", ">>", "&", "|", "->", "->>"].includes(tok.value)) {
        this.pos += 1;
        const right = this.parseAdditive();
        left = { kind: "binary", op: tok.value, left, right };
      } else {
        break;
      }
    }
    return left;
  }

  private parseAdditive(): ExprNode {
    let left = this.parseMultiplicative();
    while (true) {
      const tok = this.peek();
      if (tok && tok.type === "op" && ["+", "-", "||"].includes(tok.value)) {
        this.pos += 1;
        const right = this.parseMultiplicative();
        left = { kind: "binary", op: tok.value, left, right };
      } else {
        break;
      }
    }
    return left;
  }

  private parseMultiplicative(): ExprNode {
    let left = this.parseUnary();
    while (true) {
      const tok = this.peek();
      if (tok && tok.type === "op" && ["*", "/", "%"].includes(tok.value)) {
        this.pos += 1;
        const right = this.parseUnary();
        left = { kind: "binary", op: tok.value, left, right };
      } else {
        break;
      }
    }
    return left;
  }

  private parseUnary(): ExprNode {
    const tok = this.peek();
    if (tok && tok.type === "op" && (tok.value === "-" || tok.value === "+" || tok.value === "~")) {
      this.pos += 1;
      return { kind: "unary", op: tok.value, expr: this.parseUnary() };
    }
    let expr = this.parsePrimary();
    while (this.matchWord("COLLATE")) {
      const colTok = this.tokens[this.pos++];
      expr = { kind: "collate", expr, collation: colTok?.value ?? "BINARY" };
    }
    return expr;
  }

  private consumeParenthesizedSql(): string {
    this.matchValue("(");
    let depth = 1;
    const inner: Token[] = [];
    while (this.pos < this.tokens.length && depth > 0) {
      const t = this.tokens[this.pos++]!;
      if (t.value === "(") {
        depth += 1;
      } else if (t.value === ")") {
        depth -= 1;
        if (depth === 0) {
          break;
        }
      }
      inner.push(t);
    }
    return reconstructTokensSql(inner);
  }

  private parsePrimary(): ExprNode {
    const tok = this.peek();
    if (!tok) {
      return { kind: "literal", value: null };
    }

    if (this.matchWord("EXISTS")) {
      const subSql = this.consumeParenthesizedSql();
      return { kind: "subquery", sql: subSql, exists: true };
    }

    if (this.matchWord("CASE")) {
      let base: ExprNode | undefined;
      if (!this.isWord("WHEN")) {
        base = this.parseExpression();
      }
      const branches: { when: ExprNode; then: ExprNode }[] = [];
      while (this.matchWord("WHEN")) {
        const when = this.parseExpression();
        this.matchWord("THEN");
        const then = this.parseExpression();
        branches.push({ when, then });
      }
      let elseExpr: ExprNode | undefined;
      if (this.matchWord("ELSE")) {
        elseExpr = this.parseExpression();
      }
      this.matchWord("END");
      return { kind: "case", base, branches, elseExpr };
    }

    if (this.matchWord("CAST")) {
      this.matchValue("(");
      const expr = this.parseExpression();
      this.matchWord("AS");
      const typeParts: string[] = [];
      while (this.pos < this.tokens.length && this.peek()?.value !== ")") {
        const t = this.tokens[this.pos++]!;
        if (t.value === "(") {
          while (this.pos < this.tokens.length && this.peek()?.value !== ")") {
            this.pos += 1;
          }
          this.matchValue(")");
        } else {
          typeParts.push(t.value);
        }
      }
      this.matchValue(")");
      return { kind: "cast", expr, targetType: typeParts.join(" ").toUpperCase() };
    }

    if (tok.value === "(") {
      if (this.isWord("SELECT", 1) || this.isWord("WITH", 1) || this.isWord("VALUES", 1)) {
        const subSql = this.consumeParenthesizedSql();
        return { kind: "subquery", sql: subSql };
      }
      this.pos += 1;
      const expr = this.parseExpression();
      this.matchValue(")");
      return expr;
    }

    if (tok.type === "number") {
      this.pos += 1;
      if (/^[+-]?\d+$/.test(tok.value)) {
        try {
          const big = BigInt(tok.value);
          if (big > BigInt(Number.MAX_SAFE_INTEGER) || big < BigInt(Number.MIN_SAFE_INTEGER)) {
            return { kind: "literal", value: big };
          }
        } catch {
          // fallback
        }
      }
      const num = tok.value.startsWith("0x") || tok.value.startsWith("0X")
        ? Number.parseInt(tok.value, 16)
        : Number(tok.value);
      const spelling = tok.value.toLowerCase();
      const real = !spelling.startsWith("0x") && (spelling.includes(".") || spelling.includes("e"));
      return { kind: "literal", value: real ? new Number(num) : num };
    }

    if (tok.type === "string") {
      this.pos += 1;
      return { kind: "literal", value: tok.value };
    }

    if (tok.type === "blob") {
      this.pos += 1;
      const hex = tok.value;
      const bytes = new Uint8Array(Math.floor(hex.length / 2));
      for (let i = 0; i < bytes.length; i += 1) {
        bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16) || 0;
      }
      return { kind: "literal", value: bytes };
    }

    if (tok.type === "param") {
      this.pos += 1;
      this.paramCounter += 1;
      return { kind: "param", name: tok.value, index: this.paramCounter };
    }

    if (tok.type === "op" && tok.value === "*") {
      this.pos += 1;
      return { kind: "star" };
    }

    if (tok.type === "word") {
      const upper = tok.value.toUpperCase();
      if (upper === "NULL") {
        this.pos += 1;
        return { kind: "literal", value: null };
      }
      if (upper === "TRUE") {
        this.pos += 1;
        return { kind: "literal", value: 1 };
      }
      if (upper === "FALSE") {
        this.pos += 1;
        return { kind: "literal", value: 0 };
      }
      if (upper === "CURRENT_TIMESTAMP") {
        this.pos += 1;
        return { kind: "func", name: "datetime", args: [{ kind: "literal", value: "now" }] };
      }
      if (upper === "CURRENT_DATE") {
        this.pos += 1;
        return { kind: "func", name: "date", args: [{ kind: "literal", value: "now" }] };
      }
      if (upper === "CURRENT_TIME") {
        this.pos += 1;
        return { kind: "func", name: "time", args: [{ kind: "literal", value: "now" }] };
      }
    }

    if (tok.type === "word" || tok.type === "ident") {
      this.pos += 1;
      const name = tok.value;

      // Function call
      if (this.peek()?.value === "(") {
        this.pos += 1;
        let distinct = false;
        let star = false;
        const args: ExprNode[] = [];
        if (this.matchValue("*")) {
          star = true;
        } else if (this.peek()?.value !== ")") {
          if (this.matchWord("DISTINCT")) {
            distinct = true;
          } else {
            this.matchWord("ALL");
          }
          do {
            args.push(this.parseExpression());
          } while (this.matchValue(","));
        }
        this.matchValue(")");

        let filterWhere: ExprNode | undefined;
        if (this.matchWord("FILTER")) {
          this.matchValue("(");
          this.matchWord("WHERE");
          filterWhere = this.parseExpression();
          this.matchValue(")");
        }

        let over:
          | {
              partitionBy: ExprNode[];
              orderBy: { expr: ExprNode; desc: boolean; nulls?: "FIRST" | "LAST" | undefined }[];
              frameBounds?: { start: number; end: number } | undefined;
            }
          | undefined;
        if (this.matchWord("OVER")) {
          const partitionBy: ExprNode[] = [];
          const orderBy: { expr: ExprNode; desc: boolean; nulls?: "FIRST" | "LAST" | undefined }[] = [];
          let frameBounds: { start: number; end: number } | undefined;
          if (this.matchValue("(")) {
            if (this.matchWord("PARTITION")) {
              this.matchWord("BY");
              do {
                partitionBy.push(this.parseExpression());
              } while (this.matchValue(","));
            }
            if (this.matchWord("ORDER")) {
              this.matchWord("BY");
              do {
                const expr = this.parseExpression();
                let desc = false;
                if (this.matchWord("DESC")) {
                  desc = true;
                } else {
                  this.matchWord("ASC");
                }
                let nulls: "FIRST" | "LAST" | undefined;
                if (this.matchWord("NULLS")) {
                  if (this.matchWord("FIRST")) {
                    nulls = "FIRST";
                  } else if (this.matchWord("LAST")) {
                    nulls = "LAST";
                  }
                }
                orderBy.push({ expr, desc, nulls });
              } while (this.matchValue(","));
            }
            if (this.matchWord("ROWS") || this.matchWord("RANGE") || this.matchWord("GROUPS")) {
              const parseBound = (): number => {
                if (this.matchWord("UNBOUNDED")) {
                  if (this.matchWord("PRECEDING")) return -Infinity;
                  this.matchWord("FOLLOWING");
                  return Infinity;
                }
                if (this.matchWord("CURRENT")) {
                  this.matchWord("ROW");
                  return 0;
                }
                const numTok = this.peek();
                const n = Number(numTok?.value ?? 0);
                if (numTok) this.pos += 1;
                if (this.matchWord("PRECEDING")) return -n;
                this.matchWord("FOLLOWING");
                return n;
              };
              if (this.matchWord("BETWEEN")) {
                const start = parseBound();
                this.matchWord("AND");
                const end = parseBound();
                frameBounds = { start, end };
              } else {
                const start = parseBound();
                frameBounds = { start, end: 0 };
              }
            }
            // Skip any remaining window specification tokens (e.g. EXCLUDE ...)
            let depth = 1;
            while (this.pos < this.tokens.length && depth > 0) {
              const t = this.peek()!;
              if (t.value === "(") {
                depth += 1;
              } else if (t.value === ")") {
                depth -= 1;
                if (depth === 0) {
                  this.pos += 1;
                  break;
                }
              }
              this.pos += 1;
            }
          } else {
            // OVER window_name
            this.pos += 1;
          }
          over = { partitionBy, orderBy, frameBounds };
        }

        return { kind: "func", name, args, distinct, star, filterWhere, over };
      }

      // Table.column or Table.*
      if (this.matchValue(".")) {
        const next = this.peek();
        if (next && next.value === "*") {
          this.pos += 1;
          return { kind: "star", table: name };
        }
        const colTok = this.tokens[this.pos++];
        if (this.matchValue(".")) {
          // schema.table.column
          const realColTok = this.tokens[this.pos++];
          return { kind: "column", table: colTok?.value ?? "", name: realColTok?.value ?? "" };
        }
        return { kind: "column", table: name, name: colTok?.value ?? "" };
      }

      return { kind: "column", name, doubleQuoted: tok.raw.startsWith('"') };
    }

    this.pos += 1;
    return { kind: "literal", value: null };
  }
}

export function parseExprSql(sql: string): ExprNode {
  const parser = new ExprParser(tokenizeSql(sql));
  return parser.parseExpression();
}

// --- Value Comparison & Coercion Helpers ---
function typeRank(v: SqlValue): number {
  if (v === null || v === undefined) {
    return 0;
  }
  if (typeof v === "number" || typeof v === "bigint" || v instanceof Number) {
    return 1;
  }
  if (typeof v === "string" || v instanceof String) {
    return 2;
  }
  return 3; // Uint8Array blob
}

export function compareSqlValues(a: SqlValue, b: SqlValue, collation = "BINARY"): number {
  const rA = typeRank(a);
  const rB = typeRank(b);
  if (rA !== rB) {
    return rA - rB;
  }
  if (rA === 0) {
    return 0;
  }
  if (rA === 1) {
    if (typeof a === "bigint" && typeof b === "bigint") {
      return a < b ? -1 : a > b ? 1 : 0;
    }
    const nA = typeof a === "bigint" ? Number(a) : a instanceof Number ? a.valueOf() : (a as number);
    const nB = typeof b === "bigint" ? Number(b) : b instanceof Number ? b.valueOf() : (b as number);
    return nA < nB ? -1 : nA > nB ? 1 : 0;
  }
  if (rA === 2) {
    let sA = String(a);
    let sB = String(b);
    const col = collation.toUpperCase();
    if (col === "RTRIM") {
      sA = sA.replace(/ +$/, "");
      sB = sB.replace(/ +$/, "");
    } else if (col === "NOCASE") {
      sA = sA.toLowerCase();
      sB = sB.toLowerCase();
    }
    return sA < sB ? -1 : sA > sB ? 1 : 0;
  }
  const uA = a as Uint8Array;
  const uB = b as Uint8Array;
  const minLen = Math.min(uA.byteLength, uB.byteLength);
  for (let i = 0; i < minLen; i += 1) {
    if (uA[i]! !== uB[i]!) {
      return uA[i]! - uB[i]!;
    }
  }
  return uA.byteLength - uB.byteLength;
}

function toSqlNumber(v: SqlValue): number {
  if (v === null || v === undefined) {
    return 0;
  }
  if (typeof v === "bigint") {
    return Number(v);
  }
  if (v instanceof Number) {
    return v.valueOf();
  }
  if (typeof v === "number") {
    return v;
  }
  if (typeof v === "string" || v instanceof String) {
    const trimmed = String(v).trim();
    const m = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(trimmed);
    return m ? Number(m[0]) : 0;
  }
  return 0;
}

const INT64_MIN = -9223372036854775808n;
const INT64_MAX = 9223372036854775807n;

function integerResult(value: bigint): SqlValue {
  if (value < INT64_MIN || value > INT64_MAX) return new Number(Number(value));
  return Number.isSafeInteger(Number(value)) ? Number(value) : value;
}

function integerPrefix(value: SqlValue): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" || value instanceof Number) {
    const number = Math.trunc(Number(value));
    if (number >= Number(INT64_MAX)) return INT64_MAX;
    if (number <= Number(INT64_MIN)) return INT64_MIN;
    return Number.isFinite(number) ? BigInt(number) : 0n;
  }
  const text = toSqlString(value).trimStart();
  let end = text[0] === "+" || text[0] === "-" ? 1 : 0;
  const start = end;
  while (end < text.length && "0123456789".includes(text[end]!)) end += 1;
  return end === start ? 0n : BigInt(text.slice(0, end));
}

function arithmeticNumber(value: SqlValue): SqlValue {
  if (typeof value === "bigint" || typeof value === "number" || value instanceof Number) return value;
  const text = toSqlString(value).trimStart();
  let end = text[0] === "+" || text[0] === "-" ? 1 : 0;
  let digits = 0;
  while (end < text.length && "0123456789".includes(text[end]!)) { end += 1; digits += 1; }
  let real = false;
  if (text[end] === ".") {
    real = true;
    end += 1;
    while (end < text.length && "0123456789".includes(text[end]!)) { end += 1; digits += 1; }
  }
  if (!digits) return 0;
  if (text[end] === "e" || text[end] === "E") {
    let exponentEnd = end + 1;
    if (text[exponentEnd] === "+" || text[exponentEnd] === "-") exponentEnd += 1;
    const exponentStart = exponentEnd;
    while (exponentEnd < text.length && "0123456789".includes(text[exponentEnd]!)) exponentEnd += 1;
    if (exponentEnd > exponentStart) { end = exponentEnd; real = true; }
  }
  return real ? new Number(Number(text.slice(0, end))) : integerResult(BigInt(text.slice(0, end)));
}

// SQLite derives affinity from the declared type in this precedence order.
function applyColumnAffinity(storedValue: SqlValue, declaredType: string, strict: boolean): SqlValue {
  let value = storedValue instanceof String ? storedValue.valueOf() : storedValue;
  if (value === null || value instanceof Uint8Array) return value;
  const type = declaredType.toUpperCase();
  // STRICT ANY preserves the storage class; ordinary ANY has NUMERIC affinity.
  if (strict && type === "ANY") return value;
  const integer = type.includes("INT");
  if (!integer && ["CHAR", "CLOB", "TEXT"].some((part) => type.includes(part))) {
    return toSqlString(value);
  }
  if (!integer && (type === "" || type.includes("BLOB"))) return value;
  const real = !integer && ["REAL", "FLOA", "DOUB"].some((part) => type.includes(part));
  if (typeof value === "string") {
    const text = value.trim();
    if (!text || ![...text].every((char) => "0123456789.+-eE".includes(char)) || Number.isNaN(Number(text))) return value;
    const digits = text[0] === "+" || text[0] === "-" ? text.slice(1) : text;
    if (digits && [...digits].every((char) => "0123456789".includes(char))) {
      const exact = BigInt(text);
      if (exact >= -9223372036854775808n && exact <= 9223372036854775807n) {
        if (real) return new Number(Number(exact));
        return Number.isSafeInteger(Number(exact)) ? Number(exact) : exact;
      }
    }
    value = new Number(Number(text));
  }
  if (typeof value === "bigint") return real ? new Number(Number(value)) : value;
  const number = value instanceof Number ? value.valueOf() : value;
  if (real) return new Number(number);
  // INTEGER and NUMERIC affinity store integral reals as signed 64-bit integers.
  if (Number.isInteger(number) && number >= -9223372036854775808 && number < 9223372036854775808) return number;
  return new Number(number);
}

export function toSqlString(v: SqlValue): string {
  if (v === null || v === undefined) {
    return "";
  }
  if (typeof v === "string" || v instanceof String) {
    return String(v);
  }
  if (typeof v === "bigint") {
    return v.toString();
  }
  if (v instanceof Number) {
    const n = v.valueOf();
    return Number.isFinite(n) && Number.isInteger(n) ? `${n}.0` : String(Number(n.toPrecision(15)));
  }
  if (typeof v === "number") {
    return Number.isInteger(v) ? String(v) : String(Number(v.toPrecision(15)));
  }
  const nulIdx = v.indexOf(0);
  const sub = nulIdx === -1 ? v : v.subarray(0, nulIdx);
  return textDecoder.decode(sub);
}

export function isTruthy(v: SqlValue): boolean {
  if (v === null || v === undefined) {
    return false;
  }
  if (typeof v === "bigint") {
    return v !== 0n;
  }
  if (v instanceof Number) {
    return v.valueOf() !== 0;
  }
  if (typeof v === "number") {
    return v !== 0;
  }
  if (typeof v === "string") {
    return toSqlNumber(v) !== 0;
  }
  return false;
}

function sqlEquals(a: SqlValue, b: SqlValue, collation = "BINARY"): boolean | null {
  if (a === null || a === undefined || b === null || b === undefined) {
    return null;
  }
  if (typeof a === "number" && typeof b === "string") {
    const n = Number(b.trim());
    if (b.trim() !== "" && !Number.isNaN(n)) {
      return a === n;
    }
  }
  if (typeof a === "string" && typeof b === "number") {
    const n = Number(a.trim());
    if (a.trim() !== "" && !Number.isNaN(n)) {
      return n === b;
    }
  }
  return compareSqlValues(a, b, collation) === 0;
}

export function matchLike(str: string, pattern: string, caseInsensitive: boolean, escapeChar = ""): boolean {
  let regexStr = "^";
  for (let i = 0; i < pattern.length; i += 1) {
    const c = pattern[i]!;
    if (escapeChar && c === escapeChar && i + 1 < pattern.length) {
      regexStr += pattern[i + 1]!.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      i += 1;
      continue;
    }
    if (c === "%") {
      regexStr += "[\\s\\S]*";
    } else if (c === "_") {
      regexStr += "[\\s\\S]";
    } else {
      regexStr += c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }
  }
  regexStr += "$";
  return new RegExp(regexStr, caseInsensitive ? "i" : "").test(str);
}

export function matchGlob(str: string, pattern: string): boolean {
  let regexStr = "^";
  for (let i = 0; i < pattern.length; i += 1) {
    const c = pattern[i]!;
    if (c === "*") {
      regexStr += "[\\s\\S]*";
    } else if (c === "?") {
      regexStr += "[\\s\\S]";
    } else if (c === "[") {
      let j = i + 1;
      if (pattern[j] === "^" || pattern[j] === "!") {
        j += 1;
      }
      if (pattern[j] === "]") {
        j += 1;
      }
      while (j < pattern.length && pattern[j] !== "]") {
        j += 1;
      }
      const cls = pattern.slice(i + 1, j);
      const neg = cls.startsWith("!") || cls.startsWith("^");
      const body = neg ? cls.slice(1) : cls;
      regexStr += `[${neg ? "^" : ""}${body.replace(/\\/g, "\\\\")}]`;
      i = j;
    } else {
      regexStr += c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }
  }
  regexStr += "$";
  return new RegExp(regexStr).test(str);
}

// --- Date/Time Helpers ---
function parseSqliteDateTime(args: SqlValue[]): Date | null {
  let d: Date;
  const first = args[0];
  let modStart = 1;
  if (first === undefined || first === null) {
    return null;
  }
  if (typeof first === "string" && first.toLowerCase() === "now") {
    d = new Date();
  } else if (typeof first === "number" || (typeof first === "string" && /^-?\d+(\.\d+)?$/.test(first.trim()))) {
    const num = Number(first);
    const secondArg = typeof args[1] === "string" ? args[1].toLowerCase().trim() : "";
    if (secondArg === "unixepoch") {
      d = new Date(num * 1000);
      modStart = 2;
    } else if (num > 1000000 && num < 5373484.5) {
      // Julian day
      d = new Date((num - 2440587.5) * 86400000);
    } else {
      d = new Date(num * 1000);
    }
  } else {
    let str = String(first).trim();
    if (/^\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(str)) {
      str = `2000-01-01T${str}Z`;
    } else if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
      str = `${str}T00:00:00Z`;
    } else if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(str) && !str.endsWith("Z") && !/[+-]\d{2}:?\d{2}$/.test(str)) {
      str = `${str.replace(" ", "T")}Z`;
    }
    d = new Date(str);
  }
  if (Number.isNaN(d.getTime())) {
    return null;
  }

  for (let i = modStart; i < args.length; i += 1) {
    const modRaw = String(args[i] ?? "").trim().toLowerCase();
    if (!modRaw || modRaw === "utc" || modRaw === "localtime" || modRaw === "subsec") {
      continue;
    }
    if (modRaw === "unixepoch") {
      continue;
    }
    if (modRaw === "start of day") {
      d.setUTCHours(0, 0, 0, 0);
      continue;
    }
    if (modRaw === "start of month") {
      d.setUTCDate(1);
      d.setUTCHours(0, 0, 0, 0);
      continue;
    }
    if (modRaw === "start of year") {
      d.setUTCMonth(0, 1);
      d.setUTCHours(0, 0, 0, 0);
      continue;
    }
    const wkMatch = /^weekday\s+(\d)$/.exec(modRaw);
    if (wkMatch) {
      const target = Number(wkMatch[1]);
      while (d.getUTCDay() !== target) {
        d.setUTCDate(d.getUTCDate() + 1);
      }
      continue;
    }
    const relMatch = /^([+-]?\d+(?:\.\d+)?)\s*(year|month|day|hour|minute|second)s?$/.exec(modRaw);
    if (relMatch) {
      const amt = Number(relMatch[1]);
      const unit = relMatch[2]!;
      if (unit === "year") {
        d.setUTCFullYear(d.getUTCFullYear() + Math.trunc(amt));
      } else if (unit === "month") {
        d.setUTCMonth(d.getUTCMonth() + Math.trunc(amt));
      } else if (unit === "day") {
        d = new Date(d.getTime() + amt * 86400000);
      } else if (unit === "hour") {
        d = new Date(d.getTime() + amt * 3600000);
      } else if (unit === "minute") {
        d = new Date(d.getTime() + amt * 60000);
      } else if (unit === "second") {
        d = new Date(d.getTime() + amt * 1000);
      }
    }
  }
  return d;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function pad4(n: number): string {
  return String(n).padStart(4, "0");
}

function formatStrftime(fmt: string, d: Date): string {
  const Y = d.getUTCFullYear();
  const m = d.getUTCMonth() + 1;
  const day = d.getUTCDate();
  const H = d.getUTCHours();
  const M = d.getUTCMinutes();
  const S = d.getUTCSeconds();
  const ms = d.getUTCMilliseconds();
  const startOfYear = Date.UTC(Y, 0, 1);
  const doy = Math.floor((d.getTime() - startOfYear) / 86400000) + 1;
  const dow = d.getUTCDay();
  const jd = d.getTime() / 86400000 + 2440587.5;

  return fmt.replace(/%[dHjmMSwWYuFTRsJ%f]/g, (spec) => {
    switch (spec) {
      case "%Y":
        return pad4(Y);
      case "%m":
        return pad2(m);
      case "%d":
        return pad2(day);
      case "%H":
        return pad2(H);
      case "%M":
        return pad2(M);
      case "%S":
        return pad2(S);
      case "%f":
        return `${pad2(S)}.${String(ms).padStart(3, "0")}`;
      case "%j":
        return String(doy).padStart(3, "0");
      case "%w":
        return String(dow);
      case "%u":
        return String(dow === 0 ? 7 : dow);
      case "%W":
        return pad2(Math.floor((doy + 6) / 7));
      case "%F":
        return `${pad4(Y)}-${pad2(m)}-${pad2(day)}`;
      case "%T":
        return `${pad2(H)}:${pad2(M)}:${pad2(S)}`;
      case "%R":
        return `${pad2(H)}:${pad2(M)}`;
      case "%s":
        return String(Math.floor(d.getTime() / 1000));
      case "%J":
        return String(jd);
      case "%%":
        return "%";
      default:
        return spec;
    }
  });
}

// --- JSON Path Helper ---
function parseJsonPathSegments(path: string): (string | number)[] {
  const p = path.trim();
  if (!p.startsWith("$")) {
    return [p];
  }
  const segs: (string | number)[] = [];
  let i = 1;
  while (i < p.length) {
    if (p[i] === ".") {
      i += 1;
      let j = i;
      while (j < p.length && p[j] !== "." && p[j] !== "[") {
        j += 1;
      }
      if (j > i) {
        segs.push(p.slice(i, j));
      }
      i = j;
    } else if (p[i] === "[") {
      let j = i + 1;
      while (j < p.length && p[j] !== "]") {
        j += 1;
      }
      const inside = p.slice(i + 1, j).trim();
      if (inside === "#") {
        segs.push("#");
      } else {
        const idx = Number(inside);
        segs.push(Number.isNaN(idx) ? inside.replace(/^['"]|['"]$/g, "") : idx);
      }
      i = j + 1;
    } else {
      i += 1;
    }
  }
  return segs;
}

function extractByJsonPath(root: unknown, path: string): unknown {
  const segs = parseJsonPathSegments(path);
  let cur: any = root;
  for (const s of segs) {
    if (cur === null || cur === undefined || typeof cur !== "object") {
      return undefined;
    }
    if (Array.isArray(cur)) {
      if (typeof s === "number") {
        const idx = s < 0 ? cur.length + s : s;
        cur = cur[idx];
      } else {
        return undefined;
      }
    } else {
      cur = cur[String(s)];
    }
  }
  return cur;
}

function setByJsonPath(
  root: any,
  path: string,
  val: unknown,
  mode: "set" | "insert" | "replace"
): any {
  const segs = parseJsonPathSegments(path);
  if (segs.length === 0) {
    return val;
  }
  const clone = structuredClone(root);
  let cur: any = clone;
  for (let i = 0; i < segs.length - 1; i += 1) {
    const s = segs[i]!;
    if (cur[s] === undefined || cur[s] === null || typeof cur[s] !== "object") {
      cur[s] = typeof segs[i + 1] === "number" ? [] : {};
    }
    cur = cur[s];
  }
  const last = segs[segs.length - 1]!;
  if (Array.isArray(cur) && last === "#") {
    if (mode !== "replace") {
      cur.push(val);
    }
    return clone;
  }
  const exists = Object.prototype.hasOwnProperty.call(cur, last);
  if (mode === "insert" && exists) {
    return clone;
  }
  if (mode === "replace" && !exists) {
    return clone;
  }
  cur[last] = val;
  return clone;
}

function removeByJsonPath(root: any, path: string): any {
  const segs = parseJsonPathSegments(path);
  if (segs.length === 0) {
    return null;
  }
  const clone = structuredClone(root);
  let cur: any = clone;
  for (let i = 0; i < segs.length - 1; i += 1) {
    cur = cur?.[segs[i]!];
    if (cur === undefined || cur === null) {
      return clone;
    }
  }
  const last = segs[segs.length - 1]!;
  if (Array.isArray(cur) && typeof last === "number") {
    const idx = last < 0 ? cur.length + last : last;
    if (idx >= 0 && idx < cur.length) {
      cur.splice(idx, 1);
    }
  } else if (cur && typeof cur === "object") {
    delete cur[last];
  }
  return clone;
}

function jsonValueToSql(v: unknown, unquoteScalar: boolean): SqlValue {
  if (v === undefined || v === null) {
    return null;
  }
  if (typeof v === "boolean") {
    return v ? 1 : 0;
  }
  if (typeof v === "number") {
    return v;
  }
  if (typeof v === "string") {
    return unquoteScalar ? v : serializeSqlJson(v);
  }
  return serializeSqlJson(v);
}

function sqlPrintf(format: string, args: SqlValue[]): string {
  let argIdx = 0;
  return format.replace(/%(-?\+?\s?0?\d*(?:\.\d+)?)([sdfxXcqQ%])/g, (full, flags: string, spec: string) => {
    if (spec === "%") {
      return "%";
    }
    const raw: SqlValue = args[argIdx++] ?? null;
    let out = "";
    if (spec === "s") {
      out = raw === null || raw === undefined ? "" : toSqlString(raw);
    } else if (spec === "q") {
      out = raw === null || raw === undefined ? "(NULL)" : toSqlString(raw).replace(/'/g, "''");
    } else if (spec === "Q") {
      out = raw === null || raw === undefined ? "NULL" : `'${toSqlString(raw).replace(/'/g, "''")}'`;
    } else if (spec === "c") {
      const s = toSqlString(raw);
      out = s[0] ?? "";
    } else if (spec === "d") {
      out = String(Math.trunc(toSqlNumber(raw)));
    } else if (spec === "x") {
      out = (Math.trunc(toSqlNumber(raw)) >>> 0).toString(16);
    } else if (spec === "X") {
      out = (Math.trunc(toSqlNumber(raw)) >>> 0).toString(16).toUpperCase();
    } else if (spec === "f") {
      const precMatch = /\.(\d+)/.exec(flags);
      const prec = precMatch ? Number(precMatch[1]) : 6;
      out = toSqlNumber(raw).toFixed(prec);
    }
    const widthMatch = /^(-?)(0?)(\d+)/.exec(flags);
    if (widthMatch) {
      const leftAlign = widthMatch[1] === "-";
      const padChar = widthMatch[2] === "0" && !leftAlign ? "0" : " ";
      const width = Number(widthMatch[3]);
      if (out.length < width) {
        out = leftAlign ? out.padEnd(width, " ") : out.padStart(width, padChar);
      }
    }
    return out;
  });
}

// --- SQLite Engine Class ---
export class SqliteDatabase {
  constructor(private readonly maxRows = Infinity) {}

  private checkRowCount(count: number): void {
    if (count > this.maxRows) throw new RangeError("maxRows limit exceeded");
  }

  public async executeStatementAsync(
    sql: string,
    signal: AbortSignal
  ): Promise<QueryResultSet | null> {
    return runCooperatively(this.executeStatementSteps(sql), signal);
  }

  public tables = new Map<string, TableDef>();
  public indexes = new Map<string, IndexDef>();
  public views = new Map<string, ViewDef>();
  public triggers = new Map<string, TriggerDef>();
  public loadedMaster: StoredTableMeta[] | null = null;
  public parameters = new Map<string, SqlValue>();
  public userVersion = 0;
  public applicationId = 0;
  public schemaCookie = 1;
  public foreignKeys = false;
  public journalMode = "memory";
  public synchronous = 2;
  public lastInsertRowid = 0;
  public lastChanges = 0;
  public totalChanges = 0;
  public inTransaction = false;
  private foreignKeyDepth = 0;
  private outerRows: Record<string, SqlValue>[] = [];
  private preparing = false;
  private txSnapshot: SnapshotState | null = null;
  private savepoints = new Map<string, SnapshotState>();

  private *captureSnapshot(): SqlSteps<SnapshotState> {
    const tables = new Map<string, TableDef>();
    for (const [k, v] of this.tables) {
      yield;
      tables.set(k, cloneTableDef(v));
    }
    return {
      tables,
      indexes: new Map(this.indexes),
      views: new Map(this.views),
      triggers: new Map(this.triggers),
      userVersion: this.userVersion,
      applicationId: this.applicationId,
      schemaCookie: this.schemaCookie
    };
  }

  private *restoreSnapshot(snap: SnapshotState): SqlSteps<void> {
    this.tables = new Map();
    for (const [k, v] of snap.tables) {
      yield;
      this.tables.set(k, cloneTableDef(v));
    }
    this.indexes = new Map(snap.indexes);
    this.views = new Map(snap.views);
    this.triggers = new Map(snap.triggers);
    this.userVersion = snap.userVersion;
    this.applicationId = snap.applicationId;
    this.schemaCookie = snap.schemaCookie;
  }

  public loadFromBytes(bytes: Uint8Array): void {
    return runSynchronously(this.loadFromBytesSteps(bytes));
  }

  private *loadFromBytesSteps(bytes: Uint8Array): SqlSteps<void> {
    if (bytes.byteLength === 0) {
      return;
    }
    const image = readSqliteDatabaseBytes(bytes);
    if (!image) {
      // Check if it's plain SQL dump text
      const text = textDecoder.decode(bytes);
      if (/^\s*(CREATE|INSERT|BEGIN|PRAGMA|--)/i.test(text)) {
        yield* this.execSteps(text);
        return;
      }
      throw new Error("file is not a database");
    }
    this.userVersion = image.userVersion;
    this.applicationId = image.applicationId;
    this.schemaCookie = image.schemaCookie;
    this.loadedMaster = image.master.map((m) => {
      return { ...m };
    });

    const preservedMaster = image.master.map((m) => {
      return { ...m };
    });
    for (const m of image.master) {
      yield;
      if (m.name.startsWith("sqlite_autoindex_") || m.name.toLowerCase() === "sqlite_sequence") {
        continue;
      }
      if (m.sql) {
        try {
          yield* this.execSteps(m.sql);
        } catch {
          // Ignore malformed legacy DDL if any
        }
      }
    }
    this.loadedMaster = preservedMaster;

    for (const [tblName, rawRows] of image.tableRows.entries()) {
      yield;
      const tbl = this.findTable(tblName);
      if (!tbl) {
        continue;
      }
      tbl.rows = [];
      let maxRowid = 0;
      const storageColumns = tableStorageColumns(tbl);
      for (const r of rawRows) {
        yield;
        const data: Record<string, SqlValue> = {};
        let valIdx = 0;

        for (const col of storageColumns) {
          yield;
          if (
            col.primaryKey &&
            col.type.toUpperCase() === "INTEGER" &&
            !tbl.withoutRowId &&
            tbl.primaryKeyCols.length === 1
          ) {
            const cellVal = r.values[valIdx];
            data[col.name] = cellVal === null || cellVal === undefined ? r.rowid : cellVal;
          } else {
            let cellVal = r.values[valIdx] ?? null;
            if (
              typeof cellVal === "number" &&
              Number.isInteger(cellVal) &&
              /(REAL|FLOA|DOUB)/i.test(col.type)
            ) {
              cellVal = new Number(cellVal);
            }
            data[col.name] = cellVal;
          }
          valIdx += 1;
        }
        tbl.rows.push({ rowid: r.rowid, data });
        if (r.rowid > maxRowid) {
          maxRowid = r.rowid;
        }
      }
      tbl.nextRowId = maxRowid + 1;
      tbl.maxAutoInc = Math.max(tbl.maxAutoInc, maxRowid);
    }

    const seqRows = image.tableRows.get("sqlite_sequence");
    if (seqRows) {
      for (const r of seqRows) {
        yield;
        const tName = String(r.values[0] ?? "");
        const seqVal = Number(r.values[1] ?? 0);
        const tbl = this.findTable(tName);
        if (tbl && Number.isFinite(seqVal)) {
          tbl.maxAutoInc = Math.max(tbl.maxAutoInc, seqVal);
          tbl.nextRowId = Math.max(tbl.nextRowId, seqVal + 1);
        }
      }
    }

    if (image.metaJson) {
      try {
        const meta = JSON.parse(image.metaJson) as {
          autoInc?: Record<string, number>;
        };
        if (meta.autoInc) {
          for (const [k, v] of Object.entries(meta.autoInc)) {
            yield;
            const tbl = this.findTable(k);
            if (tbl) {
              tbl.maxAutoInc = Math.max(tbl.maxAutoInc, v);
              tbl.nextRowId = Math.max(tbl.nextRowId, v + 1);
            }
          }
        }
      } catch {
        // Ignore
      }
    }
  }

  public serializeToBytes(): Uint8Array {
    return runSynchronously(this.serializeToBytesSteps());
  }

  private *serializeToBytesSteps(): SqlSteps<Uint8Array> {
    if ([...this.tables.values()].some((table) => table.fts5)) {
      throw new Error("unsupported FTS5 binary persistence; use a SQL dump");
    }
    const master: StoredTableMeta[] = [];
    const tableRows = new Map<string, { rowid: number; values: SqlValue[] }[]>();
    const indexRows = new Map<string, SqlValue[][]>();
    const seqRows: { rowid: number; values: SqlValue[] }[] = [];
    let hasAutoIncTable = false;

    let rootPageCounter = 2;
    for (const tbl of this.tables.values()) {
      yield;
      master.push({
        type: "table",
        name: tbl.name,
        tbl_name: tbl.name,
        rootpage: rootPageCounter++,
        sql: tbl.sql,
        withoutRowId: tbl.withoutRowId
      });
      if (
        tbl.columns.some((c) => {
          return c.autoIncrement;
        }) ||
        tbl.maxAutoInc > 0
      ) {
        if (
          tbl.columns.some((c) => {
            return c.autoIncrement;
          })
        ) {
          hasAutoIncTable = true;
        }
        if (tbl.maxAutoInc > 0) {
          seqRows.push({
            rowid: seqRows.length + 1,
            values: [tbl.name, tbl.maxAutoInc]
          });
        }
      }
      const storageColumns = tableStorageColumns(tbl);
      const orderedRows = tbl.withoutRowId
        ? yield* stepSort([...tbl.rows], function* (left, right) {
            for (let i = 0; i < tbl.primaryKeyCols.length; i++) {
              yield;
              const column = storageColumns[i]!;
              const order = tbl.primaryKeyOrder?.[i];
              const comparison = compareSqlValues(left.data[column.name] ?? null, right.data[column.name] ?? null,
                order?.collation ?? column.collate ?? "BINARY");
              if (comparison) return order?.desc ? -comparison : comparison;
            }
            return 0;
          }, this)
        : tbl.rows;
      const rows = yield* stepMap(orderedRows, function* (r) { yield;
        return {
          rowid: r.rowid,
          values: storageColumns.map((c) => {
            const isRowidAlias =
              c.primaryKey &&
              c.type.toUpperCase() === "INTEGER" &&
              !tbl.withoutRowId &&
              tbl.primaryKeyCols.length === 1;
            return isRowidAlias ? null : (r.data[c.name] ?? null);
          })
        };
      }, this);
      tableRows.set(tbl.name, rows);
    }

    if ((hasAutoIncTable || seqRows.length > 0) && !this.findTable("sqlite_sequence")) {
      master.push({
        type: "table",
        name: "sqlite_sequence",
        tbl_name: "sqlite_sequence",
        rootpage: rootPageCounter++,
        sql: "CREATE TABLE sqlite_sequence(name,seq)"
      });
      tableRows.set("sqlite_sequence", seqRows);
    }

    for (const idx of this.indexes.values()) {
      yield;
      master.push({
        type: "index",
        name: idx.name,
        tbl_name: idx.tableName,
        rootpage: rootPageCounter++,
        sql: idx.sql
      });
      const tbl = this.findTable(idx.tableName);
      if (tbl) {
        const entries: SqlValue[][] = yield* stepMap(tbl.rows, function* (r) { yield;
          return [
            ...idx.columns.map((colName) => {
              const cleaned = colName.replace(/\s+(ASC|DESC)$/i, "").trim();
              const matchCol = tbl.columns.find((c) => {
                return c.name.toLowerCase() === cleaned.toLowerCase();
              });
              return matchCol ? (r.data[matchCol.name] ?? null) : null;
            }),
            r.rowid
          ];
        }, this);
        indexRows.set(idx.name, entries);
      }
    }
    for (const v of this.views.values()) {
      yield;
      master.push({
        type: "view",
        name: v.name,
        tbl_name: v.name,
        rootpage: 0,
        sql: v.sql
      });
    }
    for (const tr of this.triggers.values()) {
      yield;
      master.push({
        type: "trigger",
        name: tr.name,
        tbl_name: tr.tableName,
        rootpage: 0,
        sql: tr.sql
      });
    }

    return writeSqliteDatabaseBytes({
      userVersion: this.userVersion,
      applicationId: this.applicationId,
      schemaCookie: this.schemaCookie,
      master,
      tableRows,
      indexRows
    });
  }

  private prepareBulkImport(tableName: string) {
    const tbl = this.findTable(tableName);
    if (!tbl) return undefined;
    const lowerTbl = tbl.name.toLowerCase();
    const hasTriggers = Array.from(this.triggers.values()).some((tr) => tr.tableName.toLowerCase() === lowerTbl);
    const hasComplexCols = tbl.columns.some(
      (c) => Boolean(c.checkExpr || c.generatedExpr || (c.primaryKey && c.type.toUpperCase() === "INTEGER" && !tbl.withoutRowId && tbl.primaryKeyCols.length === 1))
    );
    if (this.foreignKeys || hasTriggers || hasComplexCols) {
      return undefined;
    }
    const cols = tbl.columns, colCount = cols.length;
    let inserted = 0;
    return {
      insert: function* (this: SqliteDatabase, r: readonly string[]): SqlSteps<boolean> {
        if (r.length === 1 && r[0] === "" && colCount > 1) return true;
        const data: Record<string, SqlValue> = {};
        for (let cIdx = 0; cIdx < colCount; cIdx++) {
          const col = cols[cIdx]!;
          const raw = r[cIdx] ?? "";
          const val = applyColumnAffinity(raw, col.type, tbl.strict);
          if (col.notNull && (val === null || val === undefined)) {
            return false;
          }
          data[col.name] = val;
        }
        const rowid = tbl.nextRowId;
        const candidate: TableRow = { rowid, data };
        const conflict = yield* this.checkConstraintsAndConflicts(tbl, candidate);
        if (conflict) {
          throw new Error(`UNIQUE constraint failed: ${tbl.name}`);
        }
        this.checkRowCount(tbl.rows.length + 1);
        tbl.rows.push(candidate);
        tbl.nextRowId = rowid + 1;
        if (rowid > tbl.maxAutoInc) tbl.maxAutoInc = rowid;
        this.lastInsertRowid = rowid;
        inserted++; return true;
      }.bind(this),
      finish: () => { this.lastChanges = inserted; this.totalChanges += inserted; }
    };
  }

  public bulkImportRows(tableName: string, rows: readonly (readonly string[])[]): boolean {
    const plan = this.prepareBulkImport(tableName);
    if (!plan) return false;
    for (const row of rows) if (!runSynchronously(plan.insert(row))) return false;
    plan.finish(); return true;
  }

  public async bulkImportRowsAsync(tableName: string, rows: AsyncIterable<readonly string[]>, signal: AbortSignal): Promise<boolean> {
    const plan = this.prepareBulkImport(tableName);
    if (!plan) return false;
    let work = 0;
    for await (const row of rows) {
      if (++work % 512 === 0) await yieldTurn(signal);
      signal.throwIfAborted();
      if (!await runCooperatively(plan.insert(row), signal)) return false;
    }
    signal.throwIfAborted(); plan.finish(); return true;
  }

  public findTable(name: string): TableDef | undefined {
    const lower = name.toLowerCase();
    for (const [k, v] of this.tables) {
      if (k.toLowerCase() === lower) {
        return v;
      }
    }
    return undefined;
  }

  public findView(name: string): ViewDef | undefined {
    const lower = name.toLowerCase();
    for (const [k, v] of this.views) {
      if (k.toLowerCase() === lower) {
        return v;
      }
    }
    return undefined;
  }

  public exec(sql: string, positionalParams: SqlValue[] = []): QueryResultSet[] {
    return runSynchronously(this.execSteps(sql, positionalParams));
  }

  private *execSteps(sql: string, positionalParams: SqlValue[] = []): SqlSteps<QueryResultSet[]> {
    const stmts = splitSqlStatements(sql);
    const results: QueryResultSet[] = [];
    for (const stmt of stmts) {
      yield;
      const res = yield* this.executeStatementSteps(stmt, positionalParams);
      if (res) {
        results.push(res);
      }
    }
    return results;
  }

  public executeStatement(
    rawSql: string,
    positionalParams: SqlValue[] = [],
    cteScope: Map<string, { columns: string[]; rows: SqlValue[][] }> = new Map()
  ): QueryResultSet | null {
    return runSynchronously(this.executeStatementSteps(rawSql, positionalParams, cteScope));
  }

  private *executeStatementSteps(
    rawSql: string,
    positionalParams: SqlValue[] = [],
    cteScope: Map<string, { columns: string[]; rows: SqlValue[][] }> = new Map()
  ): SqlSteps<QueryResultSet | null> {
    const sql = rawSql.trim().replace(/;+\s*$/, "");
    if (!sql) {
      return null;
    }
    const tokens = tokenizeSql(sql);
    if (tokens.length === 0) {
      return null;
    }

    const first = tokens[0]!.value.toUpperCase();

    if (first === "EXPLAIN") {
      return {
        columns: ["id", "parent", "notused", "detail"],
        rows: [[0, 0, 0, `SCAN (${sql.replace(/^EXPLAIN\s+(?:QUERY\s+PLAN\s+)?/i, "")})`]]
      };
    }

    if (first === "BEGIN") {
      if (!this.inTransaction) {
        this.txSnapshot = yield* this.captureSnapshot();
        this.inTransaction = true;
      }
      return null;
    }

    if (first === "COMMIT" || first === "END") {
      this.inTransaction = false;
      this.txSnapshot = null;
      this.savepoints.clear();
      return null;
    }

    if (first === "ROLLBACK") {
      const toIdx = tokens.findIndex((t) => {
        return t.value.toUpperCase() === "TO";
      });
      if (toIdx !== -1) {
        let spIdx = toIdx + 1;
        if (tokens[spIdx]?.value.toUpperCase() === "SAVEPOINT") {
          spIdx += 1;
        }
        const spName = (tokens[spIdx]?.value ?? "").toLowerCase();
        const snap = this.savepoints.get(spName);
        if (!snap) {
          throw new Error(`no such savepoint: ${spName}`);
        }
        yield* this.restoreSnapshot(snap);
        return null;
      }
      if (this.txSnapshot) {
        yield* this.restoreSnapshot(this.txSnapshot);
      }
      this.inTransaction = false;
      this.txSnapshot = null;
      this.savepoints.clear();
      return null;
    }

    if (first === "SAVEPOINT") {
      const spName = (tokens[1]?.value ?? "").toLowerCase();
      this.savepoints.set(spName, yield* this.captureSnapshot());
      return null;
    }

    if (first === "RELEASE") {
      const spIdx = tokens[1]?.value.toUpperCase() === "SAVEPOINT" ? 2 : 1;
      const spName = (tokens[spIdx]?.value ?? "").toLowerCase();
      this.savepoints.delete(spName);
      return null;
    }

    if (
      first === "VACUUM" ||
      first === "ANALYZE" ||
      first === "REINDEX" ||
      first === "ATTACH" ||
      first === "DETACH"
    ) {
      return null;
    }

    if (first === "PRAGMA") {
      return yield* this.executePragma(tokens);
    }

    if (first === "CREATE") {
      yield* this.executeCreate(sql, tokens, positionalParams);
      this.schemaCookie += 1;
      return null;
    }

    if (first === "DROP") {
      this.executeDrop(tokens);
      this.schemaCookie += 1;
      return null;
    }

    if (first === "ALTER") {
      yield* this.executeAlter(tokens);
      this.schemaCookie += 1;
      return null;
    }

    if (["INSERT", "REPLACE", "UPDATE", "DELETE"].includes(first)) {
      const snapshot = this.foreignKeys && this.foreignKeyDepth === 0 ? yield* this.captureSnapshot() : null;
      const existingRows = new Set<TableRow>();
      if (snapshot) {
        for (const table of this.tables.values()) {
          for (const row of table.rows) { yield; existingRows.add(row); }
        }
      }
      const counters = [this.lastChanges, this.totalChanges, this.lastInsertRowid];
      this.foreignKeyDepth++;
      try {
        let result: QueryResultSet | null;
        if (first === "UPDATE") result = yield* this.executeUpdate(tokens, positionalParams, cteScope);
        else if (first === "DELETE") result = yield* this.executeDelete(tokens, positionalParams, cteScope);
        else result = yield* this.executeInsert(sql, tokens, positionalParams, cteScope);
        if (snapshot) yield* this.validateForeignKeys(snapshot, existingRows);
        return result;
      } catch (error) {
        if (snapshot) {
          yield* this.restoreSnapshot(snapshot);
          [this.lastChanges, this.totalChanges, this.lastInsertRowid] = counters as [number, number, number];
        }
        throw error;
      } finally {
        this.foreignKeyDepth--;
      }
    }

    if (first === "WITH") {
      return yield* this.executeWith(tokens, positionalParams, cteScope);
    }

    if (first === "SELECT" || first === "VALUES") {
      return yield* this.executeSelectCompound(tokens, positionalParams, cteScope);
    }

    throw new Error(`near "${tokens[0]!.raw}": syntax error`);
  }

  private *executePragma(tokens: Token[]): SqlSteps<QueryResultSet | null> {
    // PRAGMA [schema.]name [= value | (value)]
    let idx = 1;
    if (tokens[idx + 1]?.value === ".") {
      idx += 2;
    }
    const name = (tokens[idx]?.value ?? "").toLowerCase();
    idx += 1;
    let arg: string | undefined;
    let isAssign = false;
    if (tokens[idx]?.value === "=") {
      isAssign = true;
      arg = tokens[idx + 1]?.value;
    } else if (tokens[idx]?.value === "(") {
      arg = tokens[idx + 1]?.value;
    }

    if (name === "user_version") {
      if (isAssign && arg !== undefined) {
        this.userVersion = Number(arg) || 0;
        return null;
      }
      return { columns: ["user_version"], rows: [[this.userVersion]] };
    }
    if (name === "application_id") {
      if (isAssign && arg !== undefined) {
        this.applicationId = Number(arg) || 0;
        return null;
      }
      return { columns: ["application_id"], rows: [[this.applicationId]] };
    }
    if (name === "schema_version") {
      return { columns: ["schema_version"], rows: [[this.schemaCookie]] };
    }
    if (name === "foreign_keys") {
      if (arg !== undefined) {
        const u = arg.toUpperCase();
        if (!this.inTransaction && this.savepoints.size === 0) this.foreignKeys = u === "1" || u === "ON" || u === "TRUE";
        return null;
      }
      return { columns: ["foreign_keys"], rows: [[this.foreignKeys ? 1 : 0]] };
    }
    if (name === "journal_mode") {
      if (arg !== undefined) {
        this.journalMode = arg.toLowerCase();
      }
      return { columns: ["journal_mode"], rows: [[this.journalMode]] };
    }
    if (name === "synchronous") {
      if (arg !== undefined) {
        this.synchronous = Number(arg) || 2;
        return null;
      }
      return { columns: ["synchronous"], rows: [[this.synchronous]] };
    }
    if (name === "page_size") {
      return { columns: ["page_size"], rows: [[4096]] };
    }
    if (name === "page_count") {
      return { columns: ["page_count"], rows: [[Math.max(1, this.tables.size + 1)]] };
    }
    if (name === "freelist_count") {
      return { columns: ["freelist_count"], rows: [[0]] };
    }
    if (name === "encoding") {
      return { columns: ["encoding"], rows: [["UTF-8"]] };
    }
    if (name === "integrity_check" || name === "quick_check") {
      return { columns: [name], rows: [["ok"]] };
    }
    if (name === "database_list") {
      return {
        columns: ["seq", "name", "file"],
        rows: [[0, "main", ""]]
      };
    }
    if (name === "table_info" || name === "table_xinfo") {
      const tbl = this.findTable(arg ?? "");
      if (!tbl) {
        return { columns: ["cid", "name", "type", "notnull", "dflt_value", "pk"], rows: [] };
      }
      const rows: SqlValue[][] = tbl.columns.map((c, i) => {
        const pkIdx = tbl.primaryKeyCols.findIndex((p) => {
          return p.toLowerCase() === c.name.toLowerCase();
        });
        const base: SqlValue[] = [
          i,
          c.name,
          c.type,
          c.notNull ? 1 : 0,
          c.defaultExpr ?? null,
          pkIdx >= 0 ? pkIdx + 1 : c.primaryKey ? 1 : 0
        ];
        if (name === "table_xinfo") {
          base.push(c.generatedExpr ? 2 : 0);
        }
        return base;
      });
      const cols =
        name === "table_xinfo"
          ? ["cid", "name", "type", "notnull", "dflt_value", "pk", "hidden"]
          : ["cid", "name", "type", "notnull", "dflt_value", "pk"];
      return { columns: cols, rows };
    }
    if (name === "index_list") {
      const tName = (arg ?? "").toLowerCase();
      const rows: SqlValue[][] = [];
      let seq = 0;
      for (const idxDef of this.indexes.values()) {
        yield;
        if (idxDef.tableName.toLowerCase() === tName) {
          rows.push([seq++, idxDef.name, idxDef.unique ? 1 : 0, "c", 0]);
        }
      }
      return { columns: ["seq", "name", "unique", "origin", "partial"], rows };
    }
    if (name === "index_info") {
      const iName = (arg ?? "").toLowerCase();
      for (const idxDef of this.indexes.values()) {
        yield;
        if (idxDef.name.toLowerCase() === iName) {
          const tbl = this.findTable(idxDef.tableName);
          const rows: SqlValue[][] = idxDef.columns.map((colName, seqno) => {
            const cid =
              tbl?.columns.findIndex((c) => c.name.toLowerCase() === colName.toLowerCase()) ?? 0;
            return [seqno, cid, colName];
          });
          return { columns: ["seqno", "cid", "name"], rows };
        }
      }
      return { columns: ["seqno", "cid", "name"], rows: [] };
    }
    if (name === "foreign_key_list") {
      return {
        columns: ["id", "seq", "table", "from", "to", "on_update", "on_delete", "match"],
        rows: (this.findTable(arg ?? "")?.foreignKeys ?? []).flatMap((key, id) =>
          key.columns.map((column, seq) => [id, seq, key.table, column, key.target[seq] ?? null, key.onUpdate, key.onDelete, "NONE"]))
      };
    }
    if (name === "compile_options") {
      return {
        columns: ["compile_options"],
        rows: [
          ["ENABLE_FTS5"],
          ["ENABLE_JSON1"],
          ["ENABLE_MATH_FUNCTIONS"],
          ["ENABLE_RTREE"],
          ["THREADSAFE=1"]
        ]
      };
    }
    return null;
  }

  private *executeCreate(
    sql: string,
    tokens: Token[],
    positionalParams: SqlValue[]
  ): SqlSteps<void> {
    let idx = 1;
    let unique = false;
    if (
      tokens[idx]?.value.toUpperCase() === "TEMP" ||
      tokens[idx]?.value.toUpperCase() === "TEMPORARY"
    ) {
      idx += 1;
    }
    if (tokens[idx]?.value.toUpperCase() === "UNIQUE") {
      unique = true;
      idx += 1;
    }
    const virtual = tokens[idx]?.value.toUpperCase() === "VIRTUAL";
    if (virtual) idx += 1;
    const kind = (tokens[idx]?.value ?? "").toUpperCase();
    if (virtual && kind !== "TABLE") throw new Error("unsupported virtual table declaration");
    idx += 1;
    let ifNotExists = false;
    if (
      tokens[idx]?.value.toUpperCase() === "IF" &&
      tokens[idx + 1]?.value.toUpperCase() === "NOT" &&
      tokens[idx + 2]?.value.toUpperCase() === "EXISTS"
    ) {
      ifNotExists = true;
      idx += 3;
    }
    if (tokens[idx + 1]?.value === ".") {
      idx += 2;
    }
    const objName = tokens[idx]?.value ?? "";
    idx += 1;

    if (kind === "TABLE") {
      if (this.findTable(objName)) {
        if (ifNotExists) {
          return;
        }
        throw new Error(`table ${objName} already exists`);
      }

      if (virtual) {
        if (tokens[idx]?.value.toUpperCase() !== "USING" ||
            tokens[idx + 1]?.value.toLowerCase() !== "fts5" ||
            tokens[idx + 2]?.value !== "(") {
          throw new Error("unsupported virtual table module; only fts5 is supported");
        }
        const columns: ColumnDef[] = [];
        idx += 3;
        while (idx < tokens.length && tokens[idx]?.value !== ")") {
          yield;
          const token = tokens[idx++];
          if (!token || !["word", "ident", "string"].includes(token.type) ||
              ![",", ")"].includes(tokens[idx]?.value ?? "")) {
            throw new Error("unsupported FTS5 column or option");
          }
          const name = token.value;
          if (["rank", "rowid", objName.toLowerCase()].includes(name.toLowerCase())) {
            throw new Error("unsupported FTS5 reserved column name");
          }
          if (columns.some((c) => c.name.toLowerCase() === name.toLowerCase())) {
            throw new Error(`duplicate column name: ${name}`);
          }
          columns.push({ name, type: "", notNull: false, primaryKey: false, autoIncrement: false, unique: false });
          if (tokens[idx]?.value !== ",") break;
          idx += 1;
          if (tokens[idx]?.value === ")") throw new Error("unsupported FTS5 trailing comma");
        }
        if (!columns.length || tokens[idx]?.value !== ")" || idx !== tokens.length - 1) {
          throw new Error("unsupported FTS5 table definition");
        }
        this.tables.set(objName, {
          name: objName, sql, columns, rows: [], nextRowId: 1, maxAutoInc: 0,
          withoutRowId: false, strict: false, primaryKeyCols: [], uniqueColSets: [], fts5: true
        });
        return;
      }

      // Check CREATE TABLE ... AS SELECT
      const asIdx = tokens.findIndex((t, i) => {
        return i >= idx && t.value.toUpperCase() === "AS";
      });
      if (asIdx !== -1 && tokens[idx]?.value !== "(") {
        const selectTokens = tokens.slice(asIdx + 1);
        const res = yield* this.executeSelectCompound(
          selectTokens,
          positionalParams,
          new Map()
        );
        const columns: ColumnDef[] = res.columns.map((c) => {
          return {
            name: c,
            type: "TEXT",
            notNull: false,
            primaryKey: false,
            autoIncrement: false,
            unique: false
          };
        });
        const rows: TableRow[] = yield* stepMap(res.rows, function* (r, rIdx) { yield;
          const data: Record<string, SqlValue> = {};
          res.columns.forEach((c, cIdx) => {
            data[c] = r[cIdx] ?? null;
          });
          return { rowid: rIdx + 1, data };
        }, this);
        this.tables.set(objName, {
          name: objName,
          sql: `CREATE TABLE ${objName}(${columns
            .map((c) => {
              return `"${c.name}"`;
            })
            .join(",")})`,
          columns,
          rows,
          nextRowId: rows.length + 1,
          maxAutoInc: rows.length,
          withoutRowId: false,
          strict: false,
          primaryKeyCols: [],
          uniqueColSets: []
        });
        return;
      }

      // Parse column definitions inside (...)
      let openParen = idx;
      while (openParen < tokens.length && tokens[openParen]?.value !== "(") {
        yield;
        openParen += 1;
      }
      let depth = 1;
      let closeParen = openParen + 1;
      const bodyParts: Token[][] = [];
      let curPart: Token[] = [];
      while (closeParen < tokens.length && depth > 0) {
        yield;
        const t = tokens[closeParen]!;
        if (t.value === "(") {
          depth += 1;
          curPart.push(t);
        } else if (t.value === ")") {
          depth -= 1;
          if (depth === 0) {
            if (curPart.length > 0) {
              bodyParts.push(curPart);
            }
            break;
          }
          curPart.push(t);
        } else if (t.value === "," && depth === 1) {
          bodyParts.push(curPart);
          curPart = [];
        } else {
          curPart.push(t);
        }
        closeParen += 1;
      }

      const trailingTokens = tokens.slice(closeParen + 1).map((t) => {
        return t.value.toUpperCase();
      });
      const withoutRowId = trailingTokens.includes("WITHOUT") && trailingTokens.includes("ROWID");
      const strict = trailingTokens.includes("STRICT");

      const columns: ColumnDef[] = [];
      const primaryKeyCols: string[] = [];
      const primaryKeyOrder: NonNullable<TableDef["primaryKeyOrder"]> = [];
      const uniqueColSets: string[][] = [];
      const foreignKeys: ForeignKeyDef[] = [];

      for (const part of bodyParts) {
        yield;
        if (part.length === 0) {
          continue;
        }
        let pIdx = 0;
        if (part[pIdx]?.value.toUpperCase() === "CONSTRAINT") {
          pIdx += 2;
        }
        const firstWord = (part[pIdx]?.value ?? "").toUpperCase();
        const reference = part.findIndex(token => token.type === "word" && token.value.toUpperCase() === "REFERENCES");
        if (reference !== -1) {
          let cursor = reference + 1;
          const table = part[cursor++]!.value;
          const readColumns = (start: number): string[] => {
            const names: string[] = [];
            for (let i = start + 1; i < part.length && part[i]!.value !== ")"; i++) {
              if (part[i]!.value !== ",") names.push(part[i]!.value);
            }
            return names;
          };
          const target = part[cursor]?.value === "(" ? readColumns(cursor) : [];
          const key: ForeignKeyDef = {
            table, target, columns: firstWord === "FOREIGN" ? readColumns(pIdx + 2) : [part[0]!.value],
            onDelete: "NO ACTION", onUpdate: "NO ACTION"
          };
          for (; cursor < part.length; cursor++) {
            if (part[cursor]?.value.toUpperCase() === "DEFERRABLE" && part[cursor - 1]?.value.toUpperCase() !== "NOT") {
              throw new Error("unsupported deferred foreign key");
            }
            if (part[cursor]?.value.toUpperCase() !== "ON") continue;
            const event = part[++cursor]?.value.toUpperCase();
            let action = part[++cursor]?.value.toUpperCase() ?? "";
            if (action === "SET" || action === "NO") action += " " + part[++cursor]?.value.toUpperCase();
            if (!["CASCADE", "SET NULL", "SET DEFAULT", "RESTRICT", "NO ACTION"].includes(action)) throw new Error("invalid foreign key action");
            if (event === "DELETE") key.onDelete = action;
            else if (event === "UPDATE") key.onUpdate = action;
          }
          foreignKeys.unshift(key);
        }
        if (firstWord === "PRIMARY" && part[pIdx + 1]?.value.toUpperCase() === "KEY") {
          pIdx += 2;
          if (part[pIdx]?.value === "(") {
            pIdx += 1;
            while (pIdx < part.length && part[pIdx]?.value !== ")") {
              yield;
              if (part[pIdx]!.value === ",") { pIdx++; continue; }
              primaryKeyCols.push(part[pIdx++]!.value);
              let collation: string | undefined;
              if (part[pIdx]?.value.toUpperCase() === "COLLATE") {
                collation = part[pIdx + 1]?.value;
                pIdx += 2;
              }
              const direction = part[pIdx]?.value.toUpperCase();
              primaryKeyOrder.push({ desc: direction === "DESC", collation });
              if (direction === "ASC" || direction === "DESC") pIdx++;
            }
          }
          continue;
        }
        if (firstWord === "UNIQUE") {
          pIdx += 1;
          const uCols: string[] = [];
          if (part[pIdx]?.value === "(") {
            pIdx += 1;
            while (pIdx < part.length && part[pIdx]?.value !== ")") {
              yield;
              const colName = part[pIdx]!.value;
              if (
                colName !== "," &&
                colName.toUpperCase() !== "ASC" &&
                colName.toUpperCase() !== "DESC"
              ) {
                uCols.push(colName);
              }
              pIdx += 1;
            }
          }
          if (uCols.length > 0) {
            uniqueColSets.push(uCols);
          }
          continue;
        }
        if (firstWord === "CHECK" || firstWord === "FOREIGN") {
          continue;
        }

        const colDef = this.parseColumnDefTokens(part);
        columns.push(colDef);
        if (colDef.primaryKey && !primaryKeyCols.includes(colDef.name)) {
          primaryKeyCols.push(colDef.name);
          const primaryIndex = part.findIndex((token) => token.type === "word" && token.value.toUpperCase() === "PRIMARY");
          primaryKeyOrder.push({ desc: part[primaryIndex + 2]?.value.toUpperCase() === "DESC", collation: colDef.collate });
        }
        if (colDef.unique) {
          uniqueColSets.push([colDef.name]);
        }
      }

      if (primaryKeyCols.length === 1) {
        const pkCol = columns.find((c) => {
          return c.name.toLowerCase() === primaryKeyCols[0]!.toLowerCase();
        });
        if (pkCol) {
          pkCol.primaryKey = true;
        }
      }

      this.tables.set(objName, {
        name: objName,
        sql,
        columns,
        rows: [],
        nextRowId: 1,
        maxAutoInc: 0,
        withoutRowId,
        strict,
        primaryKeyCols,
        primaryKeyOrder,
        uniqueColSets,
        foreignKeys
      });
      return;
    }

    if (kind === "INDEX") {
      if (this.indexes.has(objName)) {
        if (ifNotExists) {
          return;
        }
        throw new Error(`index ${objName} already exists`);
      }
      // ON table_name (col1, col2...)
      const onIdx = tokens.findIndex((t, i) => {
        return i >= idx && t.value.toUpperCase() === "ON";
      });
      const tableName = tokens[onIdx + 1]?.value ?? "";
      const tbl = this.findTable(tableName);
      if (!tbl) throw new Error(`no such table: ${tableName}`);
      const cols: string[] = [];
      const collations: string[] = [];
      let p = onIdx + 2;
      if (tokens[p++]?.value !== "(") throw new Error("expected index columns");
      while (p < tokens.length && tokens[p]?.value !== ")") {
        yield;
        const name = tokens[p++]!.value;
        const column = tbl.columns.find(col => col.name.toLowerCase() === name.toLowerCase());
        if (!column) throw new Error(`no such column: ${name}`);
        cols.push(column.name);
        let collation = column.collate ?? "BINARY";
        if (tokens[p]?.value.toUpperCase() === "COLLATE") {
          p++;
          collation = tokens[p++]?.value.toUpperCase() ?? "";
          if (!["BINARY", "NOCASE", "RTRIM"].includes(collation)) throw new Error(`no such collation sequence: ${collation}`);
        }
        collations.push(collation);
        if (["ASC", "DESC"].includes(tokens[p]?.value.toUpperCase() ?? "")) p++;
        if (tokens[p]?.value === ",") p++;
        else if (tokens[p]?.value !== ")") throw new Error("expected index column separator");
      }
      if (unique) {
        const keys: SqlValue[][] = [];
        for (const row of tbl.rows) {
          const key: SqlValue[] = [];
          for (const col of cols) {
            yield;
            const value = row.data[col] ?? null;
            if (value === null) break;
            key.push(value);
          }
          if (key.length === cols.length) keys.push(key);
        }
        function* compareKeys(left: SqlValue[], right: SqlValue[]): SqlSteps<number> {
          for (let c = 0; c < cols.length; c++) {
            yield;
            const order = compareSqlValues(left[c]!, right[c]!, collations[c]!);
            if (order !== 0) return order;
          }
          return 0;
        }
        yield* stepSort(keys, compareKeys, this);
        for (let i = 1; i < keys.length; i++) {
          if ((yield* compareKeys(keys[i - 1]!, keys[i]!)) === 0) throw new SqliteConstraintError(`UNIQUE constraint failed: ${tbl.name}`);
        }
      }
      this.indexes.set(objName, { name: objName, tableName: tbl.name, unique, columns: cols, collations, sql });
      return;
    }

    if (kind === "VIEW") {
      if (this.findView(objName)) {
        if (ifNotExists) {
          return;
        }
        throw new Error(`view ${objName} already exists`);
      }
      let viewCols: string[] | undefined;
      if (tokens[idx]?.value === "(") {
        viewCols = [];
        idx += 1;
        while (idx < tokens.length && tokens[idx]?.value !== ")") {
          yield;
          if (tokens[idx]!.value !== ",") {
            viewCols.push(tokens[idx]!.value);
          }
          idx += 1;
        }
        idx += 1;
      }
      const asIdx = tokens.findIndex((t, i) => {
        return i >= idx && t.value.toUpperCase() === "AS";
      });
      const selectSql = reconstructTokensSql(tokens.slice(asIdx + 1));
      this.views.set(objName, {
        name: objName,
        columns: viewCols,
        selectSql,
        sql
      });
      return;
    }

    if (kind === "TRIGGER") {
      if (this.triggers.has(objName)) {
        if (ifNotExists) {
          return;
        }
        throw new Error(`trigger ${objName} already exists`);
      }
      let timing: TriggerDef["timing"] = "AFTER";
      const tWord = (tokens[idx]?.value ?? "").toUpperCase();
      if (tWord === "BEFORE") {
        timing = "BEFORE";
        idx += 1;
      } else if (tWord === "AFTER") {
        timing = "AFTER";
        idx += 1;
      } else if (tWord === "INSTEAD") {
        timing = "INSTEAD OF";
        idx += 2;
      }
      let event: TriggerDef["event"] = "INSERT";
      const eWord = (tokens[idx]?.value ?? "").toUpperCase();
      if (eWord === "INSERT" || eWord === "UPDATE" || eWord === "DELETE") {
        event = eWord;
        idx += 1;
      }
      if (tokens[idx]?.value.toUpperCase() === "OF") {
        idx += 1;
        while (idx < tokens.length && tokens[idx]?.value.toUpperCase() !== "ON") {
          yield;
          idx += 1;
        }
      }
      if (tokens[idx]?.value.toUpperCase() === "ON") {
        idx += 1;
      }
      const tableName = tokens[idx]?.value ?? "";
      idx += 1;
      if (
        tokens[idx]?.value.toUpperCase() === "FOR" &&
        tokens[idx + 1]?.value.toUpperCase() === "EACH" &&
        tokens[idx + 2]?.value.toUpperCase() === "ROW"
      ) {
        idx += 3;
      }
      let whenExpr: string | undefined;
      if (tokens[idx]?.value.toUpperCase() === "WHEN") {
        idx += 1;
        const whenToks: Token[] = [];
        while (idx < tokens.length && tokens[idx]?.value.toUpperCase() !== "BEGIN") {
          yield;
          whenToks.push(tokens[idx]!);
          idx += 1;
        }
        whenExpr = reconstructTokensSql(whenToks);
      }
      const beginMatch = /\bBEGIN\b([\s\S]*)\bEND\s*$/i.exec(sql);
      const bodySql = beginMatch ? beginMatch[1]!.trim() : "";
      this.triggers.set(objName, {
        name: objName,
        timing,
        event,
        tableName,
        whenExpr,
        bodySql,
        sql
      });
    }
  }

  private parseColumnDefTokens(part: Token[]): ColumnDef {
    const colName = part[0]!.value;
    let p = 1;
    const constraintKeywords = new Set([
      "PRIMARY",
      "NOT",
      "NULL",
      "UNIQUE",
      "DEFAULT",
      "CHECK",
      "COLLATE",
      "REFERENCES",
      "GENERATED",
      "AS",
      "CONSTRAINT",
      "AUTOINCREMENT"
    ]);
    const typeParts: string[] = [];
    while (p < part.length && !constraintKeywords.has(part[p]!.value.toUpperCase())) {
      const t = part[p]!;
      if (t.value === "(") {
        let sub = "(";
        p += 1;
        while (p < part.length && part[p]!.value !== ")") {
          sub += part[p]!.raw;
          p += 1;
        }
        sub += ")";
        typeParts.push(sub);
        p += 1;
      } else {
        typeParts.push(t.value);
        p += 1;
      }
    }

    let notNull = false;
    let primaryKey = false;
    let autoIncrement = false;
    let unique = false;
    let defaultExpr: string | undefined;
    let checkExpr: string | undefined;
    let collate: string | undefined;
    let generatedExpr: string | undefined;

    while (p < part.length) {
      const w = part[p]!.value.toUpperCase();
      if (w === "NOT" && part[p + 1]?.value.toUpperCase() === "NULL") {
        notNull = true;
        p += 2;
      } else if (w === "PRIMARY" && part[p + 1]?.value.toUpperCase() === "KEY") {
        primaryKey = true;
        p += 2;
        if (part[p]?.value.toUpperCase() === "ASC" || part[p]?.value.toUpperCase() === "DESC") {
          p += 1;
        }
        if (part[p]?.value.toUpperCase() === "AUTOINCREMENT") {
          autoIncrement = true;
          p += 1;
        }
      } else if (w === "AUTOINCREMENT") {
        autoIncrement = true;
        p += 1;
      } else if (w === "UNIQUE") {
        unique = true;
        p += 1;
      } else if (w === "COLLATE") {
        collate = part[p + 1]?.value;
        p += 2;
      } else if (w === "DEFAULT" && part[p - 1]?.value.toUpperCase() !== "SET") {
        p += 1;
        if (part[p]?.value === "(") {
          let depth = 1;
          p += 1;
          const exprToks: Token[] = [];
          while (p < part.length && depth > 0) {
            if (part[p]!.value === "(") {
              depth += 1;
            } else if (part[p]!.value === ")") {
              depth -= 1;
              if (depth === 0) {
                p += 1;
                break;
              }
            }
            exprToks.push(part[p]!);
            p += 1;
          }
          defaultExpr = reconstructTokensSql(exprToks);
        } else if (part[p]?.value === "-" || part[p]?.value === "+") {
          defaultExpr = `${part[p]!.raw}${part[p + 1]?.raw ?? "0"}`;
          p += 2;
        } else {
          defaultExpr = part[p]?.raw;
          p += 1;
        }
      } else if (w === "CHECK") {
        p += 1;
        if (part[p]?.value === "(") {
          let depth = 1;
          p += 1;
          const exprToks: Token[] = [];
          while (p < part.length && depth > 0) {
            if (part[p]!.value === "(") {
              depth += 1;
            } else if (part[p]!.value === ")") {
              depth -= 1;
              if (depth === 0) {
                p += 1;
                break;
              }
            }
            exprToks.push(part[p]!);
            p += 1;
          }
          checkExpr = reconstructTokensSql(exprToks);
        }
      } else if (w === "GENERATED" || w === "AS") {
        while (p < part.length && part[p]?.value !== "(") {
          p += 1;
        }
        if (part[p]?.value === "(") {
          let depth = 1;
          p += 1;
          const exprToks: Token[] = [];
          while (p < part.length && depth > 0) {
            if (part[p]!.value === "(") {
              depth += 1;
            } else if (part[p]!.value === ")") {
              depth -= 1;
              if (depth === 0) {
                p += 1;
                break;
              }
            }
            exprToks.push(part[p]!);
            p += 1;
          }
          generatedExpr = reconstructTokensSql(exprToks);
        }
      } else {
        p += 1;
      }
    }

    return {
      name: colName,
      type: typeParts.join(" "),
      notNull,
      primaryKey,
      autoIncrement,
      unique,
      defaultExpr,
      checkExpr,
      collate,
      generatedExpr
    };
  }

  private executeDrop(tokens: Token[]): void {
    this.loadedMaster = null;
    const kind = (tokens[1]?.value ?? "").toUpperCase();
    let idx = 2;
    let ifExists = false;
    if (tokens[idx]?.value.toUpperCase() === "IF" && tokens[idx + 1]?.value.toUpperCase() === "EXISTS") {
      ifExists = true;
      idx += 2;
    }
    if (tokens[idx + 1]?.value === ".") {
      idx += 2;
    }
    const name = tokens[idx]?.value ?? "";

    if (kind === "TABLE") {
      const tbl = this.findTable(name);
      if (!tbl) {
        if (ifExists) {
          return;
        }
        throw new Error(`no such table: ${name}`);
      }
      this.tables.delete(tbl.name);
      for (const [k, v] of this.indexes) {
        if (v.tableName.toLowerCase() === name.toLowerCase()) {
          this.indexes.delete(k);
        }
      }
      for (const [k, v] of this.triggers) {
        if (v.tableName.toLowerCase() === name.toLowerCase()) {
          this.triggers.delete(k);
        }
      }
    } else if (kind === "VIEW") {
      const v = this.findView(name);
      if (!v) {
        if (ifExists) {
          return;
        }
        throw new Error(`no such view: ${name}`);
      }
      this.views.delete(v.name);
    } else if (kind === "INDEX") {
      let found: string | undefined;
      for (const k of this.indexes.keys()) {
        if (k.toLowerCase() === name.toLowerCase()) {
          found = k;
        }
      }
      if (!found) {
        if (ifExists) {
          return;
        }
        throw new Error(`no such index: ${name}`);
      }
      this.indexes.delete(found);
    } else if (kind === "TRIGGER") {
      let found: string | undefined;
      for (const k of this.triggers.keys()) {
        if (k.toLowerCase() === name.toLowerCase()) {
          found = k;
        }
      }
      if (!found) {
        if (ifExists) {
          return;
        }
        throw new Error(`no such trigger: ${name}`);
      }
      this.triggers.delete(found);
    }
  }

  private *executeAlter(tokens: Token[]): SqlSteps<void> {
    this.loadedMaster = null;
    // ALTER TABLE name RENAME TO new_name | RENAME [COLUMN] old TO new | ADD [COLUMN] col_def | DROP [COLUMN] col
    let idx = 2;
    if (tokens[idx + 1]?.value === ".") {
      idx += 2;
    }
    const tblName = tokens[idx]?.value ?? "";
    const tbl = this.findTable(tblName);
    if (!tbl) {
      throw new Error(`no such table: ${tblName}`);
    }
    idx += 1;
    const action = (tokens[idx]?.value ?? "").toUpperCase();
    idx += 1;

    if (action === "RENAME") {
      if (tokens[idx]?.value.toUpperCase() === "TO") {
        const newName = tokens[idx + 1]?.value ?? "";
        this.tables.delete(tbl.name);
        tbl.name = newName;
        tbl.sql = tbl.sql.replace(new RegExp(`\\b${tblName}\\b`, "i"), newName);
        this.tables.set(newName, tbl);
        return;
      }
      if (tokens[idx]?.value.toUpperCase() === "COLUMN") {
        idx += 1;
      }
      const oldCol = tokens[idx]?.value ?? "";
      const newCol = tokens[idx + 2]?.value ?? "";
      const colObj = tbl.columns.find((c) => {
        return c.name.toLowerCase() === oldCol.toLowerCase();
      });
      if (!colObj) {
        throw new Error(`in prepare, no such column: "${oldCol}"`);
      }
      const realOld = colObj.name;
      colObj.name = newCol;
      for (const r of tbl.rows) {
        yield;
        r.data[newCol] = r.data[realOld] ?? null;
        delete r.data[realOld];
      }
      const newColRaw = tokens[idx + 2]?.raw ?? newCol;
      const schemaTokens = tokenizeSql(tbl.sql);
      let pDepth = 0;
      for (const tk of schemaTokens) {
        if (tk.value === "(") pDepth += 1;
        else if (tk.value === ")") pDepth -= 1;
        else if (pDepth >= 1 && tk.value.toLowerCase() === realOld.toLowerCase()) {
          tk.value = newCol;
          tk.raw = newColRaw;
          break;
        }
      }
      tbl.sql = reconstructTokensSql(schemaTokens);
      return;
    }

    if (action === "ADD") {
      if (tokens[idx]?.value.toUpperCase() === "COLUMN") {
        idx += 1;
      }
      const colDef = this.parseColumnDefTokens(tokens.slice(idx));
      tbl.columns.push(colDef);
      const defVal = colDef.defaultExpr
        ? yield* this.evalScalarSql(colDef.defaultExpr, {}, [])
        : null;
      for (const r of tbl.rows) {
        yield;
        r.data[colDef.name] = applyColumnAffinity(defVal, colDef.type, tbl.strict);
      }
      const schemaTokens = tokenizeSql(tbl.sql);
      const closingIndex = schemaTokens.map((token) => token.value).lastIndexOf(")");
      schemaTokens.splice(closingIndex, 0, ...tokenizeSql(","), ...tokens.slice(idx));
      tbl.sql = reconstructTokensSql(schemaTokens);
      return;
    }

    if (action === "DROP") {
      if (tokens[idx]?.value.toUpperCase() === "COLUMN") {
        idx += 1;
      }
      const dropCol = tokens[idx]?.value ?? "";
      const colIdx = tbl.columns.findIndex((c) => {
        return c.name.toLowerCase() === dropCol.toLowerCase();
      });
      if (colIdx === -1) {
        throw new Error(`in prepare, no such column: "${dropCol}"`);
      }
      const realName = tbl.columns[colIdx]!.name;
      tbl.columns.splice(colIdx, 1);
      for (const r of tbl.rows) {
        yield;
        delete r.data[realName];
      }
      const schemaTokens = tokenizeSql(tbl.sql);
      const openIdx = schemaTokens.findIndex((tk) => tk.value === "(");
      const closeIdx = schemaTokens.map((tk) => tk.value).lastIndexOf(")");
      if (openIdx !== -1 && closeIdx > openIdx) {
        const inner = schemaTokens.slice(openIdx + 1, closeIdx);
        const parts: typeof inner[] = [];
        let cur: typeof inner = [];
        let d = 0;
        for (const tk of inner) {
          if (tk.value === "(") d += 1;
          else if (tk.value === ")") d -= 1;
          if (d === 0 && tk.value === ",") {
            parts.push(cur);
            cur = [];
          } else {
            cur.push(tk);
          }
        }
        if (cur.length > 0) parts.push(cur);
        const kept = parts.filter((p) => (p[0]?.value ?? "").toLowerCase() !== realName.toLowerCase());
        const rebuiltInner: typeof inner = [];
        kept.forEach((p, idxP) => {
          if (idxP > 0) rebuiltInner.push(...tokenizeSql(","));
          rebuiltInner.push(...p);
        });
        tbl.sql = reconstructTokensSql([
          ...schemaTokens.slice(0, openIdx + 1),
          ...rebuiltInner,
          ...schemaTokens.slice(closeIdx),
        ]);
      }
    }
  }

  private *fireTriggers(
    tableName: string,
    timing: TriggerDef["timing"],
    event: TriggerDef["event"],
    oldRow?: Record<string, SqlValue>,
    newRow?: Record<string, SqlValue>
  ): SqlSteps<boolean> {
    for (const tr of this.triggers.values()) {
      yield;
      if (
        tr.tableName.toLowerCase() === tableName.toLowerCase() &&
        tr.timing === timing &&
        tr.event === event
      ) {
        const ctx: Record<string, SqlValue> = {};
        if (oldRow) {
          for (const [k, v] of Object.entries(oldRow)) {
            yield;
            ctx[`OLD.${k}`] = v;
            ctx[`old.${k}`] = v;
          }
        }
        if (newRow) {
          for (const [k, v] of Object.entries(newRow)) {
            yield;
            ctx[`NEW.${k}`] = v;
            ctx[`new.${k}`] = v;
          }
        }
        if (tr.whenExpr) {
          const cond = yield* this.evalExprSteps(parseExprSql(tr.whenExpr), ctx, []);
          if (!isTruthy(cond)) {
            continue;
          }
        }
        let body = tr.bodySql;
        // Substitute NEW.col and OLD.col references with SQL literals in trigger body
        body = body.replace(
          /\b(NEW|OLD)\.([A-Za-z0-9_]+)\b/gi,
          (_, prefix: string, col: string) => {
            const source = prefix.toUpperCase() === "NEW" ? newRow : oldRow;
            if (!source) {
              return "NULL";
            }
            const matchKey = Object.keys(source).find((k) => k.toLowerCase() === col.toLowerCase());
            const val = matchKey ? source[matchKey] : null;
            return this.toSqlLiteral(val ?? null);
          }
        );
        try {
          yield* this.execSteps(body);
        } catch (err) {
          if (timing === "BEFORE" && (err as { isRaiseIgnore?: boolean })?.isRaiseIgnore) {
            return false;
          }
          throw err;
        }
      }
    }
    return true;
  }

  private toSqlLiteral(val: SqlValue): string {
    if (val === null || val === undefined) {
      return "NULL";
    }
    if (typeof val === "number") {
      return String(val);
    }
    if (typeof val === "bigint") {
      return val.toString();
    }
    if (val instanceof Number) {
      const n = val.valueOf();
      return Number.isFinite(n) && Number.isInteger(n) ? `${n}.0` : String(n);
    }
    if (typeof val === "string" || val instanceof String) {
      return `'${String(val).replace(/'/g, "''")}'`;
    }
    let hex = "";
    for (const b of val as Uint8Array) {
      hex += b.toString(16).padStart(2, "0").toUpperCase();
    }
    return `X'${hex}'`;
  }

  private foreignKeyColumns(parent: TableDef, key: ForeignKeyDef): ColumnDef[] {
    const names = key.target.length ? key.target : parent.primaryKeyCols;
    const columns = names.map(name => parent.columns.find(column => column.name.toLowerCase() === name.toLowerCase()));
    const uniqueSets = [parent.primaryKeyCols, ...parent.uniqueColSets,
      ...[...this.indexes.values()].filter(index => index.unique && index.tableName.toLowerCase() === parent.name.toLowerCase()).map(index => index.columns)];
    if (names.length !== key.columns.length || columns.some(column => !column) || !uniqueSets.some(set =>
      set.length === names.length && set.every((name, i) => name.toLowerCase() === names[i]!.toLowerCase()))) {
      throw new Error(`foreign key mismatch - referencing ${parent.name}`);
    }
    return columns as ColumnDef[];
  }

  private foreignKeyMatches(child: TableDef, row: TableRow, key: ForeignKeyDef, columns: ColumnDef[], parent: Record<string, SqlValue>): boolean {
    return key.columns.every((name, i) => {
      const column = child.columns.find(column => column.name.toLowerCase() === name.toLowerCase());
      if (!column) throw new Error(`unknown column ${name} in foreign key definition`);
      const value = row.data[column.name] ?? null;
      const target = columns[i]!;
      return value !== null && sqlEquals(applyColumnAffinity(value, target.type, false), parent[target.name] ?? null, target.collate) === true;
    });
  }

  private *validateForeignKeys(before: SnapshotState, existingRows: Set<TableRow>): SqlSteps<void> {
    for (const child of this.tables.values()) {
      for (const key of child.foreignKeys ?? []) {
        yield;
        const parent = this.findTable(key.table);
        for (const row of child.rows) {
          yield;
          if (key.columns.some(name => {
            const column = child.columns.find(column => column.name.toLowerCase() === name.toLowerCase());
            return column && row.data[column.name] == null;
          })) continue;
          if (!parent) throw new Error(`no such table: ${key.table}`);
          const columns = this.foreignKeyColumns(parent, key);
          let found = false;
          for (const target of parent.rows) {
            yield;
            if (this.foreignKeyMatches(child, row, key, columns, target.data)) { found = true; break; }
          }
          if (!found) {
            // Enabling enforcement does not validate orphan rows written while it was off.
            const oldChild = before.tables.get(child.name);
            const oldRow = oldChild?.rows.find(old => old.rowid === row.rowid);
            const unchanged = existingRows.has(row) && oldRow && key.columns.every(name => {
              const column = child.columns.find(column => column.name.toLowerCase() === name.toLowerCase())!;
              return sqlEquals(oldRow.data[column.name] ?? null, row.data[column.name] ?? null) === true;
            });
            if (unchanged) {
              let previouslyValid = false;
              const oldParent = before.tables.get(parent.name);
              for (const target of oldParent?.rows ?? []) {
                yield;
                if (this.foreignKeyMatches(child, oldRow, key, columns, target.data)) { previouslyValid = true; break; }
              }
              if (!previouslyValid) continue;
            }
            throw new Error("FOREIGN KEY constraint failed");
          }
        }
      }
    }
  }

  private *applyForeignKeyActions(parent: TableDef, oldData: Record<string, SqlValue>, newData?: Record<string, SqlValue>): SqlSteps<void> {
    if (!this.foreignKeys) return;
    if (this.foreignKeyDepth > 100) throw new Error("too many levels of foreign key recursion");
    const quote = (name: string): string => '"' + name.split('"').join('""') + '"';
    for (const child of this.tables.values()) {
      for (const key of child.foreignKeys ?? []) {
        yield;
        if (key.table.toLowerCase() !== parent.name.toLowerCase()) continue;
        const columns = this.foreignKeyColumns(parent, key);
        if (newData && columns.every(column => sqlEquals(oldData[column.name] ?? null, newData[column.name] ?? null, column.collate) === true)) continue;
        const action = newData ? key.onUpdate : key.onDelete;
        if (action === "NO ACTION") continue;
        const matches: TableRow[] = [];
        for (const row of child.rows) {
          yield;
          if (this.foreignKeyMatches(child, row, key, columns, oldData)) matches.push(row);
        }
        if (action === "RESTRICT" && matches.length) throw new Error("FOREIGN KEY constraint failed");
        for (const row of matches) {
          yield;
          // Use ordinary writes so cascades obey constraints and fire triggers.
          const where = child.withoutRowId
            ? child.primaryKeyCols.map(name => `${quote(name)} IS ${this.toSqlLiteral(row.data[name] ?? null)}`).join(" AND ")
            : `rowid = ${row.rowid}`;
          if (action === "CASCADE" && !newData) {
            yield* this.executeStatementSteps(`DELETE FROM ${quote(child.name)} WHERE ${where}`);
          } else {
            const assignments = key.columns.map((name, i) => {
              const column = child.columns.find(column => column.name.toLowerCase() === name.toLowerCase())!;
              const value = action === "CASCADE" ? this.toSqlLiteral(newData![columns[i]!.name] ?? null)
                : action === "SET DEFAULT" ? column.defaultExpr ?? "NULL" : "NULL";
              return `${quote(name)} = ${value}`;
            });
            yield* this.executeStatementSteps(`UPDATE ${quote(child.name)} SET ${assignments.join(", ")} WHERE ${where}`);
          }
        }
      }
    }
  }

  private *checkConstraintsAndConflicts(
    tbl: TableDef,
    candidate: TableRow,
    excludeRowid?: number,
    replaceNotNull = false
  ): SqlSteps<TableRow | null> {
    // NOT NULL and CHECK constraints
    for (const col of tbl.columns) {
      yield;
      let val = candidate.data[col.name] ?? null;
      if (replaceNotNull && col.notNull && val === null && col.defaultExpr) {
        val = applyColumnAffinity(yield* this.evalScalarSql(col.defaultExpr, {}, []), col.type, tbl.strict);
        candidate.data[col.name] = val;
      }
      if (col.notNull && val === null) {
        if (col.primaryKey && col.type.toUpperCase() === "INTEGER" && !tbl.withoutRowId) {
          candidate.data[col.name] = candidate.rowid;
        } else {
          throw new SqliteConstraintError(`NOT NULL constraint failed: ${tbl.name}.${col.name}`);
        }
      }
      if (col.checkExpr && val !== null) {
        const ok = yield* this.evalExprSteps(parseExprSql(col.checkExpr), candidate.data, []);
        if (ok !== null && !isTruthy(ok)) {
          throw new SqliteConstraintError(`CHECK constraint failed: ${col.checkExpr}`);
        }
      }
    }

    // Check PRIMARY KEY and UNIQUE constraints against existing rows
    const keySets: string[][] = [];
    if (tbl.primaryKeyCols.length > 0) {
      keySets.push(tbl.primaryKeyCols);
    }
    for (const u of tbl.uniqueColSets) {
      yield;
      keySets.push(u);
    }
    const resolvedKeySets = yield* stepMap(keySets, function* (kSet) { yield;
      return kSet.map((colName) => {
        const realCol = tbl.columns.find((c) => {
          return c.name.toLowerCase() === colName.toLowerCase();
        });
        return { cKey: realCol ? realCol.name : colName, collate: realCol?.collate ?? "BINARY" };
      });
    }, this);

    // Table constraints and indexes have independent lifetimes and collations.
    for (const index of this.indexes.values()) {
      yield;
      if (index.unique && index.tableName.toLowerCase() === tbl.name.toLowerCase()) {
        resolvedKeySets.push(index.columns.map((cKey, i) => ({ cKey, collate: index.collations?.[i] ?? tbl.columns.find(col => col.name === cKey)?.collate ?? "BINARY" })));
      }
    }
    if (resolvedKeySets.length === 0 && candidate.rowid >= tbl.nextRowId) {
      return null;
    }
    const canUseFastIndex =
      excludeRowid === undefined &&
      tbl.rows.length > 32 &&
      resolvedKeySets.every((ks) => ks.every((k) => k.collate === "BINARY"));
    if (canUseFastIndex) {
      type FastIndex = {
        len: number;
        lastRow: TableRow | undefined;
        byRowid: Map<number, TableRow>;
        byKeySets: Map<string, TableRow>[];
      };
      const encodeKey = (row: TableRow, ks: { cKey: string }[]): string | null => {
        if (ks.length === 1) {
          const v = row.data[ks[0]!.cKey] ?? null;
          if (v === null) return null;
          return `${typeof v}:${String(v)}`;
        }
        const parts: string[] = [];
        for (const { cKey } of ks) {
          const v = row.data[cKey] ?? null;
          if (v === null) return null;
          parts.push(`${typeof v}:${String(v)}`);
        }
        return parts.join("\x1f");
      };
      const indexRow = (idx: FastIndex, row: TableRow) => {
        idx.byRowid.set(row.rowid, row);
        for (let i = 0; i < resolvedKeySets.length; i += 1) {
          const k = encodeKey(row, resolvedKeySets[i]!);
          if (k !== null) {
            idx.byKeySets[i]!.set(k, row);
          }
        }
      };
      let fastIdx = (tbl as unknown as { __fastConflictIndex?: FastIndex }).__fastConflictIndex;
      if (
        !fastIdx ||
        fastIdx.byKeySets.length !== resolvedKeySets.length ||
        (fastIdx.len !== tbl.rows.length &&
          !(fastIdx.len + 1 === tbl.rows.length && fastIdx.lastRow === tbl.rows[tbl.rows.length - 2]))
      ) {
        fastIdx = {
          len: tbl.rows.length,
          lastRow: tbl.rows[tbl.rows.length - 1],
          byRowid: new Map(),
          byKeySets: resolvedKeySets.map(() => new Map())
        };
        for (const r of tbl.rows) {
          indexRow(fastIdx, r);
        }
        (tbl as unknown as { __fastConflictIndex?: FastIndex }).__fastConflictIndex = fastIdx;
      } else if (fastIdx.len + 1 === tbl.rows.length) {
        const added = tbl.rows[tbl.rows.length - 1]!;
        indexRow(fastIdx, added);
        fastIdx.len = tbl.rows.length;
        fastIdx.lastRow = added;
      }
      const byId = fastIdx.byRowid.get(candidate.rowid);
      if (byId) return byId;
      for (let i = 0; i < resolvedKeySets.length; i += 1) {
        const k = encodeKey(candidate, resolvedKeySets[i]!);
        if (k !== null) {
          const hit = fastIdx.byKeySets[i]!.get(k);
          if (hit) return hit;
        }
      }
      return null;
    }

    for (const existing of tbl.rows) {
      yield;
      if (excludeRowid !== undefined && existing.rowid === excludeRowid) {
        continue;
      }
      if (existing.rowid === candidate.rowid) {
        return existing;
      }
      for (const kSet of resolvedKeySets) {
        yield;
        let allEqual = true;
        for (const { cKey, collate } of kSet) {
          yield;
          const v1 = candidate.data[cKey] ?? null;
          const v2 = existing.data[cKey] ?? null;
          if (v1 === null || v2 === null || !sqlEquals(v1, v2, collate)) {
            allEqual = false;
            break;
          }
        }
        if (allEqual) {
          return existing;
        }
      }
    }
    return null;
  }

  private synchronizeRowid(tbl: TableDef, candidate: TableRow, assigned: string[]): void {
    if (tbl.withoutRowId) return;
    const primary = tbl.columns.find(col => col.primaryKey && col.type.toUpperCase() === "INTEGER" && tbl.primaryKeyCols.length === 1);
    for (const name of assigned) {
      const column = tbl.columns.find(col => col.name.toLowerCase() === name.toLowerCase());
      if (column ? column !== primary : !["rowid", "_rowid_", "oid"].includes(name.toLowerCase())) continue;
      const key = column?.name ?? name;
      const value = candidate.data[key];
      if (value !== null && value !== undefined) {
        const number = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
        if (typeof number !== "number" || !Number.isSafeInteger(number)) throw new Error("datatype mismatch");
        candidate.rowid = number;
      }
      if (!column) delete candidate.data[key];
    }
    if (primary) candidate.data[primary.name] = candidate.rowid;
  }

  private *executeInsert(
    _sql: string,
    tokens: Token[],
    positionalParams: SqlValue[],
    cteScope: Map<string, { columns: string[]; rows: SqlValue[][] }>
  ): SqlSteps<QueryResultSet | null> {
    let idx = 0;
    let conflictAction: "ABORT" | "REPLACE" | "IGNORE" = "ABORT";
    if (tokens[idx]?.value.toUpperCase() === "REPLACE") {
      conflictAction = "REPLACE";
      idx += 1;
    } else {
      idx += 1; // INSERT
      if (tokens[idx]?.value.toUpperCase() === "OR") {
        const mode = (tokens[idx + 1]?.value ?? "").toUpperCase();
        if (mode === "REPLACE") {
          conflictAction = "REPLACE";
        } else if (mode === "IGNORE") {
          conflictAction = "IGNORE";
        }
        idx += 2;
      }
    }
    if (tokens[idx]?.value.toUpperCase() === "INTO") {
      idx += 1;
    }
    if (tokens[idx + 1]?.value === ".") {
      idx += 2;
    }
    const tableName = tokens[idx]?.value ?? "";
    idx += 1;

    const tbl = this.findTable(tableName);
    if (!tbl) {
      throw new Error(`no such table: ${tableName}`);
    }

    let alias: string | undefined;
    if (tokens[idx]?.value.toUpperCase() === "AS") {
      alias = tokens[idx + 1]?.value;
      if (!alias) throw new Error("near AS: syntax error");
      idx += 2;
    }

    let targetCols = tbl.columns.map((c) => {
      return c.name;
    });
    if (tokens[idx]?.value === "(") {
      targetCols = [];
      idx += 1;
      while (idx < tokens.length && tokens[idx]?.value !== ")") {
        yield;
        if (tokens[idx]!.value !== ",") {
          const cName = tokens[idx]!.value;
          const colMatch = tbl.columns.find((c) => {
            return c.name.toLowerCase() === cName.toLowerCase();
          });
          targetCols.push(colMatch ? colMatch.name : cName);
        }
        idx += 1;
      }
      idx += 1;
    }

    // Check RETURNING and ON CONFLICT clauses at tail
    let returningIdx = -1;
    let onConflictIdx = -1;
    let pDepth = 0;
    for (let i = idx; i < tokens.length; i += 1) {
      yield;
      if (tokens[i]!.value === "(") {
        pDepth += 1;
      } else if (tokens[i]!.value === ")") {
        pDepth -= 1;
      } else if (pDepth === 0) {
        const u = tokens[i]!.value.toUpperCase();
        if (u === "ON" && tokens[i + 1]?.value.toUpperCase() === "CONFLICT") {
          onConflictIdx = i;
        } else if (u === "RETURNING") {
          returningIdx = i;
        }
      }
    }

    const endValuesIdx =
      onConflictIdx !== -1 ? onConflictIdx : returningIdx !== -1 ? returningIdx : tokens.length;
    const valueRows: SqlValue[][] = [];

    if (
      tokens[idx]?.value.toUpperCase() === "DEFAULT" &&
      tokens[idx + 1]?.value.toUpperCase() === "VALUES"
    ) {
      valueRows.push([]);
      targetCols = [];
    } else if (tokens[idx]?.value.toUpperCase() === "VALUES") {
      idx += 1;
      while (idx < endValuesIdx) {
        yield;
        if (tokens[idx]?.value === "(") {
          idx += 1;
          const rowToks: Token[][] = [];
          let cur: Token[] = [];
          let d = 1;
          while (idx < endValuesIdx && d > 0) {
            yield;
            const t = tokens[idx++]!;
            if (t.value === "(") {
              d += 1;
              cur.push(t);
            } else if (t.value === ")") {
              d -= 1;
              if (d === 0) {
                rowToks.push(cur);
                break;
              }
              cur.push(t);
            } else if (t.value === "," && d === 1) {
              rowToks.push(cur);
              cur = [];
            } else {
              cur.push(t);
            }
          }
          const evaledRow = yield* stepMap(rowToks, function* (rt) {
            return yield* this.evalExprSteps(
              new ExprParser(rt).parseExpression(),
              {},
              positionalParams
            );
          }, this);
          valueRows.push(evaledRow);
        } else {
          idx += 1;
        }
      }
    } else {
      // INSERT INTO ... SELECT ...
      const selectRes = yield* this.executeSelectCompound(
        tokens.slice(idx, endValuesIdx),
        positionalParams,
        cteScope
      );
      for (const r of selectRes.rows) {
        yield;
        valueRows.push(r);
      }
    }

    // Parse ON CONFLICT clause if present
    let upsertDoNothing = false;
    let upsertSetPairs: { col: string; expr: ExprNode }[] = [];
    let upsertWhere: ExprNode | undefined;
    if (onConflictIdx !== -1) {
      let uIdx = onConflictIdx + 2;
      if (tokens[uIdx]?.value === "(") {
        while (uIdx < tokens.length && tokens[uIdx]?.value !== ")") {
          yield;
          uIdx += 1;
        }
        uIdx += 1;
      }
      if (tokens[uIdx]?.value.toUpperCase() === "WHERE") {
        while (uIdx < tokens.length && tokens[uIdx]?.value.toUpperCase() !== "DO") {
          yield;
          uIdx += 1;
        }
      }
      if (tokens[uIdx]?.value.toUpperCase() === "DO") {
        uIdx += 1;
        if (tokens[uIdx]?.value.toUpperCase() === "NOTHING") {
          upsertDoNothing = true;
        } else if (tokens[uIdx]?.value.toUpperCase() === "UPDATE") {
          uIdx += 2; // UPDATE SET
          const endUpsert = returningIdx !== -1 ? returningIdx : tokens.length;
          const parsedSet = this.parseSetAssignments(tokens.slice(uIdx, endUpsert));
          upsertSetPairs = parsedSet.assignments;
          upsertWhere = parsedSet.whereExpr;
        }
      }
    }

    const targetBindings = this.tableBindings(tbl, undefined, alias);
    const upsertBindings = { ...targetBindings };
    for (const column of tbl.columns) {
      yield;
      upsertBindings[`excluded.${column.name}`] = null;
    }
    for (const assignment of upsertSetPairs) {
      yield;
      yield* this.validateColumns(
        { kind: "column", name: assignment.col },
        targetBindings,
        positionalParams,
        cteScope
      );
      yield* this.validateColumns(assignment.expr, upsertBindings, positionalParams, cteScope);
    }
    yield* this.validateColumns(upsertWhere, upsertBindings, positionalParams, cteScope);

    let insertedCount = 0;
    const affectedRows: TableRow[] = [];

    for (const vRow of valueRows) {
      yield;
      const data: Record<string, SqlValue> = {};
      for (const col of tbl.columns) {
        yield;
        if (col.defaultExpr !== undefined) {
          data[col.name] = yield* this.evalScalarSql(col.defaultExpr, {}, positionalParams);
        } else {
          data[col.name] = null;
        }
      }

      for (let c = 0; c < targetCols.length; c += 1) {
        yield;
        data[targetCols[c]!] = vRow[c] ?? null;
      }

      for (const col of tbl.columns) {
        yield;
        data[col.name] = applyColumnAffinity(data[col.name] ?? null, col.type, tbl.strict);
      }

      // Determine rowid
      let rowid = tbl.nextRowId;
      for (const col of tbl.columns) {
        yield;
        if (col.autoIncrement) {
          rowid = Math.max(rowid, tbl.maxAutoInc + 1);
        }
        if (
          col.primaryKey &&
          col.type.toUpperCase() === "INTEGER" &&
          !tbl.withoutRowId &&
          tbl.primaryKeyCols.length === 1
        ) {
          const explicit = data[col.name];
          if (typeof explicit === "number" && Number.isInteger(explicit)) {
            rowid = explicit;
          } else if (explicit === null || explicit === undefined) {
            data[col.name] = rowid;
          }
        }
      }

      for (const col of tbl.columns) {
        yield;
        if (col.generatedExpr) {
          data[col.name] = applyColumnAffinity(
            yield* this.evalScalarSql(col.generatedExpr, data, positionalParams),
            col.type,
            tbl.strict
          );
        }
      }

      const candidate: TableRow = { rowid, data };
      this.synchronizeRowid(tbl, candidate, targetCols);
      rowid = candidate.rowid;
      if (!(yield* this.fireTriggers(tbl.name, "BEFORE", "INSERT", undefined, candidate.data))) {
        continue;
      }

      const conflictRow = yield* this.checkConstraintsAndConflicts(tbl, candidate);
      if (conflictRow) {
        if (upsertDoNothing || conflictAction === "IGNORE") {
          continue;
        }
        if (upsertSetPairs.length > 0) {
          const ctx = this.tableBindings(tbl, conflictRow, alias);
          for (const [k, v] of Object.entries(conflictRow.data)) {
            yield;
            ctx[`${tbl.name}.${k}`] = v;
          }
          for (const [k, v] of Object.entries(candidate.data)) {
            yield;
            ctx[`excluded.${k}`] = v;
            ctx[`EXCLUDED.${k}`] = v;
          }
          if (upsertWhere) {
            const cond = yield* this.evalExprSteps(upsertWhere, ctx, positionalParams);
            if (!isTruthy(cond)) {
              continue;
            }
          }
          const oldData = { ...conflictRow.data };
          const newData = { ...conflictRow.data };
          for (const assign of upsertSetPairs) {
            yield;
            const realCol = tbl.columns.find((c) => {
              return c.name.toLowerCase() === assign.col.toLowerCase();
            });
            const colKey = realCol ? realCol.name : assign.col;
            newData[colKey] = applyColumnAffinity(
              yield* this.evalExprSteps(assign.expr, ctx, positionalParams),
              realCol?.type ?? "",
              tbl.strict
            );
          }
          if (!(yield* this.fireTriggers(tbl.name, "BEFORE", "UPDATE", oldData, newData))) {
            continue;
          }
          conflictRow.data = newData;
          yield* this.applyForeignKeyActions(tbl, oldData, newData);
          yield* this.fireTriggers(tbl.name, "AFTER", "UPDATE", oldData, newData);
          insertedCount += 1;
          affectedRows.push(conflictRow);
          continue;
        }
        if (conflictAction === "REPLACE") {
          const idxToRemove = tbl.rows.indexOf(conflictRow);
          if (idxToRemove !== -1) {
            tbl.rows.splice(idxToRemove, 1);
            yield* this.applyForeignKeyActions(tbl, conflictRow.data);
          }
        } else {
          throw new Error(`UNIQUE constraint failed: ${tbl.name}`);
        }
      }

      tbl.rows.push(candidate);
      if (rowid >= tbl.nextRowId) {
        tbl.nextRowId = rowid + 1;
      }
      if (rowid > tbl.maxAutoInc) {
        tbl.maxAutoInc = rowid;
      }
      this.lastInsertRowid = rowid;
      insertedCount += 1;
      affectedRows.push(candidate);
      yield* this.fireTriggers(tbl.name, "AFTER", "INSERT", undefined, candidate.data);
    }

    this.lastChanges = insertedCount;
    this.totalChanges += insertedCount;

    if (returningIdx !== -1) {
      return yield* this.evaluateReturning(
        tbl,
        affectedRows,
        tokens.slice(returningIdx + 1),
        positionalParams,
        cteScope
      );
    }
    return null;
  }

  private parseSetAssignments(tokens: Token[]): {
    assignments: { col: string; expr: ExprNode }[];
    whereExpr?: ExprNode | undefined;
  } {
    const assignments: { col: string; expr: ExprNode }[] = [];
    let i = 0;
    let whereExpr: ExprNode | undefined;

    while (i < tokens.length) {
      if (tokens[i]!.value.toUpperCase() === "WHERE" || tokens[i]!.value.toUpperCase() === "FROM") {
        if (tokens[i]!.value.toUpperCase() === "WHERE") {
          whereExpr = new ExprParser(tokens.slice(i + 1)).parseExpression();
        }
        break;
      }
      if (tokens[i]!.value === "(") {
        // Multi-column assignment (c1, c2) = (e1, e2)
        const cols: string[] = [];
        i += 1;
        while (i < tokens.length && tokens[i]!.value !== ")") {
          if (tokens[i]!.value !== ",") {
            cols.push(tokens[i]!.value);
          }
          i += 1;
        }
        i += 2; // ) =
        if (tokens[i]?.value === "(") {
          i += 1;
          const exprs: ExprNode[] = [];
          let d = 1;
          let cur: Token[] = [];
          while (i < tokens.length && d > 0) {
            const t = tokens[i++]!;
            if (t.value === "(") {
              d += 1;
              cur.push(t);
            } else if (t.value === ")") {
              d -= 1;
              if (d === 0) {
                exprs.push(new ExprParser(cur).parseExpression());
                break;
              }
              cur.push(t);
            } else if (t.value === "," && d === 1) {
              exprs.push(new ExprParser(cur).parseExpression());
              cur = [];
            } else {
              cur.push(t);
            }
          }
          cols.forEach((c, idx) => {
            assignments.push({ col: c, expr: exprs[idx] ?? { kind: "literal", value: null } });
          });
        }
        if (tokens[i]?.value === ",") {
          i += 1;
        }
        continue;
      }

      const col = tokens[i]!.value;
      i += 2; // col =
      const exprToks: Token[] = [];
      let d = 0;
      while (i < tokens.length) {
        const t = tokens[i]!;
        if (t.value === "(") {
          d += 1;
        } else if (t.value === ")") {
          d -= 1;
        } else if (d === 0 && (t.value === "," || t.value.toUpperCase() === "WHERE" || t.value.toUpperCase() === "FROM")) {
          break;
        }
        exprToks.push(t);
        i += 1;
      }
      assignments.push({ col, expr: new ExprParser(exprToks).parseExpression() });
      if (tokens[i]?.value === ",") {
        i += 1;
      }
    }

    return { assignments, whereExpr };
  }

  private tableBindings(tbl: TableDef, row?: TableRow, alias?: string): Record<string, SqlValue> {
    const bindings: Record<string, SqlValue> = {};
    for (const column of [...tbl.columns.map((col) => col.name), "rowid", "_rowid_", "oid"]) {
      const value = row ? (Object.hasOwn(row.data, column) ? row.data[column]! : row.rowid) : null;
      bindings[column] = value;
      bindings[`${tbl.name}.${column}`] = value;
      if (alias) bindings[`${alias}.${column}`] = value;
    }
    return bindings;
  }

  private *executeUpdate(
    tokens: Token[],
    positionalParams: SqlValue[],
    _cteScope: Map<string, { columns: string[]; rows: SqlValue[][] }>
  ): SqlSteps<QueryResultSet | null> {
    let idx = 1;
    let conflictAction = "ABORT";
    if (tokens[idx]?.value.toUpperCase() === "OR") {
      conflictAction = tokens[idx + 1]?.value.toUpperCase() ?? "ABORT";
      idx += 2;
    }
    if (tokens[idx + 1]?.value === ".") {
      idx += 2;
    }
    const tableName = tokens[idx]?.value ?? "";
    idx += 1;
    const tbl = this.findTable(tableName);
    if (!tbl) {
      throw new Error(`no such table: ${tableName}`);
    }
    let alias: string | undefined;
    if (tokens[idx]?.value.toUpperCase() === "AS") idx += 1;
    if (tokens[idx]?.value.toUpperCase() !== "SET") alias = tokens[idx++]?.value;
    if (tokens[idx]?.value.toUpperCase() !== "SET") throw new Error("near UPDATE: syntax error");
    idx += 1;

    let returningIdx = -1;
    let pDepth = 0;
    for (let i = idx; i < tokens.length; i += 1) {
      yield;
      if (tokens[i]!.value === "(") {
        pDepth += 1;
      } else if (tokens[i]!.value === ")") {
        pDepth -= 1;
      } else if (pDepth === 0 && tokens[i]!.value.toUpperCase() === "RETURNING") {
        returningIdx = i;
        break;
      }
    }

    const sliceEnd = returningIdx !== -1 ? returningIdx : tokens.length;
    let fromIdx = -1;
    let whereIdx = sliceEnd;
    let depth = 0;
    for (let i = idx; i < sliceEnd; i += 1) {
      yield;
      const token = tokens[i]!.value.toUpperCase();
      if (token === "(") depth += 1;
      else if (token === ")") depth -= 1;
      else if (depth === 0 && token === "FROM") fromIdx = i;
      else if (depth === 0 && token === "WHERE") whereIdx = i;
    }
    const setTokens =
      fromIdx === -1
        ? tokens.slice(idx, sliceEnd)
        : [...tokens.slice(idx, fromIdx), ...tokens.slice(whereIdx, sliceEnd)];
    const { assignments, whereExpr } = this.parseSetAssignments(setTokens);
    const source =
      fromIdx === -1
        ? { rows: [{}], schema: [] }
        : yield* this.evaluateFromClause(
            tokens.slice(fromIdx + 1, whereIdx),
            positionalParams,
            _cteScope
          );
    const targetBindings = this.tableBindings(tbl, undefined, alias);
    const bindings = { ...targetBindings };
    for (const table of source.schema) {
      yield;
      for (const column of table.columns) {
        yield;
        bindings[column] = null;
        bindings[`${table.tableAlias}.${column}`] = null;
      }
    }
    for (const assignment of assignments) {
      yield;
      yield* this.validateColumns(
        { kind: "column", name: assignment.col },
        targetBindings,
        positionalParams,
        _cteScope
      );
      yield* this.validateColumns(assignment.expr, bindings, positionalParams, _cteScope);
    }
    yield* this.validateColumns(whereExpr, bindings, positionalParams, _cteScope);
    if (returningIdx !== -1)
      yield* this.evaluateReturning(
        tbl,
        [],
        tokens.slice(returningIdx + 1),
        positionalParams,
        _cteScope
      );

    let updated = 0;
    const affectedRows: TableRow[] = [];

    // Materialize matching contexts before writes, including self-joins.
    const matches = yield* stepFlatMap(tbl.rows, function* (row) {
      const target = this.tableBindings(tbl, row, alias);
      for (const other of source.rows) {
        yield;
        const ctx = { ...other, ...target };
        if (
          !whereExpr ||
          isTruthy(yield* this.evalExprSteps(whereExpr, ctx, positionalParams, _cteScope))
        )
          return [{ row, ctx }];
      }
      return [];
    }, this);
    const replacedRows = new Set<TableRow>();
    for (const { row, ctx } of matches) {
      yield;
      if (replacedRows.has(row)) continue;
      const oldData = { ...row.data };
      const newData = { ...row.data };
      for (const assign of assignments) {
        yield;
        const realCol = tbl.columns.find((c) => {
          return c.name.toLowerCase() === assign.col.toLowerCase();
        });
        const colKey = realCol ? realCol.name : assign.col;
        newData[colKey] = applyColumnAffinity(
          yield* this.evalExprSteps(assign.expr, ctx, positionalParams, _cteScope),
          realCol?.type ?? "",
          tbl.strict
        );
      }
      for (const col of tbl.columns) {
        yield;
        if (col.generatedExpr) {
          newData[col.name] = applyColumnAffinity(
            yield* this.evalScalarSql(col.generatedExpr, newData, positionalParams),
            col.type,
            tbl.strict
          );
        }
      }
      if (!(yield* this.fireTriggers(tbl.name, "BEFORE", "UPDATE", oldData, newData))) {
        continue;
      }
      const candidate: TableRow = { rowid: row.rowid, data: newData };
      this.synchronizeRowid(tbl, candidate, assignments.map(assignment => assignment.col));
      let conflict: TableRow | null;
      try {
        conflict = yield* this.checkConstraintsAndConflicts(tbl, candidate, row.rowid, conflictAction === "REPLACE");
      } catch (error) {
        if (conflictAction === "IGNORE" && error instanceof SqliteConstraintError) continue;
        throw error;
      }
      if (conflict && conflictAction === "IGNORE") continue;
      while (conflict) {
        if (conflictAction !== "REPLACE") throw new Error(`UNIQUE constraint failed: ${tbl.name}`);
        replacedRows.add(conflict);
        tbl.rows.splice(tbl.rows.indexOf(conflict), 1);
        yield* this.applyForeignKeyActions(tbl, conflict.data);
        conflict = yield* this.checkConstraintsAndConflicts(tbl, candidate, row.rowid);
      }
      row.data = newData;
      row.rowid = candidate.rowid;
      yield* this.applyForeignKeyActions(tbl, oldData, newData);
      tbl.nextRowId = Math.max(tbl.nextRowId, row.rowid + 1);
      tbl.maxAutoInc = Math.max(tbl.maxAutoInc, row.rowid);
      updated += 1;
      affectedRows.push(row);
      yield* this.fireTriggers(tbl.name, "AFTER", "UPDATE", oldData, newData);
    }

    this.lastChanges = updated;
    this.totalChanges += updated;

    if (returningIdx !== -1) {
      return yield* this.evaluateReturning(
        tbl,
        affectedRows,
        tokens.slice(returningIdx + 1),
        positionalParams,
        _cteScope
      );
    }
    return null;
  }

  private *executeDelete(
    tokens: Token[],
    positionalParams: SqlValue[],
    _cteScope: Map<string, { columns: string[]; rows: SqlValue[][] }>
  ): SqlSteps<QueryResultSet | null> {
    let idx = 1;
    if (tokens[idx]?.value.toUpperCase() === "FROM") {
      idx += 1;
    }
    if (tokens[idx + 1]?.value === ".") {
      idx += 2;
    }
    const tableName = tokens[idx]?.value ?? "";
    idx += 1;
    const tbl = this.findTable(tableName);
    if (!tbl) {
      throw new Error(`no such table: ${tableName}`);
    }

    let alias: string | undefined;
    if (tokens[idx]?.value.toUpperCase() === "AS") {
      idx += 1;
      alias = tokens[idx++]?.value;
      if (!alias) throw new Error("near AS: syntax error");
    } else if (tokens[idx] && !["WHERE", "RETURNING"].includes(tokens[idx]!.value.toUpperCase())) {
      alias = tokens[idx++]!.value;
    }
    if (tokens[idx] && !["WHERE", "RETURNING"].includes(tokens[idx]!.value.toUpperCase())) {
      throw new Error(`near ${tokens[idx]!.value}: syntax error`);
    }

    let returningIdx = -1;
    let pDepth = 0;
    for (let i = idx; i < tokens.length; i += 1) {
      yield;
      if (tokens[i]!.value === "(") {
        pDepth += 1;
      } else if (tokens[i]!.value === ")") {
        pDepth -= 1;
      } else if (pDepth === 0 && tokens[i]!.value.toUpperCase() === "RETURNING") {
        returningIdx = i;
        break;
      }
    }

    const sliceEnd = returningIdx !== -1 ? returningIdx : tokens.length;
    let whereExpr: ExprNode | undefined;
    if (idx < sliceEnd && tokens[idx]?.value.toUpperCase() === "WHERE") {
      whereExpr = new ExprParser(tokens.slice(idx + 1, sliceEnd)).parseExpression();
    }

    yield* this.validateColumns(
      whereExpr,
      this.tableBindings(tbl, undefined, alias),
      positionalParams,
      _cteScope
    );
    if (returningIdx !== -1)
      yield* this.evaluateReturning(
        tbl,
        [],
        tokens.slice(returningIdx + 1),
        positionalParams,
        _cteScope
      );

    const kept: TableRow[] = [];
    const deletedRows: TableRow[] = [];

    for (const row of tbl.rows) {
      yield;
      const ctx = this.tableBindings(tbl, row, alias);
      if (whereExpr) {
        const cond = yield* this.evalExprSteps(whereExpr, ctx, positionalParams, _cteScope);
        if (!isTruthy(cond)) {
          kept.push(row);
          continue;
        }
      }
      if (!(yield* this.fireTriggers(tbl.name, "BEFORE", "DELETE", row.data, undefined))) {
        kept.push(row);
        continue;
      }
      deletedRows.push(row);
      yield* this.fireTriggers(tbl.name, "AFTER", "DELETE", row.data, undefined);
    }

    tbl.rows = kept;
    for (const row of deletedRows) {
      yield;
      yield* this.applyForeignKeyActions(tbl, row.data);
    }
    this.lastChanges = deletedRows.length;
    this.totalChanges += deletedRows.length;

    if (returningIdx !== -1) {
      return yield* this.evaluateReturning(
        tbl,
        deletedRows,
        tokens.slice(returningIdx + 1),
        positionalParams,
        _cteScope
      );
    }
    return null;
  }

  private *evaluateReturning(
    tbl: TableDef,
    rows: TableRow[],
    returningTokens: Token[],
    positionalParams: SqlValue[],
    cteScope: Map<string, { columns: string[]; rows: SqlValue[][] }> = new Map()
  ): SqlSteps<QueryResultSet> {
    const items = this.splitTopLevelComma(returningTokens);
    const outCols: string[] = [];
    const exprs: ExprNode[] = [];
    for (const itemToks of items) {
      yield;
      if (itemToks.length === 1 && itemToks[0]!.value === "*") {
        for (const c of tbl.columns) {
          yield;
          outCols.push(c.name);
          exprs.push({ kind: "column", name: c.name });
        }
      } else {
        const { expr, alias } = this.parseSelectTarget(itemToks);
        outCols.push(alias);
        exprs.push(expr);
      }
    }
    const bindings = this.tableBindings(tbl);
    for (const expr of exprs) {
      yield;
      yield* this.validateColumns(expr, bindings, positionalParams, cteScope);
    }
    const outRows: SqlValue[][] = yield* stepMap(rows, function* (r) {
      const ctx = this.tableBindings(tbl, r);
      return yield* stepMap(exprs, function* (e) {
        return yield* this.evalExprSteps(e, ctx, positionalParams, cteScope);
      }, this);
    }, this);
    return { columns: outCols, rows: outRows };
  }

  private *executeWith(
    tokens: Token[],
    positionalParams: SqlValue[],
    outerCtes: Map<string, { columns: string[]; rows: SqlValue[][] }>
  ): SqlSteps<QueryResultSet | null> {
    const cteMap = new Map(outerCtes);
    let idx = 1;
    let isRecursive = false;
    if (tokens[idx]?.value.toUpperCase() === "RECURSIVE") {
      isRecursive = true;
      idx += 1;
    }

    while (idx < tokens.length) {
      yield;
      const cteName = tokens[idx]!.value;
      idx += 1;
      let explicitCols: string[] | undefined;
      if (tokens[idx]?.value === "(") {
        explicitCols = [];
        idx += 1;
        while (idx < tokens.length && tokens[idx]?.value !== ")") {
          yield;
          if (tokens[idx]!.value !== ",") {
            explicitCols.push(tokens[idx]!.value);
          }
          idx += 1;
        }
        idx += 1;
      }
      if (tokens[idx]?.value.toUpperCase() === "AS") {
        idx += 1;
      }
      if (
        tokens[idx]?.value.toUpperCase() === "NOT" &&
        tokens[idx + 1]?.value.toUpperCase() === "MATERIALIZED"
      ) {
        idx += 2;
      } else if (tokens[idx]?.value.toUpperCase() === "MATERIALIZED") {
        idx += 1;
      }

      if (tokens[idx]?.value !== "(") {
        break;
      }
      idx += 1;
      let depth = 1;
      const bodyTokens: Token[] = [];
      while (idx < tokens.length && depth > 0) {
        yield;
        const t = tokens[idx++]!;
        if (t.value === "(") {
          depth += 1;
        } else if (t.value === ")") {
          depth -= 1;
          if (depth === 0) {
            break;
          }
        }
        bodyTokens.push(t);
      }

      if (isRecursive && this.containsTokenWord(bodyTokens, cteName)) {
        const evaluated = yield* this.evalRecursiveCte(
          cteName,
          explicitCols,
          bodyTokens,
          positionalParams,
          cteMap
        );
        cteMap.set(cteName.toLowerCase(), evaluated);
      } else {
        const res = yield* this.executeSelectCompound(bodyTokens, positionalParams, cteMap);
        const cols = explicitCols && explicitCols.length > 0 ? explicitCols : res.columns;
        cteMap.set(cteName.toLowerCase(), { columns: cols, rows: res.rows });
      }

      if (tokens[idx]?.value === ",") {
        idx += 1;
      } else {
        break;
      }
    }

    const mainTokens = tokens.slice(idx);
    const mainSql = reconstructTokensSql(mainTokens);
    return yield* this.executeStatementSteps(mainSql, positionalParams, cteMap);
  }

  private containsTokenWord(tokens: Token[], word: string): boolean {
    const lower = word.toLowerCase();
    return tokens.some((t) => t.value.toLowerCase() === lower);
  }

  private *evalRecursiveCte(
    cteName: string,
    explicitCols: string[] | undefined,
    bodyTokens: Token[],
    positionalParams: SqlValue[],
    cteMap: Map<string, { columns: string[]; rows: SqlValue[][] }>
  ): SqlSteps<{ columns: string[]; rows: SqlValue[][] }> {
    // Split at top-level UNION / UNION ALL
    let d = 0;
    let unionIdx = -1;
    let unionAll = false;
    for (let i = 0; i < bodyTokens.length; i += 1) {
      yield;
      const t = bodyTokens[i]!;
      if (t.value === "(") {
        d += 1;
      } else if (t.value === ")") {
        d -= 1;
      } else if (d === 0 && t.type === "word" && t.value.toUpperCase() === "UNION") {
        unionIdx = i;
        unionAll = bodyTokens[i + 1]?.type === "word" && bodyTokens[i + 1]?.value.toUpperCase() === "ALL";
        break;
      }
    }

    if (unionIdx === -1) {
      const res = yield* this.executeSelectCompound(bodyTokens, positionalParams, cteMap);
      return { columns: explicitCols ?? res.columns, rows: res.rows };
    }

    const anchorTokens = bodyTokens.slice(0, unionIdx);
    const recTokens = bodyTokens.slice(unionIdx + (unionAll ? 2 : 1));

    const anchorRes = yield* this.executeSelectCompound(anchorTokens, positionalParams, cteMap);
    const cols = explicitCols && explicitCols.length > 0 ? explicitCols : anchorRes.columns;
    const scope = new Map(cteMap);
    scope.set(cteName.toLowerCase(), { columns: cols, rows: [] });
    const preparing = this.preparing;
    this.preparing = true;
    try {
      yield* this.executeSelectCompound(recTokens, positionalParams, scope);
    } finally {
      this.preparing = preparing;
    }
    if (this.preparing) return { columns: cols, rows: [] };
    this.checkRowCount(anchorRes.rows.length);
    const allRows: SqlValue[][] = [...anchorRes.rows];
    let workingRows: SqlValue[][] = [...anchorRes.rows];
    const seenKeys = new Set<string>();
    if (!unionAll) {
      for (const r of allRows) {
        yield;
        seenKeys.add(serializeSqlJson(r, false));
      }
    }

    const stepMap = new Map(cteMap);
    const cteKey = cteName.toLowerCase();
    while (workingRows.length > 0) {
      yield;
      stepMap.set(cteKey, { columns: cols, rows: workingRows });
      const nextRes = yield* this.executeSelectCompound(recTokens, positionalParams, stepMap);
      const nextWorking: SqlValue[][] = [];
      for (const r of nextRes.rows) {
        yield;
        if (!unionAll) {
          const k = serializeSqlJson(r, false);
          if (seenKeys.has(k)) {
            continue;
          }
          seenKeys.add(k);
        }
        this.checkRowCount(allRows.length + 1);
        allRows.push(r);
        nextWorking.push(r);
      }
      workingRows = nextWorking;
    }

    return { columns: cols, rows: allRows };
  }

  private readonly singleSelectCache = new WeakMap<
    Token[],
    {
      distinct: boolean;
      fromTokens: Token[] | undefined;
      whereExpr: ExprNode | undefined;
      groupByTokens: Token[] | undefined;
      havingTokens: Token[] | undefined;
      orderByTokens: Token[] | undefined;
      limitTokens: Token[] | undefined;
      targetItems: Token[][];
      staticTargets: { expr: ExprNode; alias: string }[] | undefined;
    }
  >();

  private *executeSelectCompound(
    tokens: Token[],
    positionalParams: SqlValue[],
    cteScope: Map<string, { columns: string[]; rows: SqlValue[][] }>
  ): SqlSteps<QueryResultSet> {
    if (tokens[0]?.value.toUpperCase() === "WITH") {
      return (
        (yield* this.executeWith(tokens, positionalParams, cteScope)) ?? {
          columns: [],
          rows: []
        }
      );
    }
    // Split by top-level UNION / UNION ALL / INTERSECT / EXCEPT
    // Note: ORDER BY and LIMIT at the very end apply to the entire compound query
    const segments: {
      op: "NONE" | "UNION" | "UNION ALL" | "INTERSECT" | "EXCEPT";
      tokens: Token[];
    }[] = [];
    let d = 0;
    let start = 0;
    let pendingOp: "NONE" | "UNION" | "UNION ALL" | "INTERSECT" | "EXCEPT" = "NONE";

    for (let i = 0; i < tokens.length; i += 1) {
      yield;
      const t = tokens[i]!;
      if (t.value === "(") {
        d += 1;
      } else if (t.value === ")") {
        d -= 1;
      } else if (d === 0 && t.type === "word") {
        const u = t.value.toUpperCase();
        if (u === "UNION" || u === "INTERSECT" || u === "EXCEPT") {
          segments.push({ op: pendingOp, tokens: tokens.slice(start, i) });
          if (u === "UNION" && tokens[i + 1]?.type === "word" && tokens[i + 1]?.value.toUpperCase() === "ALL") {
            pendingOp = "UNION ALL";
            i += 1;
          } else {
            pendingOp = u as "UNION" | "INTERSECT" | "EXCEPT";
          }
          start = i + 1;
        }
      }
    }

    if (segments.length === 0) {
      return yield* this.executeSingleSelect(tokens, positionalParams, cteScope);
    }

    // Check if the last segment has top-level ORDER BY / LIMIT
    const lastSegTokens = tokens.slice(start);
    let orderLimitStart = -1;
    d = 0;
    for (let i = 0; i < lastSegTokens.length; i += 1) {
      yield;
      const t = lastSegTokens[i]!;
      if (t.value === "(") {
        d += 1;
      } else if (t.value === ")") {
        d -= 1;
      } else if (d === 0 && t.type === "word") {
        const u = t.value.toUpperCase();
        if (
          (u === "ORDER" && lastSegTokens[i + 1]?.type === "word" && lastSegTokens[i + 1]?.value.toUpperCase() === "BY") ||
          u === "LIMIT"
        ) {
          orderLimitStart = i;
          break;
        }
      }
    }

    const tailClauses = orderLimitStart !== -1 ? lastSegTokens.slice(orderLimitStart) : [];
    const cleanLastTokens =
      orderLimitStart !== -1 ? lastSegTokens.slice(0, orderLimitStart) : lastSegTokens;
    segments.push({ op: pendingOp, tokens: cleanLastTokens });

    let acc: QueryResultSet = { columns: [], rows: [] };
    for (const seg of segments) {
      yield;
      const res = yield* this.executeSingleSelect(seg.tokens, positionalParams, cteScope);
      if (seg.op === "NONE") {
        acc = res;
      } else if (seg.op === "UNION ALL") {
        this.checkRowCount(acc.rows.length + res.rows.length);
        acc.rows.push(...res.rows);
      } else if (seg.op === "UNION") {
        const combined = [...acc.rows, ...res.rows];
        acc.rows = yield* this.deduplicateResultRows(combined);
      } else if (seg.op === "INTERSECT") {
        const rightSet = new Set(
          yield* stepMap(res.rows, function* (r) { yield;
            return serializeSqlJson(r, false);
          }, this)
        );
        acc.rows = yield* this.deduplicateResultRows(
          yield* stepFilter(acc.rows, function* (r) { yield;
            return rightSet.has(serializeSqlJson(r, false));
          }, this)
        );
      } else if (seg.op === "EXCEPT") {
        const rightSet = new Set(
          yield* stepMap(res.rows, function* (r) { yield;
            return serializeSqlJson(r, false);
          }, this)
        );
        acc.rows = yield* this.deduplicateResultRows(
          yield* stepFilter(acc.rows, function* (r) { yield;
            return !rightSet.has(serializeSqlJson(r, false));
          }, this)
        );
      }
    }

    if (tailClauses.length > 0) {
      // Apply ORDER BY / LIMIT on `acc` by wrapping in a temp CTE
      const tmpScope = new Map(cteScope);
      tmpScope.set("__compound_res__", acc);
      const wrapToks = tokenizeSql(
        `SELECT * FROM __compound_res__ ${reconstructTokensSql(tailClauses)}`
      );
      return yield* this.executeSingleSelect(wrapToks, positionalParams, tmpScope);
    }

    return acc;
  }

  private *deduplicateResultRows(rows: SqlValue[][]): SqlSteps<SqlValue[][]> {
    const out: SqlValue[][] = [];
    const seen = new Set<string>();
    for (const r of rows) {
      yield;
      const k = serializeSqlJson(r, false);
      if (!seen.has(k)) {
        seen.add(k);
        out.push(r);
      }
    }
    return out;
  }

  private *executeSingleSelect(
    tokens: Token[],
    positionalParams: SqlValue[],
    cteScope: Map<string, { columns: string[]; rows: SqlValue[][] }>
  ): SqlSteps<QueryResultSet> {
    if (tokens[0]?.value.toUpperCase() === "VALUES") {
      let idx = 1;
      const rows: SqlValue[][] = [];
      let maxCols = 0;
      while (idx < tokens.length) {
        yield;
        if (tokens[idx]?.value === "(") {
          idx += 1;
          const exprs: Token[][] = [];
          let cur: Token[] = [];
          let d = 1;
          while (idx < tokens.length && d > 0) {
            yield;
            const t = tokens[idx++]!;
            if (t.value === "(") {
              d += 1;
              cur.push(t);
            } else if (t.value === ")") {
              d -= 1;
              if (d === 0) {
                exprs.push(cur);
                break;
              }
              cur.push(t);
            } else if (t.value === "," && d === 1) {
              exprs.push(cur);
              cur = [];
            } else {
              cur.push(t);
            }
          }
          const r = yield* stepMap(exprs, function* (et) {
            return yield* this.evalExprSteps(
              new ExprParser(et).parseExpression(),
              {},
              positionalParams
            );
          }, this);
          maxCols = Math.max(maxCols, r.length);
          rows.push(r);
        } else {
          idx += 1;
        }
      }
      const columns = Array.from({ length: maxCols }, (_, i) => `column${i + 1}`);
      return { columns, rows };
    }

    // Parse SELECT clauses at depth 0
    let plan = this.singleSelectCache.get(tokens);
    if (!plan) {
      let idx = 1; // Skip SELECT
      let distinct = false;
      if (tokens[idx]?.value.toUpperCase() === "DISTINCT") {
        distinct = true;
        idx += 1;
      } else if (tokens[idx]?.value.toUpperCase() === "ALL") {
        idx += 1;
      }

      const clausePositions: { name: string; pos: number }[] = [];
      let d = 0;
      for (let i = idx; i < tokens.length; i += 1) {
        yield;
        const t = tokens[i]!;
        if (t.value === "(") {
          d += 1;
        } else if (t.value === ")") {
          d -= 1;
        } else if (d === 0 && t.type === "word") {
          const u = t.value.toUpperCase();
          if (u === "FROM" || u === "WHERE" || u === "HAVING" || u === "WINDOW" || u === "LIMIT") {
            clausePositions.push({ name: u, pos: i });
          } else if (u === "GROUP" && tokens[i + 1]?.value.toUpperCase() === "BY") {
            clausePositions.push({ name: "GROUP BY", pos: i });
            i += 1;
          } else if (u === "ORDER" && tokens[i + 1]?.value.toUpperCase() === "BY") {
            clausePositions.push({ name: "ORDER BY", pos: i });
            i += 1;
          }
        }
      }

      const selectEnd = clausePositions[0]?.pos ?? tokens.length;
      const selectListTokens = tokens.slice(idx, selectEnd);

      const getClauseTokens = (clauseName: string): Token[] | undefined => {
        const cIdx = clausePositions.findIndex((c) => c.name === clauseName);
        if (cIdx === -1) {
          return undefined;
        }
        const startTok = clausePositions[cIdx]!.pos + (clauseName.includes(" ") ? 2 : 1);
        const endTok = clausePositions[cIdx + 1]?.pos ?? tokens.length;
        return tokens.slice(startTok, endTok);
      };

      const fromTokens = getClauseTokens("FROM");
      const whereTokens = getClauseTokens("WHERE");
      const groupByTokens = getClauseTokens("GROUP BY");
      const havingTokens = getClauseTokens("HAVING");
      const orderByTokens = getClauseTokens("ORDER BY");
      const limitTokens = getClauseTokens("LIMIT");
      const whereExpr =
        whereTokens && whereTokens.length > 0
          ? new ExprParser(whereTokens).parseExpression()
          : undefined;
      const targetItems = this.splitTopLevelComma(selectListTokens);
      const hasWildcard = targetItems.some((itemToks) => {
        return (
          (itemToks.length === 1 && itemToks[0]!.value === "*") ||
          (itemToks.length === 3 && itemToks[1]!.value === "." && itemToks[2]!.value === "*")
        );
      });
      const staticTargets = hasWildcard
        ? undefined
        : targetItems.map((itemToks) => {
            return this.parseSelectTarget(itemToks);
          });
      plan = {
        distinct,
        fromTokens,
        whereExpr,
        groupByTokens,
        havingTokens,
        orderByTokens,
        limitTokens,
        targetItems,
        staticTargets
      };
      this.singleSelectCache.set(tokens, plan);
    }

    const {
      distinct,
      fromTokens,
      whereExpr,
      groupByTokens,
      havingTokens,
      orderByTokens,
      limitTokens,
      targetItems,
      staticTargets
    } = plan;

    // 1. Evaluate FROM & JOINs into row contexts
    let workingRows: Record<string, SqlValue>[] = [{}];
    let sourceSchema: { tableAlias: string; columns: string[]; ftsTable?: TableDef | undefined; hidden?: Set<string>; shared?: Set<string> }[] = [];

    if (fromTokens && fromTokens.length > 0) {
      const built = yield* this.evaluateFromClause(fromTokens, positionalParams, cteScope);
      workingRows = built.rows;
      sourceSchema = built.schema;
    }

    // Expand SELECT targets
    let selectTargets: { expr: ExprNode; alias: string }[];
    if (staticTargets) {
      selectTargets = staticTargets;
    } else {
      selectTargets = [];
      for (const itemToks of targetItems) {
        yield;
        if (itemToks.length === 1 && itemToks[0]!.value === "*") {
          for (const src of sourceSchema) {
            yield;
            for (const col of src.columns) {
              yield;
              if (src.hidden?.has(col.toLowerCase())) continue;
              selectTargets.push({
                expr: { kind: "column", table: src.shared?.has(col.toLowerCase()) ? undefined : src.tableAlias || undefined, name: col },
                alias: col
              });
            }
          }
        } else if (
          itemToks.length === 3 &&
          itemToks[1]!.value === "." &&
          itemToks[2]!.value === "*"
        ) {
          const tblAlias = itemToks[0]!.value;
          const src = sourceSchema.find((s) => {
            return s.tableAlias.toLowerCase() === tblAlias.toLowerCase();
          });
          if (src) {
            for (const col of src.columns) {
              yield;
              selectTargets.push({
                expr: { kind: "column", table: src.tableAlias, name: col },
                alias: col
              });
            }
          }
        } else {
          selectTargets.push(this.parseSelectTarget(itemToks));
        }
      }
    }

    // Resolve identifiers against the schema before evaluating any rows. This
    // catches errors in empty tables and branches that evaluation never visits.
    const bindings: Record<string, SqlValue> = {};
    const ftsBindings: Record<string, TableDef> = {};
    bindings.__fts = ftsBindings as unknown as SqlValue;
    for (const source of sourceSchema) {
      yield;
      if (source.ftsTable) ftsBindings[source.tableAlias] = source.ftsTable;
      for (const column of [...source.columns, "rowid", "_rowid_", "oid"]) {
        yield;
        bindings[column] = null;
        bindings[`${source.tableAlias}.${column}`] = null;
      }
    }
    for (const target of selectTargets) {
      yield;
      yield* this.validateColumns(target.expr, bindings, positionalParams, cteScope);
    }
    const aliasBindings = { ...bindings };
    for (const target of selectTargets) {
      yield;
      aliasBindings[target.alias] = null;
    }
    yield* this.validateColumns(whereExpr, aliasBindings, positionalParams, cteScope);
    for (const clause of [groupByTokens, havingTokens, orderByTokens]) {
      yield;
      if (clause) {
        for (const expression of this.splitTopLevelComma(clause)) {
          yield;
          yield* this.validateColumns(
            new ExprParser(expression).parseExpression(),
            aliasBindings,
            positionalParams,
            cteScope
          );
        }
      }
    }

    if (limitTokens) {
      let depth = 0;
      let start = 0;
      for (let i = 0; i <= limitTokens.length; i += 1) {
        yield;
        const token = limitTokens[i]?.value;
        if (token === "(") depth += 1;
        if (token === ")") depth -= 1;
        if (
          i === limitTokens.length ||
          (depth === 0 && (token === "," || token?.toUpperCase() === "OFFSET"))
        ) {
          yield* this.validateColumns(
            new ExprParser(limitTokens.slice(start, i)).parseExpression(),
            {},
            positionalParams,
            cteScope
          );
          start = i + 1;
        }
      }
    }

    if (this.preparing)
      return {
        columns: selectTargets.map((target) => {
          return target.alias;
        }),
        rows: []
      };

    // Evaluate WHERE after resolving identifiers
    if (whereExpr) {
      workingRows = yield* stepFilter(workingRows, function* (row) {
        return isTruthy(yield* this.evalExprSteps(whereExpr, row, positionalParams, cteScope));
      }, this);
    }

    // Check if query has aggregates or GROUP BY
    const hasGroupBy = Boolean(groupByTokens && groupByTokens.length > 0);
    const hasAggregateInSelect = selectTargets.some((t) => {
      return this.containsAggregate(t.expr);
    });
    const hasAggregateInHaving = havingTokens
      ? this.containsAggregate(new ExprParser(havingTokens).parseExpression())
      : false;
    const isAggregatedQuery = hasGroupBy || hasAggregateInSelect || hasAggregateInHaving;

    let groupedRows: {
      representative: Record<string, SqlValue>;
      group: Record<string, SqlValue>[];
    }[] = [];

    if (isAggregatedQuery) {
      if (hasGroupBy) {
        const groupExprs = this.splitTopLevelComma(groupByTokens!).map((gt) => {
          return new ExprParser(gt).parseExpression();
        });
        const groups = new Map<
          string,
          { representative: Record<string, SqlValue>; group: Record<string, SqlValue>[] }
        >();
        for (const row of workingRows) {
          yield;
          const keyVals = yield* stepMap(groupExprs, function* (ge) {
            if (
              ge.kind === "literal" &&
              typeof ge.value === "number" &&
              Number.isInteger(ge.value)
            ) {
              const idx1 = ge.value - 1;
              if (selectTargets[idx1]) {
                return yield* this.evalExprSteps(
                  selectTargets[idx1]!.expr,
                  row,
                  positionalParams,
                  cteScope
                );
              }
            }
            return yield* this.evalExprSteps(ge, row, positionalParams, cteScope);
          }, this);
          const keyStr = serializeSqlJson(
            keyVals.map((v) => {
              return [typeof v, v];
            }),
            false
          );
          const existing = groups.get(keyStr);
          if (existing) {
            existing.group.push(row);
          } else {
            groups.set(keyStr, { representative: row, group: [row] });
          }
        }
        groupedRows = Array.from(groups.values());
      } else {
        groupedRows = [{ representative: workingRows[0] ?? {}, group: workingRows }];
      }

      if (havingTokens && havingTokens.length > 0) {
        const havingExpr = new ExprParser(havingTokens).parseExpression();
        groupedRows = yield* stepFilter(groupedRows, function* (g) {
          // Provide select aliases in representative context
          const repCtx = { ...g.representative };
          for (const st of selectTargets) {
            yield;
            if (!(st.alias in repCtx)) {
              repCtx[st.alias] = yield* this.evalExprSteps(st.expr, g.representative, positionalParams, cteScope, { group: g.group });
            }
          }
          return isTruthy(
            yield* this.evalExprSteps(havingExpr, repCtx, positionalParams, cteScope, { group: g.group })
          );
        }, this);
      }
    } else {
      groupedRows = yield* stepMap(workingRows, function* (r, idx) { yield;
        workingRows[idx] = undefined as any;
        return { representative: r, group: [r] };
      }, this);
    }
    workingRows = [];

    // Evaluate window functions if any target has OVER (...)
    const windowResults = new Map<ExprNode, SqlValue[]>();
    for (const st of selectTargets) {
      yield;
      yield* this.collectWindowExprs(
        st.expr,
        groupedRows,
        positionalParams,
        cteScope,
        windowResults
      );
    }

    const firstWindowPeek = windowResults.keys().next().value;
    const needsPostProjectionCtx = Boolean(
      (orderByTokens && orderByTokens.length > 0) ||
      (!orderByTokens?.length && firstWindowPeek?.kind === "func" && firstWindowPeek.over)
    );
    const emptyCtx: Record<string, SqlValue> = {};
    const emptyGroup: Record<string, SqlValue>[] = [];

    // Build projection rows + augmented sort contexts
    let projected: {
      values: SqlValue[];
      ctx: Record<string, SqlValue>;
      group: Record<string, SqlValue>[];
    }[] = yield* stepMap(groupedRows, function* (g, rowIdx) {
      groupedRows[rowIdx] = undefined as any;
      const repCtx = g.representative;
      const values = yield* stepMap(selectTargets, function* (st) {
        const val = yield* this.evalExprSteps(
          st.expr, repCtx, positionalParams, cteScope,
          { group: g.group, window: { rowIdx: rowIdx, results: windowResults } }
        );
        if (!(st.alias in repCtx)) {
          repCtx[st.alias] = val;
        }
        return val;
      }, this);
      return {
        values,
        ctx: needsPostProjectionCtx ? repCtx : emptyCtx,
        group: needsPostProjectionCtx ? g.group : emptyGroup
      };
    }, this);
    groupedRows = [];

    // Match SQLite's first window traversal when no outer ordering overrides it.
    // Keep the original indices above so independent windows retain their values.
    const firstWindow = windowResults.keys().next().value;
    if (!orderByTokens?.length && firstWindow?.kind === "func" && firstWindow.over) {
      const sortSpecs = [
        ...firstWindow.over.partitionBy.map((expr) => ({ expr, desc: false })),
        ...firstWindow.over.orderBy
      ];
      if (sortSpecs.length > 0) {
        const keyed = yield* stepMap(projected, function* (row) {
          const keys = yield* stepMap(sortSpecs, function* (spec) {
            return yield* this.evalExprSteps(spec.expr, row.ctx, positionalParams, cteScope, { group: row.group });
          }, this);
          return { row, keys };
        }, this);
        yield* stepSort(keyed, function* (a, b) {
          for (let i = 0; i < sortSpecs.length; i++) {
            yield;
            const cmp = compareSqlValues(a.keys[i]!, b.keys[i]!);
            if (cmp !== 0) return sortSpecs[i]!.desc ? -cmp : cmp;
          }
          return 0;
        }, this);
        projected = yield* stepMap(keyed, function* (entry) { yield; return entry.row; }, this);
      }
    }

    // 4. Deduplicate if SELECT DISTINCT
    let finalProjected = projected;
    if (distinct) {
      const seen = new Set<string>();
      finalProjected = yield* stepFilter(projected, function* (p) { yield;
        const k = serializeSqlJson(p.values, false);
        if (seen.has(k)) {
          return false;
        }
        seen.add(k);
        return true;
      }, this);
    }

    // 5. Evaluate ORDER BY
    if (orderByTokens && orderByTokens.length > 0) {
      const orderSpecs = this.splitTopLevelComma(orderByTokens).map((ot) => {
        const p = new ExprParser(ot);
        const expr = p.parseExpression();
        let desc = false;
        let collation = "BINARY";
        if (expr.kind === "collate") {
          collation = expr.collation;
        }
        if (p.matchWord("DESC")) {
          desc = true;
        } else {
          p.matchWord("ASC");
        }
        let nulls: "FIRST" | "LAST" | undefined;
        if (p.matchWord("NULLS")) {
          if (p.matchWord("FIRST")) {
            nulls = "FIRST";
          } else if (p.matchWord("LAST")) {
            nulls = "LAST";
          }
        }
        return { expr, desc, nulls, collation };
      });

      yield* stepSort(finalProjected, function* (a, b) {
        for (const spec of orderSpecs) {
          yield;
          let vA: SqlValue;
          let vB: SqlValue;
          if (
            spec.expr.kind === "literal" &&
            typeof spec.expr.value === "number" &&
            Number.isInteger(spec.expr.value)
          ) {
            const colIdx = spec.expr.value - 1;
            vA = a.values[colIdx] ?? null;
            vB = b.values[colIdx] ?? null;
          } else {
            vA = yield* this.evalExprSteps(spec.expr, a.ctx, positionalParams, cteScope, { group: a.group });
            vB = yield* this.evalExprSteps(spec.expr, b.ctx, positionalParams, cteScope, { group: b.group });
          }

          if (vA === null && vB === null) {
            continue;
          }
          if (vA === null) {
            if (spec.nulls === "FIRST") {
              return -1;
            }
            if (spec.nulls === "LAST") {
              return 1;
            }
            return spec.desc ? 1 : -1;
          }
          if (vB === null) {
            if (spec.nulls === "FIRST") {
              return 1;
            }
            if (spec.nulls === "LAST") {
              return -1;
            }
            return spec.desc ? -1 : 1;
          }

          const cmp = compareSqlValues(vA, vB, spec.collation);
          if (cmp !== 0) {
            return spec.desc ? -cmp : cmp;
          }
        }
        return 0;
      }, this);
    }

    // 6. Evaluate LIMIT / OFFSET
    if (limitTokens && limitTokens.length > 0) {
      const offsetIdx = limitTokens.findIndex((t) => {
        return t.value.toUpperCase() === "OFFSET";
      });
      const commaIdx = limitTokens.findIndex((t) => {
        return t.value === ",";
      });
      let limitVal = -1;
      let offsetVal = 0;

      if (offsetIdx !== -1) {
        limitVal = Math.trunc(
          toSqlNumber(
            yield* this.evalExprSteps(
              new ExprParser(limitTokens.slice(0, offsetIdx)).parseExpression(),
              {},
              positionalParams
            )
          )
        );
        offsetVal = Math.trunc(
          toSqlNumber(
            yield* this.evalExprSteps(
              new ExprParser(limitTokens.slice(offsetIdx + 1)).parseExpression(),
              {},
              positionalParams
            )
          )
        );
      } else if (commaIdx !== -1) {
        // LIMIT offset, count
        offsetVal = Math.trunc(
          toSqlNumber(
            yield* this.evalExprSteps(
              new ExprParser(limitTokens.slice(0, commaIdx)).parseExpression(),
              {},
              positionalParams
            )
          )
        );
        limitVal = Math.trunc(
          toSqlNumber(
            yield* this.evalExprSteps(
              new ExprParser(limitTokens.slice(commaIdx + 1)).parseExpression(),
              {},
              positionalParams
            )
          )
        );
      } else {
        limitVal = Math.trunc(
          toSqlNumber(
            yield* this.evalExprSteps(
              new ExprParser(limitTokens).parseExpression(),
              {},
              positionalParams
            )
          )
        );
      }

      if (offsetVal > 0) {
        finalProjected = finalProjected.slice(offsetVal);
      }
      if (limitVal >= 0) {
        finalProjected = finalProjected.slice(0, limitVal);
      }
    }

    return {
      columns: selectTargets.map((t) => t.alias),
      rows: finalProjected.map((p) => p.values.map((value) => value instanceof String ? value.valueOf() : value))
    };
  }

  private *evaluateFromClause(
    fromTokens: Token[],
    positionalParams: SqlValue[],
    cteScope: Map<string, { columns: string[]; rows: SqlValue[][] }>
  ): SqlSteps<{
    rows: Record<string, SqlValue>[];
    schema: { tableAlias: string; columns: string[]; ftsTable?: TableDef | undefined; hidden?: Set<string>; shared?: Set<string> }[];
  }> {
    // Parse sequence of table sources and JOIN operators
    interface JoinItem {
      joinType: "INNER" | "LEFT" | "RIGHT" | "FULL" | "CROSS";
      natural: boolean;
      sourceTokens: Token[];
      onTokens?: Token[] | undefined;
      usingCols?: string[] | undefined;
    }

    const items: JoinItem[] = [];
    let i = 0;

    const consumeJoinSource = (): Token[] => {
      const src: Token[] = [];
      let d = 0;
      while (i < fromTokens.length) {
        const t = fromTokens[i]!;
        if (t.value === "(") {
          d += 1;
        } else if (t.value === ")") {
          d -= 1;
        } else if (d === 0) {
          const u = t.type === "word" ? t.value.toUpperCase() : "";
          if (
            t.value === "," ||
            u === "JOIN" ||
            u === "INNER" ||
            u === "LEFT" ||
            u === "RIGHT" ||
            u === "FULL" ||
            u === "CROSS" ||
            u === "NATURAL" ||
            u === "ON" ||
            u === "USING"
          ) {
            break;
          }
        }
        src.push(t);
        i += 1;
      }
      return src;
    };

    const consumeCondition = (): { onTokens?: Token[]; usingCols?: string[] } => {
      if (fromTokens[i]?.type === "word" && fromTokens[i]?.value.toUpperCase() === "ON") {
        i += 1;
        const onToks: Token[] = [];
        let d = 0;
        while (i < fromTokens.length) {
          const t = fromTokens[i]!;
          if (t.value === "(") {
            d += 1;
          } else if (t.value === ")") {
            d -= 1;
          } else if (d === 0) {
            const u = t.type === "word" ? t.value.toUpperCase() : "";
            if (
              t.value === "," ||
              u === "JOIN" ||
              u === "INNER" ||
              u === "LEFT" ||
              u === "RIGHT" ||
              u === "FULL" ||
              u === "CROSS" ||
              u === "NATURAL"
            ) {
              break;
            }
          }
          onToks.push(t);
          i += 1;
        }
        return { onTokens: onToks };
      }
      if (fromTokens[i]?.type === "word" && fromTokens[i]?.value.toUpperCase() === "USING") {
        i += 1;
        const usingCols: string[] = [];
        if (fromTokens[i]?.value === "(") {
          i += 1;
          while (i < fromTokens.length && fromTokens[i]?.value !== ")") {
            if (fromTokens[i]!.value !== ",") {
              usingCols.push(fromTokens[i]!.value);
            }
            i += 1;
          }
          i += 1;
        }
        return { usingCols };
      }
      return {};
    };

    const firstSrc = consumeJoinSource();
    items.push({ joinType: "INNER", natural: false, sourceTokens: firstSrc });

    while (i < fromTokens.length) {
      yield;
      let joinType: JoinItem["joinType"] = "INNER";
      let natural = false;
      if (fromTokens[i]?.value === ",") {
        joinType = "CROSS";
        i += 1;
      } else {
        while (i < fromTokens.length) {
          yield;
          const u = fromTokens[i]!.type === "word" ? fromTokens[i]!.value.toUpperCase() : "";
          if (u === "NATURAL") {
            natural = true;
            i += 1;
          } else if (u === "LEFT") {
            joinType = "LEFT";
            i += 1;
          } else if (u === "RIGHT") {
            joinType = "RIGHT";
            i += 1;
          } else if (u === "FULL") {
            joinType = "FULL";
            i += 1;
          } else if (u === "CROSS") {
            joinType = "CROSS";
            i += 1;
          } else if (u === "INNER" || u === "OUTER") {
            i += 1;
          } else if (u === "JOIN") {
            i += 1;
            break;
          } else {
            break;
          }
        }
      }

      const src = consumeJoinSource();
      const cond = consumeCondition();
      items.push({
        joinType,
        natural,
        sourceTokens: src,
        onTokens: cond.onTokens,
        usingCols: cond.usingCols
      });
    }

    let currentRows: Record<string, SqlValue>[] = [];
    const schema: { tableAlias: string; columns: string[]; ftsTable?: TableDef | undefined; hidden?: Set<string>; shared?: Set<string> }[] = [];

    for (let itemIdx = 0; itemIdx < items.length; itemIdx += 1) {
      yield;
      const item = items[itemIdx]!;
      const preparationScope: Record<string, SqlValue> = {};
      if (this.preparing || currentRows.length === 0) {
        for (const source of schema) {
          yield;
          for (const column of [...source.columns, "rowid", "_rowid_", "oid"]) {
            yield;
            preparationScope[column] = null;
            preparationScope[`${source.tableAlias}.${column}`] = null;
          }
        }
      }
      const resolved = yield* this.resolveSingleTableSource(
        item.sourceTokens,
        this.preparing || currentRows.length === 0 ? [preparationScope] : currentRows,
        positionalParams,
        cteScope,
        itemIdx > 0 && currentRows.length === 0
      );
      const prevCols = new Set(
        yield* stepFlatMap(schema, function* (s) { yield;
          return s.columns.map((c) => {
            return c.toLowerCase();
          });
        }, this)
      );
      schema.push({ tableAlias: resolved.alias, columns: resolved.columns, ftsTable: resolved.ftsTable });

      if (itemIdx === 0) {
        currentRows = resolved.rows;
        continue;
      }

      // Perform join between currentRows and resolved
      const nextRows: Record<string, SqlValue>[] = [];
      const onExpr = item.onTokens ? new ExprParser(item.onTokens).parseExpression() : undefined;
      const joinBindings: Record<string, SqlValue> = {};
      for (const source of schema) {
        yield;
        for (const column of [...source.columns, "rowid", "_rowid_", "oid"]) {
          yield;
          joinBindings[column] = null;
          joinBindings[`${source.tableAlias}.${column}`] = null;
        }
      }
      yield* this.validateColumns(onExpr, joinBindings, positionalParams, cteScope);
      const usingList = item.natural
        ? yield* stepFilter(resolved.columns, function* (c) { yield;
            return prevCols.has(c.toLowerCase());
          }, this)
        : item.usingCols;

      if (usingList) {
        const shared = new Set(usingList.map((column) => column.toLowerCase()));
        schema[schema.length - 1]!.hidden = shared;
        for (const source of schema) {
          source.shared = new Set([...(source.shared ?? []), ...shared]);
        }
      }
      const rightMatched = new Set<number>();

      // Build O(1) hash index when joining on column equality (ON a.k = b.k or USING (k))
      let equiJoinSpec: {
        leftTable: string | undefined;
        leftCol: string;
        rightTable: string | undefined;
        rightCol: string;
        isPureSingleEqui: boolean;
      } | undefined;
      const rightAliasLower = resolved.alias.toLowerCase();
      const rightColSet = new Set(resolved.columns.map((c) => c.toLowerCase()));
      const leftAliasSet = new Set(schema.slice(0, -1).map((s) => s.tableAlias.toLowerCase()));

      const classifyJoinCol = (colExpr: Extract<ExprNode, { kind: "column" }>): "left" | "right" | undefined => {
        if (colExpr.table) {
          const tLower = colExpr.table.toLowerCase();
          if (tLower === rightAliasLower) return "right";
          if (leftAliasSet.has(tLower)) return "left";
          return undefined;
        }
        const cLower = colExpr.name.toLowerCase();
        const inLeft = prevCols.has(cLower);
        const inRight = rightColSet.has(cLower);
        if (inLeft && !inRight) return "left";
        if (inRight && !inLeft) return "right";
        return undefined;
      };

      const findEquiPair = (expr: ExprNode | undefined, topLevel: boolean): void => {
        if (!expr || equiJoinSpec) return;
        if (expr.kind === "binary" && expr.op === "=" && expr.left.kind === "column" && expr.right.kind === "column") {
          const sideA = classifyJoinCol(expr.left);
          const sideB = classifyJoinCol(expr.right);
          if (sideA === "left" && sideB === "right") {
            equiJoinSpec = {
              leftTable: expr.left.table,
              leftCol: expr.left.name,
              rightTable: expr.right.table ?? resolved.alias,
              rightCol: expr.right.name,
              isPureSingleEqui: topLevel
            };
          } else if (sideA === "right" && sideB === "left") {
            equiJoinSpec = {
              leftTable: expr.right.table,
              leftCol: expr.right.name,
              rightTable: expr.left.table ?? resolved.alias,
              rightCol: expr.left.name,
              isPureSingleEqui: topLevel
            };
          }
        } else if (expr.kind === "binary" && expr.op === "AND") {
          findEquiPair(expr.left, false);
          findEquiPair(expr.right, false);
        }
      };

      if (!resolved.isCorrelated) {
        if (onExpr) {
          findEquiPair(onExpr, true);
        } else if (usingList && usingList.length > 0) {
          equiJoinSpec = {
            leftTable: undefined,
            leftCol: usingList[0]!,
            rightTable: resolved.alias,
            rightCol: usingList[0]!,
            isPureSingleEqui: usingList.length === 1
          };
        }
      }

      const getHashJoinKeys = (val: SqlValue): string[] => {
        if (val === null || val === undefined) return [];
        if (typeof val === "number") {
          return ["num:" + String(Object.is(val, -0) ? 0 : val)];
        }
        if (typeof val === "string") {
          const trimmed = val.trim();
          const num = trimmed !== "" ? Number(trimmed) : NaN;
          if (!Number.isNaN(num)) {
            return ["str:" + val, "num:" + String(Object.is(num, -0) ? 0 : num)];
          }
          return ["str:" + val];
        }
        return ["other:" + String(val)];
      };

      let rightHashIndex: Map<string, number[]> | undefined;
      if (equiJoinSpec && resolved.rows.length > 0) {
        rightHashIndex = new Map<string, number[]>();
        for (let rIdx = 0; rIdx < resolved.rows.length; rIdx += 1) {
          const rVal = this.lookupColInRow(resolved.rows[rIdx]!, equiJoinSpec.rightTable, equiJoinSpec.rightCol);
          for (const key of getHashJoinKeys(rVal)) {
            let bucket = rightHashIndex.get(key);
            if (!bucket) {
              bucket = [];
              rightHashIndex.set(key, bucket);
            }
            bucket.push(rIdx);
          }
        }
      }

      for (let lIdx = 0; lIdx < currentRows.length; lIdx += 1) {
        const leftRow = currentRows[lIdx]!;
        currentRows[lIdx] = undefined as any;
        yield;
        const candidateRightRows = resolved.isCorrelated
          ? (yield* this.resolveSingleTableSource(
              item.sourceTokens,
              [leftRow],
              positionalParams,
              cteScope
            )).rows
          : resolved.rows;

        let matchedLeft = false;
        let candidateIndices: readonly number[] | undefined;
        let leftEquiVal: SqlValue = null;
        if (rightHashIndex && equiJoinSpec) {
          leftEquiVal = this.lookupColInRow(leftRow, equiJoinSpec.leftTable, equiJoinSpec.leftCol);
          const probeKeys = getHashJoinKeys(leftEquiVal);
          if (probeKeys.length === 0) {
            candidateIndices = [];
          } else if (probeKeys.length === 1) {
            candidateIndices = rightHashIndex.get(probeKeys[0]!) ?? [];
          } else {
            const seen = new Set<number>();
            for (const pk of probeKeys) {
              const bucket = rightHashIndex.get(pk);
              if (bucket) {
                for (const idx of bucket) seen.add(idx);
              }
            }
            candidateIndices = [...seen];
          }
        }

        const totalCandidates = candidateIndices ? candidateIndices.length : candidateRightRows.length;
        for (let cPos = 0; cPos < totalCandidates; cPos += 1) {
          yield;
          const rIdx = candidateIndices ? candidateIndices[cPos]! : cPos;
          const rightRow = candidateRightRows[rIdx]!;

          if (equiJoinSpec) {
            const rVal = this.lookupColInRow(rightRow, equiJoinSpec.rightTable, equiJoinSpec.rightCol);
            if (leftEquiVal === null || rVal === null || !sqlEquals(leftEquiVal, rVal)) {
              continue;
            }
          }

          const canMutateInPlace =
            !matchedLeft &&
            totalCandidates === 1 &&
            Boolean(equiJoinSpec && equiJoinSpec.isPureSingleEqui);
          let merged: Record<string, SqlValue>;
          const lTables = (leftRow as any).__tables as Record<string, Record<string, SqlValue>> | undefined;
          const rTables = (rightRow as any).__tables as Record<string, Record<string, SqlValue>> | undefined;
          if (lTables && rTables) {
            if (canMutateInPlace) {
              Object.assign(lTables, rTables);
              if ((leftRow as any).__rowids && (rightRow as any).__rowids) {
                Object.assign((leftRow as any).__rowids, (rightRow as any).__rowids);
              }
              ((leftRow as any).__sources as Record<string, SqlValue>[]).push(...((rightRow as any).__sources ?? []));
              merged = leftRow;
            } else {
              merged = {
                __rowid: (leftRow as any).__rowid,
                __tables: { ...lTables, ...rTables },
                __rowids: { ...(leftRow as any).__rowids, ...(rightRow as any).__rowids },
                __sources: [...((leftRow as any).__sources ?? []), ...((rightRow as any).__sources ?? [])]
              } as unknown as Record<string, SqlValue>;
            }
          } else {
            merged = canMutateInPlace ? leftRow : { ...leftRow };
            if (lTables && !canMutateInPlace) {
              (merged as any).__tables = { ...lTables };
              (merged as any).__rowids = { ...(leftRow as any).__rowids };
              (merged as any).__sources = [...((leftRow as any).__sources ?? [])];
            }
            if (rTables) {
              (merged as any).__tables = { ...((merged as any).__tables ?? {}), ...rTables };
              (merged as any).__rowids = { ...((merged as any).__rowids ?? {}), ...(rightRow as any).__rowids };
              (merged as any).__sources = [...((merged as any).__sources ?? []), ...((rightRow as any).__sources ?? [])];
            }
            for (const k in rightRow) {
              if (k.startsWith("__")) continue;
              const v = rightRow[k]!;
              if (k.includes(".") || !(k in merged) || merged[k] === null) {
                merged[k] = v;
              }
            }
          }

          let matches = true;
          if (onExpr && !(equiJoinSpec && equiJoinSpec.isPureSingleEqui)) {
            matches = isTruthy(
              yield* this.evalExprSteps(onExpr, merged, positionalParams, cteScope)
            );
          } else if (usingList && usingList.length > 0 && !(equiJoinSpec && equiJoinSpec.isPureSingleEqui)) {
            for (const uCol of usingList) {
              yield;
              const lVal = this.lookupColInRow(leftRow, undefined, uCol);
              const rVal = this.lookupColInRow(rightRow, resolved.alias, uCol);
              if (lVal === null || rVal === null || !sqlEquals(lVal, rVal)) {
                matches = false;
                break;
              }
            }
          }

          if (matches) {
            matchedLeft = true;
            rightMatched.add(rIdx);
            this.checkRowCount(nextRows.length + 1);
            nextRows.push(merged);
          }
        }

        if (!matchedLeft && (item.joinType === "LEFT" || item.joinType === "FULL")) {
          const nullObj: Record<string, SqlValue> = {};
          for (const col of resolved.columns) {
            nullObj[col] = null;
          }
          const lTables = (leftRow as any).__tables as Record<string, Record<string, SqlValue>> | undefined;
          if (lTables) {
            lTables[resolved.alias] = nullObj;
            if ((leftRow as any).__rowids) (leftRow as any).__rowids[resolved.alias] = null;
            ((leftRow as any).__sources as Record<string, SqlValue>[]).push(nullObj);
            this.checkRowCount(nextRows.length + 1);
            nextRows.push(leftRow);
          } else {
            const nullPadded: Record<string, SqlValue> = { ...leftRow };
            for (const col of resolved.columns) {
              yield;
              nullPadded[`${resolved.alias}.${col}`] = null;
              if (!(col in nullPadded)) {
                nullPadded[col] = null;
              }
            }
            this.checkRowCount(nextRows.length + 1);
            nextRows.push(nullPadded);
          }
        }
      }

      if (item.joinType === "RIGHT" || item.joinType === "FULL") {
        for (let rIdx = 0; rIdx < resolved.rows.length; rIdx += 1) {
          yield;
          if (!rightMatched.has(rIdx)) {
            const rightRow = resolved.rows[rIdx]!;
            const rTables = (rightRow as any).__tables as Record<string, Record<string, SqlValue>> | undefined;
            if (rTables) {
              const tablesMap: Record<string, Record<string, SqlValue>> = {};
              const rowidsMap: Record<string, SqlValue> = {};
              const sourcesList: Record<string, SqlValue>[] = [];
              for (const s of schema.slice(0, -1)) {
                const nullLeft: Record<string, SqlValue> = {};
                for (const col of s.columns) {
                  nullLeft[col] = null;
                }
                tablesMap[s.tableAlias] = nullLeft;
                rowidsMap[s.tableAlias] = null;
                sourcesList.push(nullLeft);
              }
              Object.assign(tablesMap, rTables);
              if ((rightRow as any).__rowids) Object.assign(rowidsMap, (rightRow as any).__rowids);
              sourcesList.push(...((rightRow as any).__sources ?? []));
              this.checkRowCount(nextRows.length + 1);
              nextRows.push({
                __rowid: (rightRow as any).__rowid ?? null,
                __tables: tablesMap,
                __rowids: rowidsMap,
                __sources: sourcesList
              } as unknown as Record<string, SqlValue>);
            } else {
              const nullPadded: Record<string, SqlValue> = {};
              for (const s of schema.slice(0, -1)) {
                yield;
                for (const col of s.columns) {
                  yield;
                  nullPadded[`${s.tableAlias}.${col}`] = null;
                  nullPadded[col] = null;
                }
              }
              Object.assign(nullPadded, rightRow);
              this.checkRowCount(nextRows.length + 1);
              nextRows.push(nullPadded);
            }
          }
        }
      }

      currentRows = nextRows;
    }

    return { rows: currentRows, schema };
  }

  private *resolveSingleTableSource(
    srcTokens: Token[],
    outerRows: Record<string, SqlValue>[],
    positionalParams: SqlValue[],
    cteScope: Map<string, { columns: string[]; rows: SqlValue[][] }>,
    prepareTvf = false
  ): SqlSteps<{
    alias: string;
    columns: string[];
    rows: Record<string, SqlValue>[];
    isCorrelated?: boolean;
    ftsTable?: TableDef | undefined;
  }> {
    if (srcTokens.length === 0) {
      return { alias: "", columns: [], rows: [{}] };
    }

    // Subquery in FROM: (SELECT ...) [AS] alias
    if (srcTokens[0]!.value === "(") {
      let d = 1;
      let p = 1;
      const inner: Token[] = [];
      while (p < srcTokens.length && d > 0) {
        yield;
        const t = srcTokens[p++]!;
        if (t.value === "(") {
          d += 1;
        } else if (t.value === ")") {
          d -= 1;
          if (d === 0) {
            break;
          }
        }
        inner.push(t);
      }
      if (srcTokens[p]?.value.toUpperCase() === "AS") {
        p += 1;
      }
      const alias = srcTokens[p]?.value ?? "subquery";
      const res = (yield* this.executeStatementSteps(
        reconstructTokensSql(inner),
        positionalParams,
        cteScope
      )) ?? {
        columns: [],
        rows: []
      };
      const rows = yield* stepMap(res.rows, function* (r) { yield;
        const obj: Record<string, SqlValue> = {};
        res.columns.forEach((c, idx) => {
          obj[c] = r[idx] ?? null;
          obj[`${alias}.${c}`] = r[idx] ?? null;
        });
        return obj;
      }, this);
      return { alias, columns: res.columns, rows };
    }

    let idx = 0;
    if (srcTokens[idx + 1]?.value === ".") {
      idx += 2;
    }
    const name = srcTokens[idx]!.value;
    idx += 1;

    // Table-valued function: json_each(...), json_tree(...), generate_series(...)
    if (srcTokens[idx]?.value === "(") {
      idx += 1;
      const argToks: Token[][] = [];
      let cur: Token[] = [];
      let d = 1;
      while (idx < srcTokens.length && d > 0) {
        yield;
        const t = srcTokens[idx++]!;
        if (t.value === "(") {
          d += 1;
          cur.push(t);
        } else if (t.value === ")") {
          d -= 1;
          if (d === 0) {
            if (cur.length > 0) {
              argToks.push(cur);
            }
            break;
          }
          cur.push(t);
        } else if (t.value === "," && d === 1) {
          argToks.push(cur);
          cur = [];
        } else {
          cur.push(t);
        }
      }
      if (srcTokens[idx]?.value.toUpperCase() === "AS") {
        idx += 1;
      }
      const alias = srcTokens[idx]?.value ?? name;
      const outerCtx = outerRows[0] ?? {};
      const isCorrelated = argToks.some((at) => {
        return at.some((t) => {
          return t.type === "word" || t.type === "ident";
        });
      });
      const prepare = this.preparing || (prepareTvf && isCorrelated);
      const args = yield* stepMap(argToks, function* (at) {
        const expression = new ExprParser(at).parseExpression();
        if (prepare) {
          yield* this.validateColumns(expression, outerCtx, positionalParams, cteScope);
          return null;
        }
        return yield* this.evalExprSteps(expression, outerCtx, positionalParams, cteScope);
      }, this);
      const preparing = this.preparing;
      this.preparing = prepare;
      let tvf: StepResult<ReturnType<SqliteDatabase["evaluateTableValuedFunction"]>>;
      try {
        tvf = yield* this.evaluateTableValuedFunction(name, args);
      } finally {
        this.preparing = preparing;
      }
      const rows = yield* stepMap(tvf.rows, function* (r) { yield;
        const obj: Record<string, SqlValue> = {};
        tvf.columns.forEach((c, cIdx) => {
          obj[c] = r[cIdx] ?? null;
          obj[`${alias}.${c}`] = r[cIdx] ?? null;
          obj[`${name}.${c}`] = r[cIdx] ?? null;
        });
        return obj;
      }, this);
      return { alias, columns: tvf.columns, rows, isCorrelated };
    }

    if (srcTokens[idx]?.value.toUpperCase() === "AS") {
      idx += 1;
    }
    const alias = srcTokens[idx]?.value ?? name;

    // Check CTE scope first
    const cte = cteScope.get(name.toLowerCase());
    if (cte) {
      const rows = yield* stepMap(cte.rows, function* (r) { yield;
        const obj: Record<string, SqlValue> = {};
        cte.columns.forEach((c, cIdx) => {
          obj[c] = r[cIdx] ?? null;
          obj[`${alias}.${c}`] = r[cIdx] ?? null;
          obj[`${name}.${c}`] = r[cIdx] ?? null;
        });
        return obj;
      }, this);
      return { alias, columns: cte.columns, rows };
    }

    // Check sqlite_master / sqlite_schema / sqlite_temp_master
    const lowerName = name.toLowerCase();
    if (lowerName === "sqlite_sequence" && !this.findTable("sqlite_sequence")) {
      const cols = ["name", "seq"];
      const seqResultRows: Record<string, SqlValue>[] = [];
      for (const tbl of this.tables.values()) {
        yield;
        if (
          (tbl.columns.some((c) => {
            return c.autoIncrement;
          }) ||
            tbl.maxAutoInc > 0) &&
          tbl.maxAutoInc > 0
        ) {
          const entry: Record<string, SqlValue> = {
            name: tbl.name,
            seq: tbl.maxAutoInc,
            [`${alias}.name`]: tbl.name,
            [`${alias}.seq`]: tbl.maxAutoInc
          };
          seqResultRows.push(entry);
        }
      }
      return { alias, columns: cols, rows: seqResultRows };
    }
    if (
      lowerName === "sqlite_master" ||
      lowerName === "sqlite_schema" ||
      lowerName === "sqlite_temp_master" ||
      lowerName === "sqlite_temp_schema"
    ) {
      const cols = ["type", "name", "tbl_name", "rootpage", "sql"];
      const masterRows: Record<string, SqlValue>[] = [];
      if (this.loadedMaster) {
        for (const m of this.loadedMaster) {
          yield;
          const entry: Record<string, SqlValue> = {
            type: m.type,
            name: m.name,
            tbl_name: m.tbl_name,
            rootpage: m.rootpage,
            sql: m.sql || null
          };
          for (const c of cols) {
            yield;
            entry[`${alias}.${c}`] = entry[c]!;
          }
          masterRows.push(entry);
        }
        return { alias, columns: cols, rows: masterRows };
      }
      let rp = 2;
      for (const tbl of this.tables.values()) {
        yield;
        const entry: Record<string, SqlValue> = {
          type: "table",
          name: tbl.name,
          tbl_name: tbl.name,
          rootpage: rp++,
          sql: tbl.sql
        };
        for (const c of cols) {
          yield;
          entry[`${alias}.${c}`] = entry[c]!;
        }
        masterRows.push(entry);
      }
      for (const idxDef of this.indexes.values()) {
        yield;
        const entry: Record<string, SqlValue> = {
          type: "index",
          name: idxDef.name,
          tbl_name: idxDef.tableName,
          rootpage: rp++,
          sql: idxDef.sql
        };
        for (const c of cols) {
          yield;
          entry[`${alias}.${c}`] = entry[c]!;
        }
        masterRows.push(entry);
      }
      for (const vDef of this.views.values()) {
        yield;
        const entry: Record<string, SqlValue> = {
          type: "view",
          name: vDef.name,
          tbl_name: vDef.name,
          rootpage: 0,
          sql: vDef.sql
        };
        for (const c of cols) {
          yield;
          entry[`${alias}.${c}`] = entry[c]!;
        }
        masterRows.push(entry);
      }
      for (const trDef of this.triggers.values()) {
        yield;
        const entry: Record<string, SqlValue> = {
          type: "trigger",
          name: trDef.name,
          tbl_name: trDef.tableName,
          rootpage: 0,
          sql: trDef.sql
        };
        for (const c of cols) {
          yield;
          entry[`${alias}.${c}`] = entry[c]!;
        }
        masterRows.push(entry);
      }
      return { alias, columns: cols, rows: masterRows };
    }

    // Check Views
    const view = this.findView(name);
    if (view) {
      const res = (yield* this.executeStatementSteps(
        view.selectSql,
        positionalParams,
        cteScope
      )) ?? { columns: [], rows: [] };
      const cols = view.columns && view.columns.length > 0 ? view.columns : res.columns;
      const sameViewAlias = alias.toLowerCase() === name.toLowerCase();
      const rows = yield* stepMap(res.rows, function* (r, rIdx) { yield;
        res.rows[rIdx] = undefined as any;
        const data: Record<string, SqlValue> = {};
        for (let cIdx = 0; cIdx < cols.length; cIdx++) {
          data[cols[cIdx]!] = r[cIdx] ?? null;
        }
        const tablesMap: Record<string, Record<string, SqlValue>> = sameViewAlias
          ? { [alias]: data }
          : { [alias]: data, [name]: data };
        return {
          __rowid: rIdx + 1,
          __tables: tablesMap,
          __rowids: sameViewAlias ? { [alias]: rIdx + 1 } : { [alias]: rIdx + 1, [name]: rIdx + 1 },
          __sources: [data]
        } as unknown as Record<string, SqlValue>;
      }, this);
      return { alias, columns: cols, rows };
    }

    // Check Tables
    const tbl = this.findTable(name);
    if (!tbl) {
      throw new Error(`no such table: ${name}`);
    }
    const cols = tbl.columns.map((c) => {
      return c.name;
    });
    const sameAliasAndName = alias.toLowerCase() === name.toLowerCase();
    const rows = yield* stepMap(this.preparing ? [] : tbl.rows, function* (r) {
      yield;
      const tablesMap: Record<string, Record<string, SqlValue>> = sameAliasAndName
        ? { [alias]: r.data }
        : { [alias]: r.data, [name]: r.data };
      const rowidsMap: Record<string, number> = sameAliasAndName
        ? { [alias]: r.rowid }
        : { [alias]: r.rowid, [name]: r.rowid };
      return {
        __rowid: r.rowid,
        __tables: tablesMap,
        __rowids: rowidsMap,
        __sources: [r.data]
      } as unknown as Record<string, SqlValue>;
    }, this);
    return { alias, columns: cols, rows, ftsTable: tbl.fts5 ? tbl : undefined };
  }

  private *evaluateTableValuedFunction(
    fnName: string,
    args: SqlValue[]
  ): SqlSteps<{ columns: string[]; rows: SqlValue[][] }> {
    const lower = fnName.toLowerCase();
    if (lower === "generate_series") {
      if (this.preparing) return { columns: ["value"], rows: [] };
      const start = Math.trunc(toSqlNumber(args[0] ?? 1));
      const stop = Math.trunc(toSqlNumber(args[1] ?? start));
      const step = args[2] !== undefined ? Math.trunc(toSqlNumber(args[2])) : 1;
      const rows: SqlValue[][] = [];
      if (step > 0) {
        for (let v = start; v <= stop; v += step) {
          yield;
          this.checkRowCount(rows.length + 1);
          rows.push([v]);
        }
      } else if (step < 0) {
        for (let v = start; v >= stop; v += step) {
          yield;
          this.checkRowCount(rows.length + 1);
          rows.push([v]);
        }
      }
      return { columns: ["value"], rows };
    }

    if (lower === "json_each" || lower === "json_tree") {
      const cols = ["key", "value", "type", "atom", "id", "parent", "fullkey", "path"];
      if (this.preparing) return { columns: cols, rows: [] };
      const rawJson = toSqlString(args[0] ?? "");
      const rootPath = args[1] !== undefined ? toSqlString(args[1]) : "$";
      let parsed: unknown;
      try {
        parsed = JSON.parse(rawJson);
      } catch {
        throw new Error("malformed JSON");
      }
      const target = rootPath === "$" ? parsed : extractByJsonPath(parsed, rootPath);
      const rows: SqlValue[][] = [];
      let idCounter = 1;

      const getTypeStr = (v: unknown): string => {
        if (v === null) {
          return "null";
        }
        if (v === true) {
          return "true";
        }
        if (v === false) {
          return "false";
        }
        if (typeof v === "number") {
          return Number.isInteger(v) ? "integer" : "real";
        }
        if (typeof v === "string") {
          return "text";
        }
        if (Array.isArray(v)) {
          return "array";
        }
        return "object";
      };

      const toRow = (
        key: SqlValue,
        val: unknown,
        parentId: SqlValue,
        fullkey: string,
        pathStr: string
      ): number => {
        const myId = idCounter++;
        const tStr = getTypeStr(val);
        const isContainer = tStr === "array" || tStr === "object";
        const sqlVal: SqlValue = isContainer
          ? serializeSqlJson(val)
          : val === null
            ? null
            : typeof val === "boolean"
              ? val
                ? 1
                : 0
              : (val as string | number);
        const atom: SqlValue = isContainer ? null : sqlVal;
        this.checkRowCount(rows.length + 1);
        rows.push([key, sqlVal, tStr, atom, myId, parentId, fullkey, pathStr]);
        return myId;
      };

      if (lower === "json_each") {
        if (Array.isArray(target)) {
          target.forEach((item, idx) => {
            toRow(idx, item, null, `${rootPath}[${idx}]`, rootPath);
          });
        } else if (target && typeof target === "object") {
          for (const [k, item] of Object.entries(target)) {
            yield;
            toRow(k, item, null, `${rootPath}.${k}`, rootPath);
          }
        } else if (target !== undefined) {
          toRow(null, target, null, rootPath, rootPath);
        }
      } else {
        const walk = (
          node: unknown,
          key: SqlValue,
          parentId: SqlValue,
          fullkey: string,
          pathStr: string
        ) => {
          const myId = toRow(key, node, parentId, fullkey, pathStr);
          if (Array.isArray(node)) {
            node.forEach((child, idx) => {
              walk(child, idx, myId, `${fullkey}[${idx}]`, fullkey);
            });
          } else if (node && typeof node === "object") {
            for (const [k, child] of Object.entries(node)) {
              walk(child, k, myId, `${fullkey}.${k}`, fullkey);
            }
          }
        };
        if (target !== undefined) {
          walk(target, null, null, rootPath, rootPath);
        }
      }
      return { columns: cols, rows };
    }

    return { columns: ["value"], rows: [] };
  }

  private splitTopLevelComma(tokens: Token[]): Token[][] {
    const items: Token[][] = [];
    let cur: Token[] = [];
    let d = 0;
    for (const t of tokens) {
      if (t.value === "(") {
        d += 1;
        cur.push(t);
      } else if (t.value === ")") {
        d -= 1;
        cur.push(t);
      } else if (t.value === "," && d === 0) {
        if (cur.length > 0) {
          items.push(cur);
        }
        cur = [];
      } else {
        cur.push(t);
      }
    }
    if (cur.length > 0) {
      items.push(cur);
    }
    return items;
  }

  private parseSelectTarget(itemToks: Token[]): { expr: ExprNode; alias: string } {
    const p = new ExprParser(itemToks);
    const expr = p.parseExpression();
    let alias: string | undefined;
    if (p.matchWord("AS")) {
      alias = itemToks[p.pos]?.value;
    } else if (p.pos < itemToks.length) {
      const rem = itemToks[p.pos];
      if (rem && (rem.type === "word" || rem.type === "ident" || rem.type === "string")) {
        alias = rem.value;
      }
    }
    if (!alias) {
      if (expr.kind === "column") {
        alias = expr.name;
      } else {
        alias = reconstructTokensSql(itemToks);
      }
    }
    return { expr, alias };
  }

  private containsAggregate(expr: ExprNode): boolean {
    if (expr.kind === "func" && expr.over) return false;
    return isAggregateFunction(expr) || expressionChildren(expr).some((child) => this.containsAggregate(child));
  }

  private *collectWindowExprs(
    expr: ExprNode,
    groupedRows: { representative: Record<string, SqlValue>; group: Record<string, SqlValue>[] }[],
    positionalParams: SqlValue[],
    cteScope: Map<string, { columns: string[]; rows: SqlValue[][] }>,
    out: Map<ExprNode, SqlValue[]>
  ): SqlSteps<void> {
    if (expr.kind === "func" && expr.over) {
      out.set(expr, yield* this.evaluateWindowFunc(expr, groupedRows, positionalParams, cteScope));
      return;
    }
    for (const child of expressionChildren(expr)) {
      yield;
      yield* this.collectWindowExprs(child, groupedRows, positionalParams, cteScope, out);
    }
  }

  private *evaluateWindowFunc(
    fnExpr: Extract<ExprNode, { kind: "func" }>,
    groupedRows: { representative: Record<string, SqlValue>; group: Record<string, SqlValue>[] }[],
    positionalParams: SqlValue[],
    cteScope: Map<string, { columns: string[]; rows: SqlValue[][] }>
  ): SqlSteps<SqlValue[]> {
    const result: SqlValue[] = new Array(groupedRows.length).fill(null);
    const over = fnExpr.over!;
    const partitions = new Map<string, number[]>();

    for (let i = 0; i < groupedRows.length; i += 1) {
      yield;
      const g = groupedRows[i]!;
      const pKey = serializeSqlJson(
        yield* stepMap(over.partitionBy, function* (pe) {
          return yield* this.evalExprSteps(pe, g.representative, positionalParams, cteScope, { group: g.group });
        }, this),
        false
      );
      const arr = partitions.get(pKey);
      if (arr) {
        arr.push(i);
      } else {
        partitions.set(pKey, [i]);
      }
    }

    const fnUpper = fnExpr.name.toUpperCase();

    for (const indices of partitions.values()) {
      yield;
      if (over.orderBy.length > 0) {
        yield* stepSort(indices, function* (iA, iB) {
          const gA = groupedRows[iA]!;
          const gB = groupedRows[iB]!;
          for (const ob of over.orderBy) {
            yield;
            const vA = yield* this.evalExprSteps(ob.expr, gA.representative, positionalParams, cteScope, { group: gA.group });
            const vB = yield* this.evalExprSteps(ob.expr, gB.representative, positionalParams, cteScope, { group: gB.group });
            const cmp = compareSqlValues(vA, vB);
            if (cmp !== 0) {
              return ob.desc ? -cmp : cmp;
            }
          }
          return iA - iB;
        }, this);
      }

      const orderPeerKeys = yield* stepMap(indices, function* (idx) {
        const g = groupedRows[idx]!;
        return serializeSqlJson(
          yield* stepMap(over.orderBy, function* (ob) {
            return yield* this.evalExprSteps(ob.expr, g.representative, positionalParams, cteScope, { group: g.group });
          }, this),
          false
        );
      }, this);

      let currentRank = 1;
      let currentDenseRank = 1;

      for (let pPos = 0; pPos < indices.length; pPos += 1) {
        yield;
        const rowIdx = indices[pPos]!;
        const g = groupedRows[rowIdx]!;
        if (pPos > 0 && orderPeerKeys[pPos] !== orderPeerKeys[pPos - 1]) {
          currentRank = pPos + 1;
          currentDenseRank += 1;
        }

        if (fnUpper === "ROW_NUMBER") {
          result[rowIdx] = pPos + 1;
        } else if (fnUpper === "RANK") {
          result[rowIdx] = currentRank;
        } else if (fnUpper === "DENSE_RANK") {
          result[rowIdx] = currentDenseRank;
        } else if (fnUpper === "NTILE") {
          const buckets = Math.max(
            1,
            Math.trunc(
              toSqlNumber(
                yield* this.evalExprSteps(fnExpr.args[0]!, g.representative, positionalParams, cteScope, { group: g.group })
              )
            )
          );
          result[rowIdx] = Math.floor((pPos * buckets) / indices.length) + 1;
        } else if (fnUpper === "PERCENT_RANK") {
          result[rowIdx] = indices.length <= 1 ? 0 : (currentRank - 1) / (indices.length - 1);
        } else if (fnUpper === "CUME_DIST") {
          let peerEnd = pPos;
          while (
            peerEnd + 1 < indices.length &&
            orderPeerKeys[peerEnd + 1] === orderPeerKeys[pPos]
          ) {
            yield;
            peerEnd += 1;
          }
          result[rowIdx] = (peerEnd + 1) / indices.length;
        } else if (fnUpper === "LAG" || fnUpper === "LEAD") {
          const offset = fnExpr.args[1]
            ? Math.trunc(
                toSqlNumber(
                  yield* this.evalExprSteps(fnExpr.args[1], g.representative, positionalParams, cteScope, { group: g.group })
                )
              )
            : 1;
          const defVal = fnExpr.args[2]
            ? yield* this.evalExprSteps(fnExpr.args[2], g.representative, positionalParams, cteScope, { group: g.group })
            : null;
          const targetPos = fnUpper === "LAG" ? pPos - offset : pPos + offset;
          if (targetPos < 0 || targetPos >= indices.length) {
            result[rowIdx] = defVal;
          } else {
            const targetG = groupedRows[indices[targetPos]!]!;
            result[rowIdx] = yield* this.evalExprSteps(fnExpr.args[0]!, targetG.representative, positionalParams, cteScope, { group: targetG.group });
          }
        } else if (fnUpper === "FIRST_VALUE") {
          const frameStart = over.frameBounds
            ? over.frameBounds.start === -Infinity
              ? 0
              : Math.max(0, pPos + over.frameBounds.start)
            : 0;
          const firstG = groupedRows[indices[frameStart]!]!;
          result[rowIdx] = yield* this.evalExprSteps(fnExpr.args[0]!, firstG.representative, positionalParams, cteScope, { group: firstG.group });
        } else if (fnUpper === "LAST_VALUE") {
          let peerEnd = over.orderBy.length > 0 ? pPos : indices.length - 1;
          if (over.frameBounds) {
            peerEnd =
              over.frameBounds.end === Infinity
                ? indices.length - 1
                : Math.min(indices.length - 1, Math.max(0, pPos + over.frameBounds.end));
          } else {
            while (
              over.orderBy.length > 0 &&
              peerEnd + 1 < indices.length &&
              orderPeerKeys[peerEnd + 1] === orderPeerKeys[pPos]
            ) {
              yield;
              peerEnd += 1;
            }
          }
          const lastG = groupedRows[indices[peerEnd]!]!;
          result[rowIdx] = yield* this.evalExprSteps(fnExpr.args[0]!, lastG.representative, positionalParams, cteScope, { group: lastG.group });
        } else if (fnUpper === "NTH_VALUE") {
          const n = Math.trunc(
            toSqlNumber(
              yield* this.evalExprSteps(fnExpr.args[1]!, g.representative, positionalParams, cteScope, { group: g.group })
            )
          );
          const frameStart = over.frameBounds
            ? over.frameBounds.start === -Infinity
              ? 0
              : Math.max(0, pPos + over.frameBounds.start)
            : 0;
          if (n >= 1 && frameStart + n - 1 < indices.length) {
            const nthG = groupedRows[indices[frameStart + n - 1]!]!;
            result[rowIdx] = yield* this.evalExprSteps(fnExpr.args[0]!, nthG.representative, positionalParams, cteScope, { group: nthG.group });
          } else {
            result[rowIdx] = null;
          }
        } else {
          // Aggregate window function (SUM, COUNT, AVG, MIN, MAX, etc.)
          let frameStart = 0;
          let frameEnd = over.orderBy.length > 0 ? pPos : indices.length - 1;
          if (over.frameBounds) {
            frameStart =
              over.frameBounds.start === -Infinity
                ? 0
                : Math.max(0, pPos + over.frameBounds.start);
            frameEnd =
              over.frameBounds.end === Infinity
                ? indices.length - 1
                : Math.min(indices.length - 1, Math.max(-1, pPos + over.frameBounds.end));
          } else {
            while (
              over.orderBy.length > 0 &&
              frameEnd + 1 < indices.length &&
              orderPeerKeys[frameEnd + 1] === orderPeerKeys[pPos]
            ) {
              yield;
              frameEnd += 1;
            }
          }
          const frameRows = yield* stepFlatMap(indices.slice(frameStart, frameEnd + 1), function* (idx) { yield;
            return groupedRows[idx]!.group;
          }, this);
          const strippedFn: Extract<ExprNode, { kind: "func" }> = { ...fnExpr, over: undefined };
          result[rowIdx] = yield* this.evalAggregateFunction(
            strippedFn,
            frameRows,
            positionalParams,
            cteScope
          );
        }
      }
    }

    return result;
  }

  private *evalAggregateFunction(
    expr: Extract<ExprNode, { kind: "func" }>,
    group: Record<string, SqlValue>[],
    positionalParams: SqlValue[],
    cteScope: Map<string, { columns: string[]; rows: SqlValue[][] }>
  ): SqlSteps<SqlValue> {
    const u = expr.name.toUpperCase();
    let filteredGroup = group;
    if (expr.filterWhere) {
      filteredGroup = yield* stepFilter(group, function* (r) {
        return isTruthy(
          yield* this.evalExprSteps(expr.filterWhere!, r, positionalParams, cteScope)
        );
      }, this);
    }

    if (u === "COUNT") {
      if (expr.star || expr.args.length === 0) {
        return filteredGroup.length;
      }
      const vals = yield* stepFilter(
        yield* stepMap(filteredGroup, function* (r) {
          return yield* this.evalExprSteps(expr.args[0]!, r, positionalParams, cteScope);
        }, this),
        function* (v) { yield;
          return v !== null && v !== undefined;
        }
      , this);
      if (expr.distinct) {
        return new Set(
          vals.map((v) => {
            return serializeSqlJson(v, false);
          })
        ).size;
      }
      return vals.length;
    }

    if (u === "JSON_GROUP_OBJECT") {
      const entries: string[] = [];
      for (const r of filteredGroup) {
        yield;
        const k = yield* this.evalExprSteps(expr.args[0]!, r, positionalParams, cteScope);
        const v = yield* this.evalExprSteps(expr.args[1]!, r, positionalParams, cteScope);
        if (k !== null && k !== undefined) {
          entries.push(`${JSON.stringify(toSqlString(k))}:${serializeSqlJson(v)}`);
        }
      }
      return new JsonText(`{${entries.join(",")}}`);
    }

    let vals = yield* stepMap(filteredGroup, function* (r) {
      return expr.args[0]
        ? yield* this.evalExprSteps(expr.args[0], r, positionalParams, cteScope)
        : null;
    }, this);

    if (u === "JSON_GROUP_ARRAY") {
      if (expr.distinct) {
        const seen = new Set<string>();
        vals = yield* stepFilter(vals, function* (v) { yield;
          const k = serializeSqlJson(v, false);
          if (seen.has(k)) {
            return false;
          }
          seen.add(k);
          return true;
        }, this);
      }
      return new JsonText(serializeSqlJson(vals));
    }

    const nonNull = vals.filter((v): v is Exclude<SqlValue, null> => v !== null && v !== undefined);
    let activeVals: SqlValue[] = nonNull;
    if (expr.distinct) {
      const seen = new Set<string>();
      activeVals = yield* stepFilter(nonNull, function* (v) { yield;
        const k = serializeSqlJson(v, false);
        if (seen.has(k)) {
          return false;
        }
        seen.add(k);
        return true;
      }, this);
    }

    if (u === "SUM") {
      if (activeVals.length === 0) {
        return null;
      }
      let exact = 0n;
      let realSum: number | undefined;
      for (const value of activeVals) {
        yield;
        const numeric = arithmeticNumber(value);
        if (realSum !== undefined) {
          realSum += Number(numeric);
        } else if (numeric instanceof Number || !Number.isInteger(Number(numeric))) {
          realSum = Number(exact) + Number(numeric);
        } else {
          exact += integerPrefix(numeric);
          if (exact < INT64_MIN || exact > INT64_MAX) throw new Error("integer overflow");
        }
      }
      return realSum === undefined ? integerResult(exact) : new Number(realSum);
    }
    if (u === "TOTAL") {
      return new Number(
        yield* stepReduce(
          activeVals,
          function* (sum, v) { yield;
            return sum + toSqlNumber(v);
          },
          0.0
        , this)
      );
    }
    if (u === "AVG") {
      if (activeVals.length === 0) {
        return null;
      }
      const sum = yield* stepReduce(
        activeVals,
        function* (s, v) { yield;
          return s + toSqlNumber(v);
        },
        0
      , this);
      return new Number(sum / activeVals.length);
    }
    if (u === "MIN") {
      if (activeVals.length === 0) {
        return null;
      }
      return yield* stepReduce<SqlValue, SqlValue>(
        activeVals,
        function* (min, v) { yield;
          return compareSqlValues(v, min) < 0 ? v : min;
        },
        activeVals[0]!
      , this);
    }
    if (u === "MAX") {
      if (activeVals.length === 0) {
        return null;
      }
      return yield* stepReduce<SqlValue, SqlValue>(
        activeVals,
        function* (max, v) { yield;
          return compareSqlValues(v, max) > 0 ? v : max;
        },
        activeVals[0]!
      , this);
    }
    if (u === "GROUP_CONCAT" || u === "STRING_AGG") {
      if (activeVals.length === 0) {
        return null;
      }
      const sep = expr.args[1]
        ? toSqlString(
            yield* this.evalExprSteps(
              expr.args[1],
              filteredGroup[0] ?? {},
              positionalParams,
              cteScope
            )
          )
        : ",";
      return activeVals
        .map((v) => {
          return toSqlString(v);
        })
        .join(sep);
    }

    return null;
  }

  private *validateColumns(
    node: unknown,
    scope: Record<string, SqlValue>,
    positionalParams: SqlValue[],
    cteScope: Map<string, { columns: string[]; rows: SqlValue[][] }>
  ): SqlSteps<void> {
    if (!node || typeof node !== "object") return;
    if ("kind" in node && node.kind === "binary" && (node as Extract<ExprNode, { kind: "binary" }>).op === "MATCH") {
      const match = node as Extract<ExprNode, { kind: "binary" }>;
      this.ftsValues(match.left, scope);
      if (match.right.kind === "literal" || match.right.kind === "param") {
        const query = yield* this.evalExprSteps(match.right, scope, positionalParams, cteScope);
        yield* ftsTokens(toSqlString(query), true);
      }
      yield* this.validateColumns(match.right, scope, positionalParams, cteScope);
      return;
    }
    if ("kind" in node && node.kind === "func" && (node as Extract<ExprNode, { kind: "func" }>).name.toUpperCase() === "RAISE") {
      const fn = node as Extract<ExprNode, { kind: "func" }>;
      for (const arg of fn.args.slice(1)) {
        yield* this.validateColumns(arg, scope, positionalParams, cteScope);
      }
      return;
    }
    if ("kind" in node && node.kind === "column") {
      const column = node as Extract<ExprNode, { kind: "column" }>;
      this.lookupColInRow(scope, column.table, column.name, column.doubleQuoted);
      return;
    }
    if ("kind" in node && (node.kind === "subquery" || node.kind === "in_subquery")) {
      const subquery = node as Extract<ExprNode, { kind: "subquery" | "in_subquery" }>;
      const preparing = this.preparing;
      this.preparing = true;
      this.outerRows.push(scope);
      try {
        const result = yield* this.executeStatementSteps(
          subquery.kind === "subquery" ? subquery.sql : subquery.subquerySql,
          positionalParams,
          cteScope
        );
        if (
          !(subquery.kind === "subquery" && subquery.exists) &&
          result &&
          result.columns.length !== 1
        ) {
          throw new Error(`sub-select returns ${result.columns.length} columns - expected 1`);
        }
      } finally {
        this.outerRows.pop();
        this.preparing = preparing;
      }
    }
    for (const child of Object.values(node)) {
      yield;
      yield* this.validateColumns(child, scope, positionalParams, cteScope);
    }
  }

  private ftsValues(expr: ExprNode, row: Record<string, SqlValue>): SqlValue[] {
    if (expr.kind !== "column") throw new Error("MATCH requires an FTS5 table or column");
    const tables = (row as unknown as { __tables?: Record<string, Record<string, SqlValue>> }).__tables ?? {};
    const bindings = (row as unknown as { __fts?: Record<string, TableDef> }).__fts;
    if (bindings) {
      for (const [alias, table] of Object.entries(bindings)) {
        if (!expr.table && table.name.toLowerCase() === expr.name.toLowerCase()) {
          return table.columns.map((column) => this.lookupColInRow(row, alias, column.name));
        }
        if ((!expr.table || expr.table.toLowerCase() === alias.toLowerCase()) &&
            table.columns.some((column) => column.name.toLowerCase() === expr.name.toLowerCase())) {
          return [this.lookupColInRow(row, expr.table, expr.name)];
        }
      }
      throw new Error("MATCH requires an FTS5 table or column");
    }
    const table = this.findTable(expr.name);
    if (!expr.table && table?.fts5) {
      return table.columns.map((column) => this.lookupColInRow(row, table.name, column.name));
    }
    const value = this.lookupColInRow(row, expr.table, expr.name);
    for (const [name, data] of Object.entries(tables)) {
      const candidate = this.findTable(name);
      if (!candidate?.fts5) continue;
      if (expr.table && !Object.entries(tables).some(([alias, source]) => alias.toLowerCase() === expr.table!.toLowerCase() && source === data)) continue;
      if (candidate.columns.some((column) => column.name.toLowerCase() === expr.name.toLowerCase())) return [value];
    }
    throw new Error("MATCH requires an FTS5 table or column");
  }

  private lookupColInRow(
    row: Record<string, SqlValue>,
    table: string | undefined,
    name: string,
    doubleQuoted = false
  ): SqlValue {
    const tables = (row as any).__tables as Record<string, Record<string, SqlValue>> | undefined;
    const sources = (row as any).__sources as Record<string, SqlValue>[] | undefined;
    const rowids = (row as any).__rowids as Record<string, SqlValue> | undefined;
    const lowerName = name.toLowerCase();

    if (lowerName === "rowid" || lowerName === "_rowid_" || lowerName === "oid") {
      if (!table && name in row && !name.startsWith("__")) {
        return row[name]!;
      }
      if (table) {
        const exact = `${table}.${name}`;
        if (exact in row) return row[exact]!;
        if (tables) {
          let td = tables[table];
          if (!td) {
            const lt = table.toLowerCase();
            for (const tk in tables) {
              if (tk.toLowerCase() === lt) { td = tables[tk]; break; }
            }
          }
          if (td) {
            if (name in td) return td[name]!;
            for (const k in td) {
              if (k.toLowerCase() === lowerName) return td[k]!;
            }
          }
        }
        if (rowids) {
          if (table in rowids) return rowids[table]!;
          const lt = table.toLowerCase();
          for (const tk in rowids) {
            if (tk.toLowerCase() === lt) return rowids[tk]!;
          }
        }
        const tableRowidKey = table + ".rowid";
        if (tableRowidKey in row) return row[tableRowidKey]!;
      } else {
        if (sources) {
          for (let i = 0; i < sources.length; i++) {
            const s = sources[i]!;
            if (name in s) return s[name]!;
            for (const k in s) {
              if (k.toLowerCase() === lowerName) return s[k]!;
            }
          }
        }
        for (const k in row) {
          if (!k.startsWith("__") && k.toLowerCase() === lowerName) return row[k]!;
        }
        if ("__rowid" in row) return row.__rowid!;
      }
    }

    if (table) {
      if (tables) {
        let td = tables[table];
        if (!td) {
          const lt = table.toLowerCase();
          for (const tk in tables) {
            if (tk.toLowerCase() === lt) {
              td = tables[tk];
              break;
            }
          }
        }
        if (td) {
          if (name in td) return td[name] ?? null;
          for (const k in td) {
            if (k.toLowerCase() === lowerName) return td[k] ?? null;
          }
        }
      }
      const exact = `${table}.${name}`;
      if (exact in row) {
        return row[exact]!;
      }
      const lowerExact = exact.toLowerCase();
      for (const k in row) {
        if (k.startsWith("__")) continue;
        if (k.toLowerCase() === lowerExact) {
          return row[k]!;
        }
      }
    } else {
      if (name in row && !name.startsWith("__")) {
        return row[name]!;
      }
      if (sources) {
        let found: SqlValue | undefined;
        for (let i = 0; i < sources.length; i++) {
          const src = sources[i]!;
          if (name in src) {
            const v = src[name] ?? null;
            if (found === undefined || found === null) found = v;
            if (found !== null && found !== undefined) return found;
          }
        }
        if (found !== undefined) return found;
        for (let i = 0; i < sources.length; i++) {
          const src = sources[i]!;
          for (const k in src) {
            if (k.toLowerCase() === lowerName) {
              const v = src[k] ?? null;
              if (found === undefined || found === null) found = v;
              if (found !== null && found !== undefined) return found;
            }
          }
        }
        if (found !== undefined) return found;
      }
      for (const k in row) {
        if (k.startsWith("__")) continue;
        if (k.toLowerCase() === lowerName || k.toLowerCase().endsWith(`.${lowerName}`)) {
          return row[k]!;
        }
      }
    }

    for (let i = this.outerRows.length - 1; i >= 0; i -= 1) {
      const outer = this.outerRows[i]!;
      const outerTables = (outer as any).__tables as Record<string, Record<string, SqlValue>> | undefined;
      const outerSources = (outer as any).__sources as Record<string, SqlValue>[] | undefined;
      if (table && outerTables) {
        const lt = table.toLowerCase();
        for (const tk in outerTables) {
          if (tk.toLowerCase() === lt) {
            const td = outerTables[tk]!;
            if (name in td) return td[name] ?? null;
            for (const k in td) {
              if (k.toLowerCase() === lowerName) return td[k] ?? null;
            }
          }
        }
      } else if (!table && outerSources) {
        for (let s = 0; s < outerSources.length; s++) {
          const src = outerSources[s]!;
          if (name in src) return src[name] ?? null;
          for (const k in src) {
            if (k.toLowerCase() === lowerName) return src[k] ?? null;
          }
        }
      }
      const key = Object.keys(outer).find((key) =>
        !key.startsWith("__") && (
          table
            ? key.toLowerCase() === `${table}.${name}`.toLowerCase()
            : key.toLowerCase() === lowerName
        )
      );
      if (key !== undefined) return outer[key]!;
    }
    if (doubleQuoted && !table) return name;
    throw new Error(`in prepare, no such column: ${table ? `${table}.` : ""}${name}`);
  }

  private *evalScalarSql(
    sql: string,
    row: Record<string, SqlValue>,
    positionalParams: SqlValue[]
  ): SqlSteps<SqlValue> {
    return yield* this.evalExprSteps(parseExprSql(sql), row, positionalParams);
  }

  public evalExpr(
    expr: ExprNode,
    row: Record<string, SqlValue>,
    positionalParams: SqlValue[],
    cteScope: Map<string, { columns: string[]; rows: SqlValue[][] }> = new Map()
  ): SqlValue {
    return runSynchronously(this.evalExprSteps(expr, row, positionalParams, cteScope));
  }

  private *evalExprSteps(
    expr: ExprNode,
    row: Record<string, SqlValue>,
    positionalParams: SqlValue[],
    cteScope: Map<string, { columns: string[]; rows: SqlValue[][] }> = new Map(),
    evaluation?: ExprEvaluation
  ): SqlSteps<SqlValue> {
    if (evaluation?.window?.results.has(expr)) {
      return evaluation.window.results.get(expr)![evaluation.window.rowIdx] ?? null;
    }
    switch (expr.kind) {
      case "literal":
        return expr.value;
      case "column":
        return this.lookupColInRow(row, expr.table, expr.name, expr.doubleQuoted);
      case "star":
        return null;
      case "param": {
        if (expr.name === "?") {
          return (
            positionalParams[expr.index - 1] ?? this.parameters.get(String(expr.index)) ?? null
          );
        }
        if (/^\?\d+$/.test(expr.name)) {
          const n = Number(expr.name.slice(1));
          return positionalParams[n - 1] ?? this.parameters.get(String(n)) ?? null;
        }
        return (
          this.parameters.get(expr.name) ??
          this.parameters.get(expr.name.slice(1)) ??
          positionalParams[expr.index - 1] ??
          null
        );
      }
      case "collate":
        return yield* this.evalExprSteps(expr.expr, row, positionalParams, cteScope, evaluation);
      case "unary":
        return this.applyUnary(
          expr.op,
          yield* this.evalExprSteps(expr.expr, row, positionalParams, cteScope, evaluation)
        );
      case "binary": {
        if (expr.op === "MATCH") {
          const values = this.ftsValues(expr.left, row);
          const query = yield* this.evalExprSteps(expr.right, row, positionalParams, cteScope, evaluation);
          const terms = yield* ftsTokens(toSqlString(query), true);
          const words = new Set<string>();
          for (const value of values) {
            yield;
            for (const word of yield* ftsTokens(toSqlString(value), false)) words.add(word);
          }
          return terms.every((term) => words.has(term)) ? 1 : 0;
        }
        if (expr.op === "AND") {
          const l = yield* this.evalExprSteps(expr.left, row, positionalParams, cteScope, evaluation);
          if (l !== null && !isTruthy(l)) {
            return 0;
          }
          const r = yield* this.evalExprSteps(expr.right, row, positionalParams, cteScope, evaluation);
          if (r !== null && !isTruthy(r)) {
            return 0;
          }
          if (l === null || r === null) {
            return null;
          }
          return 1;
        }
        if (expr.op === "OR") {
          const l = yield* this.evalExprSteps(expr.left, row, positionalParams, cteScope, evaluation);
          if (l !== null && isTruthy(l)) {
            return 1;
          }
          const r = yield* this.evalExprSteps(expr.right, row, positionalParams, cteScope, evaluation);
          if (r !== null && isTruthy(r)) {
            return 1;
          }
          if (l === null || r === null) {
            return null;
          }
          return 0;
        }
        const collation =
          expr.left.kind === "collate"
            ? expr.left.collation
            : expr.right.kind === "collate"
              ? expr.right.collation
              : "BINARY";
        const l = yield* this.evalExprSteps(expr.left, row, positionalParams, cteScope, evaluation);
        if (
          (expr.op === "LIKE" || expr.op === "GLOB") &&
          expr.right.kind === "func" &&
          expr.right.name === "__like_escape__"
        ) {
          const pat = yield* this.evalExprSteps(
            expr.right.args[0]!,
            row,
            positionalParams,
            cteScope,
            evaluation
          );
          const esc = yield* this.evalExprSteps(
            expr.right.args[1]!,
            row,
            positionalParams,
            cteScope,
            evaluation
          );
          if (l === null || pat === null || esc === null) {
            return null;
          }
          return matchLike(toSqlString(l), toSqlString(pat), expr.op === "LIKE", toSqlString(esc))
            ? 1
            : 0;
        }
        const r = yield* this.evalExprSteps(expr.right, row, positionalParams, cteScope, evaluation);
        return this.applyBinary(expr.op, l, r, collation);
      }
      case "between": {
        const v = yield* this.evalExprSteps(expr.expr, row, positionalParams, cteScope, evaluation);
        const lo = yield* this.evalExprSteps(expr.low, row, positionalParams, cteScope, evaluation);
        const hi = yield* this.evalExprSteps(expr.high, row, positionalParams, cteScope, evaluation);
        // BETWEEN is (v >= lo) AND (v <= hi): false dominates NULL.
        const lower = v === null || lo === null ? null : compareSqlValues(v, lo) >= 0;
        const upper = v === null || hi === null ? null : compareSqlValues(v, hi) <= 0;
        const inside = lower === false || upper === false
          ? false
          : lower === null || upper === null ? null : true;
        return inside === null ? null : (expr.not ? !inside : inside) ? 1 : 0;
      }
      case "in_list": {
        const v = yield* this.evalExprSteps(expr.expr, row, positionalParams, cteScope, evaluation);
        if (v === null) {
          return expr.list.length === 0 ? (expr.not ? 1 : 0) : null;
        }
        let sawNull = false;
        for (const item of expr.list) {
          yield;
          const iv = yield* this.evalExprSteps(item, row, positionalParams, cteScope, evaluation);
          if (iv === null) {
            sawNull = true;
          } else if (sqlEquals(v, iv) === true) {
            return expr.not ? 0 : 1;
          }
        }
        if (sawNull) {
          return null;
        }
        return expr.not ? 1 : 0;
      }
      case "in_subquery": {
        const v = yield* this.evalExprSteps(expr.expr, row, positionalParams, cteScope, evaluation);
        this.outerRows.push(row);
        let res: QueryResultSet;
        try {
          res = (yield* this.executeStatementSteps(
            expr.subquerySql,
            positionalParams,
            cteScope
          )) ?? { columns: [], rows: [] };
        } finally {
          this.outerRows.pop();
        }
        if (res.columns.length !== 1)
          throw new Error(`sub-select returns ${res.columns.length} columns - expected 1`);
        if (v === null) {
          return res.rows.length === 0 ? (expr.not ? 1 : 0) : null;
        }
        let sawNull = false;
        for (const r of res.rows) {
          yield;
          const iv = r[0] ?? null;
          if (iv === null) {
            sawNull = true;
          } else if (sqlEquals(v, iv) === true) {
            return expr.not ? 0 : 1;
          }
        }
        if (sawNull) {
          return null;
        }
        return expr.not ? 1 : 0;
      }
      case "is_null": {
        const v = yield* this.evalExprSteps(expr.expr, row, positionalParams, cteScope, evaluation);
        return (expr.not ? v !== null : v === null) ? 1 : 0;
      }
      case "case": {
        const baseVal = expr.base
          ? yield* this.evalExprSteps(expr.base, row, positionalParams, cteScope, evaluation)
          : undefined;
        for (const b of expr.branches) {
          yield;
          const wVal = yield* this.evalExprSteps(b.when, row, positionalParams, cteScope, evaluation);
          const matched = expr.base ? sqlEquals(baseVal ?? null, wVal) === true : isTruthy(wVal);
          if (matched) {
            return yield* this.evalExprSteps(b.then, row, positionalParams, cteScope, evaluation);
          }
        }
        return expr.elseExpr
          ? yield* this.evalExprSteps(expr.elseExpr, row, positionalParams, cteScope, evaluation)
          : null;
      }
      case "cast": {
        const v = yield* this.evalExprSteps(expr.expr, row, positionalParams, cteScope, evaluation);
        return this.applyCast(v, expr.targetType);
      }
      case "subquery": {
        this.outerRows.push(row);
        let res: QueryResultSet;
        try {
          res = (yield* this.executeStatementSteps(expr.sql, positionalParams, cteScope)) ?? {
            columns: [],
            rows: []
          };
        } finally {
          this.outerRows.pop();
        }
        if (expr.exists) {
          const has = res.rows.length > 0;
          return (expr.notExists ? !has : has) ? 1 : 0;
        }
        if (res.columns.length !== 1)
          throw new Error(`sub-select returns ${res.columns.length} columns - expected 1`);
        return res.rows[0]?.[0] ?? null;
      }
      case "func": {
        if (evaluation && isAggregateFunction(expr)) {
          return yield* this.evalAggregateFunction(expr, evaluation.group, positionalParams, cteScope);
        }
        const u = expr.name.toUpperCase();
        if (u === "RAISE") {
          const rawMode = expr.args[0];
          const mode =
            rawMode?.kind === "column"
              ? rawMode.name.toUpperCase()
              : String(
                  yield* this.evalExprSteps(rawMode!, row, positionalParams, cteScope, evaluation)
                ).toUpperCase();
          if (mode === "IGNORE") {
            const ignoreErr = new Error("RAISE(IGNORE)") as Error & { isRaiseIgnore?: boolean };
            ignoreErr.isRaiseIgnore = true;
            throw ignoreErr;
          }
          const msg = expr.args[1]
            ? toSqlString(
                yield* this.evalExprSteps(expr.args[1], row, positionalParams, cteScope, evaluation)
              )
            : mode;
          if (mode === "ROLLBACK" && this.inTransaction) {
            if (this.txSnapshot) {
              yield* this.restoreSnapshot(this.txSnapshot);
            }
            this.inTransaction = false;
            this.txSnapshot = null;
            this.savepoints.clear();
          }
          throw new Error(msg);
        }
        if (u === "COALESCE" || u === "IFNULL") {
          for (const a of expr.args) {
            yield;
            const v = yield* this.evalExprSteps(a, row, positionalParams, cteScope, evaluation);
            if (v !== null && v !== undefined) {
              return v;
            }
          }
          return null;
        }
        if (u === "IIF") {
          const cond = yield* this.evalExprSteps(
            expr.args[0]!,
            row,
            positionalParams,
            cteScope,
            evaluation
          );
          return isTruthy(cond)
            ? yield* this.evalExprSteps(expr.args[1]!, row, positionalParams, cteScope, evaluation)
            : expr.args[2]
              ? yield* this.evalExprSteps(expr.args[2], row, positionalParams, cteScope, evaluation)
              : null;
        }
        const args = yield* stepMap(expr.args, function* (a) {
          return yield* this.evalExprSteps(a, row, positionalParams, cteScope, evaluation);
        }, this);
        return yield* this.evalScalarFunction(expr.name, args);
      }
    }
  }

  private applyUnary(op: string, v: SqlValue): SqlValue {
    if (op === "NOT") {
      if (v === null) {
        return null;
      }
      return isTruthy(v) ? 0 : 1;
    }
    if (v === null) {
      return null;
    }
    if (op === "-") {
      return typeof v === "bigint" ? integerResult(-v) : v instanceof Number ? new Number(-v.valueOf()) : -toSqlNumber(v);
    }
    if (op === "+") {
      return v;
    }
    if (op === "~") {
      return integerResult(BigInt.asIntN(64, ~integerPrefix(v)));
    }
    return v;
  }

  private applyBinary(op: string, l: SqlValue, r: SqlValue, collation = "BINARY"): SqlValue {
    if (op === "IS") {
      return compareSqlValues(l, r, collation) === 0 ? 1 : 0;
    }
    if (op === "IS NOT") {
      return compareSqlValues(l, r, collation) !== 0 ? 1 : 0;
    }
    if (op === "->" || op === "->>") {
      if (l === null || r === null) {
        return null;
      }
      try {
        const parsed = JSON.parse(toSqlString(l));
        const path =
          typeof r === "number"
            ? `$[${r}]`
            : toSqlString(r).startsWith("$")
              ? toSqlString(r)
              : `$.${toSqlString(r)}`;
        const extracted = extractByJsonPath(parsed, path);
        const value = jsonValueToSql(extracted, op === "->>");
        return op === "->" && typeof value === "string" ? new JsonText(value) : value;
      } catch {
        return null;
      }
    }
    if (l === null || r === null) {
      return null;
    }
    switch (op) {
      case "||":
        return `${toSqlString(l)}${toSqlString(r)}`;
      case "+":
      case "-":
      case "*":
      case "/":
      case "%": {
        const left = arithmeticNumber(l);
        const right = arithmeticNumber(r);
        const real =
          left instanceof Number ||
          right instanceof Number ||
          !Number.isInteger(Number(left)) ||
          !Number.isInteger(Number(right));
        if ((op === "/" || op === "%") && Number(right) === 0) return null;
        if (!real || op === "%") {
          const a = integerPrefix(left);
          const b = integerPrefix(right);
          if ((op === "/" || op === "%") && b === 0n) return null;
          const result =
            op === "+"
              ? a + b
              : op === "-"
                ? a - b
                : op === "*"
                  ? a * b
                  : op === "/"
                    ? a / b
                    : a % b;
          return real ? new Number(Number(result)) : integerResult(result);
        }
        const a = Number(left);
        const b = Number(right);
        return new Number(op === "+" ? a + b : op === "-" ? a - b : op === "*" ? a * b : a / b);
      }
      case "<<":
      case ">>": {
        const value = BigInt.asIntN(64, integerPrefix(l));
        let count = integerPrefix(r);
        let left = op === "<<";
        if (count < 0n) {
          left = !left;
          count = -count;
        }
        if (count >= 64n) return !left && value < 0n ? -1 : 0;
        return integerResult(BigInt.asIntN(64, left ? value << count : value >> count));
      }
      case "&":
        return integerResult(BigInt.asIntN(64, integerPrefix(l) & integerPrefix(r)));
      case "|":
        return integerResult(BigInt.asIntN(64, integerPrefix(l) | integerPrefix(r)));
      case "=":
      case "==":
        return sqlEquals(l, r, collation) ? 1 : 0;
      case "!=":
      case "<>":
        return sqlEquals(l, r, collation) ? 0 : 1;
      case "<":
        return compareSqlValues(l, r, collation) < 0 ? 1 : 0;
      case "<=":
        return compareSqlValues(l, r, collation) <= 0 ? 1 : 0;
      case ">":
        return compareSqlValues(l, r, collation) > 0 ? 1 : 0;
      case ">=":
        return compareSqlValues(l, r, collation) >= 0 ? 1 : 0;
      case "LIKE":
        return matchLike(toSqlString(l), toSqlString(r), true) ? 1 : 0;
      case "GLOB":
        return matchGlob(toSqlString(l), toSqlString(r)) ? 1 : 0;
      case "REGEXP":
        try {
          return new RegExp(toSqlString(r)).test(toSqlString(l)) ? 1 : 0;
        } catch {
          return 0;
        }
      default:
        return null;
    }
  }

  private applyCast(v: SqlValue, targetType: string): SqlValue {
    if (v === null || v === undefined) {
      return null;
    }
    if (targetType.includes("INT")) {
      const exact = integerPrefix(v);
      return integerResult(exact < INT64_MIN ? INT64_MIN : exact > INT64_MAX ? INT64_MAX : exact);
    }
    if (targetType.includes("CHAR") || targetType.includes("CLOB") || targetType.includes("TEXT")) {
      return toSqlString(v);
    }
    if (targetType.includes("BLOB") || targetType === "NONE") {
      return v instanceof Uint8Array ? v : textEncoder.encode(toSqlString(v));
    }
    if (targetType.includes("REAL") || targetType.includes("FLOA") || targetType.includes("DOUB")) {
      return new Number(toSqlNumber(v));
    }
    const n = toSqlNumber(v);
    return Number.isInteger(n) ? n : n;
  }

  private *evalScalarFunction(name: string, args: SqlValue[]): SqlSteps<SqlValue> {
    const value = yield* this.evalScalarFunctionValue(name, args);
    const u = name.toUpperCase();
    const jsonResult = ["JSON", "JSON_ARRAY", "JSON_OBJECT", "JSON_QUOTE", "JSON_PATCH", "JSON_REMOVE", "JSON_SET", "JSON_INSERT", "JSON_REPLACE"].includes(u);
    return jsonResult && typeof value === "string" ? new JsonText(value) : value;
  }

  private *evalScalarFunctionValue(name: string, args: SqlValue[]): SqlSteps<SqlValue> {
    const u = name.toUpperCase();
    const a0 = args[0] ?? null;
    const a1 = args[1] ?? null;

    switch (u) {
      case "NULLIF":
        return sqlEquals(a0, a1) === true ? null : a0;
      case "TYPEOF":
        if (a0 === null || a0 === undefined) {
          return "null";
        }
        if (typeof a0 === "bigint") {
          return "integer";
        }
        if (a0 instanceof Number) {
          return "real";
        }
        if (typeof a0 === "number") {
          return Number.isInteger(a0) ? "integer" : "real";
        }
        if (typeof a0 === "string" || a0 instanceof String) {
          return "text";
        }
        return "blob";
      case "LENGTH":
        if (a0 === null) {
          return null;
        }
        if (a0 instanceof Uint8Array) {
          return a0.byteLength;
        }
        return Array.from(toSqlString(a0)).length;
      case "OCTET_LENGTH":
        if (a0 === null) {
          return null;
        }
        if (a0 instanceof Uint8Array) {
          return a0.byteLength;
        }
        return textEncoder.encode(toSqlString(a0)).byteLength;
      case "UPPER":
        return a0 === null ? null : toSqlString(a0).toUpperCase();
      case "LOWER":
        return a0 === null ? null : toSqlString(a0).toLowerCase();
      case "TRIM":
      case "LTRIM":
      case "RTRIM": {
        if (a0 === null) {
          return null;
        }
        const s = toSqlString(a0);
        const chars = a1 !== null && a1 !== undefined ? toSqlString(a1) : " ";
        const set = new Set(Array.from(chars));
        let start = 0;
        let end = s.length;
        if (u === "TRIM" || u === "LTRIM") {
          while (start < end && set.has(s[start]!)) {
            yield;
            start += 1;
          }
        }
        if (u === "TRIM" || u === "RTRIM") {
          while (end > start && set.has(s[end - 1]!)) {
            yield;
            end -= 1;
          }
        }
        return s.slice(start, end);
      }
      case "SUBSTR":
      case "SUBSTRING": {
        if (a0 === null || a1 === null) {
          return null;
        }
        const s = toSqlString(a0);
        const chars = Array.from(s);
        const pos = Math.trunc(toSqlNumber(a1));
        let len =
          args[2] !== undefined && args[2] !== null
            ? Math.trunc(toSqlNumber(args[2]))
            : chars.length;
        let startIdx: number;
        if (pos > 0) {
          startIdx = pos - 1;
        } else if (pos < 0) {
          startIdx = chars.length + pos;
        } else {
          startIdx = 0;
          // Position zero consumes one character before the string begins.
          if (args[2] !== undefined && args[2] !== null && len > 0) len -= 1;
        }
        if (len < 0) {
          const endIdx = Math.max(0, startIdx);
          const beginIdx = Math.max(0, endIdx + len);
          return chars.slice(beginIdx, endIdx).join("");
        }
        if (startIdx < 0) {
          const adjustedLen = Math.max(0, len + startIdx);
          return chars.slice(0, adjustedLen).join("");
        }
        return chars.slice(startIdx, startIdx + len).join("");
      }
      case "REPLACE":
        if (a0 === null || a1 === null || args[2] === null || args[2] === undefined) {
          return null;
        }
        if (toSqlString(a1) === "") {
          return toSqlString(a0);
        }
        return toSqlString(a0).split(toSqlString(a1)).join(toSqlString(args[2]));
      case "INSTR":
        if (a0 === null || a1 === null) {
          return null;
        }
        return toSqlString(a0).indexOf(toSqlString(a1)) + 1;
      case "PRINTF":
      case "FORMAT":
        if (a0 === null) {
          return null;
        }
        return sqlPrintf(toSqlString(a0), args.slice(1));
      case "CONCAT":
        return args
          .map((x) => {
            return x === null || x === undefined ? "" : toSqlString(x);
          })
          .join("");
      case "CONCAT_WS": {
        if (a0 === null) {
          return null;
        }
        const sep = toSqlString(a0);
        return (yield* stepFilter(args.slice(1), function* (x) { yield;
          return x !== null && x !== undefined;
        }, this))
          .map((x) => {
            return toSqlString(x);
          })
          .join(sep);
      }
      case "REVERSE":
        return a0 === null ? null : Array.from(toSqlString(a0)).reverse().join("");
      case "REPEAT":
        return a0 === null || a1 === null
          ? null
          : toSqlString(a0).repeat(Math.max(0, Math.trunc(toSqlNumber(a1))));
      case "LPAD":
        return a0 === null || a1 === null
          ? null
          : toSqlString(a0).padStart(
              Math.trunc(toSqlNumber(a1)),
              args[2] ? toSqlString(args[2]) : " "
            );
      case "RPAD":
        return a0 === null || a1 === null
          ? null
          : toSqlString(a0).padEnd(
              Math.trunc(toSqlNumber(a1)),
              args[2] ? toSqlString(args[2]) : " "
            );
      case "CHAR":
        return args
          .map((x) => {
            return String.fromCodePoint(Math.max(0, Math.trunc(toSqlNumber(x))));
          })
          .join("");
      case "UNICODE":
        if (a0 === null) {
          return null;
        }
        return toSqlString(a0).codePointAt(0) ?? null;
      case "HEX": {
        if (a0 === null) {
          return "";
        }
        const bytes = a0 instanceof Uint8Array ? a0 : textEncoder.encode(toSqlString(a0));
        let out = "";
        for (const b of bytes) {
          yield;
          out += b.toString(16).toUpperCase().padStart(2, "0");
        }
        return out;
      }
      case "UNHEX": {
        if (a0 === null) {
          return null;
        }
        const h = toSqlString(a0).replace(/\s+/g, "");
        if (h.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(h)) {
          return null;
        }
        const out = new Uint8Array(h.length / 2);
        for (let i = 0; i < out.length; i += 1) {
          yield;
          out[i] = Number.parseInt(h.slice(i * 2, i * 2 + 2), 16);
        }
        return out;
      }
      case "QUOTE":
        return this.toSqlLiteral(a0);
      case "ABS":
        if (typeof a0 === "bigint") {
          if (a0 === INT64_MIN) throw new Error("integer overflow");
          return integerResult(a0 < 0n ? -a0 : a0);
        }
        return a0 === null
          ? null
          : a0 instanceof Number
            ? new Number(Math.abs(a0.valueOf()))
            : Math.abs(toSqlNumber(a0));
      case "ROUND": {
        if (a0 === null) {
          return null;
        }
        const num = toSqlNumber(a0);
        const digits = a1 !== null && a1 !== undefined ? Math.trunc(toSqlNumber(a1)) : 0;
        const factor = 10 ** digits;
        const scaled = num * factor;
        const rounded = (scaled < 0 ? -Math.round(-scaled) : Math.round(scaled)) / factor;
        return new Number(Object.is(rounded, -0) ? 0 : rounded);
      }
      case "CEIL":
      case "CEILING":
        return a0 === null ? null : Math.ceil(toSqlNumber(a0));
      case "FLOOR":
        return a0 === null ? null : Math.floor(toSqlNumber(a0));
      case "TRUNC":
        return a0 === null ? null : Math.trunc(toSqlNumber(a0));
      case "SIGN": {
        if (a0 === null) {
          return null;
        }
        const n = toSqlNumber(a0);
        return n > 0 ? 1 : n < 0 ? -1 : 0;
      }
      case "SQRT":
        return a0 === null ? null : Math.sqrt(toSqlNumber(a0));
      case "POW":
      case "POWER":
        return a0 === null || a1 === null ? null : toSqlNumber(a0) ** toSqlNumber(a1);
      case "EXP":
        return a0 === null ? null : Math.exp(toSqlNumber(a0));
      case "LN":
        return a0 === null ? null : Math.log(toSqlNumber(a0));
      case "LOG":
      case "LOG10":
        return a0 === null
          ? null
          : a1 !== null && a1 !== undefined
            ? Math.log(toSqlNumber(a1)) / Math.log(toSqlNumber(a0))
            : Math.log10(toSqlNumber(a0));
      case "LOG2":
        return a0 === null ? null : Math.log2(toSqlNumber(a0));
      case "SIN":
        return a0 === null ? null : Math.sin(toSqlNumber(a0));
      case "COS":
        return a0 === null ? null : Math.cos(toSqlNumber(a0));
      case "TAN":
        return a0 === null ? null : Math.tan(toSqlNumber(a0));
      case "ASIN":
        return a0 === null ? null : Math.asin(toSqlNumber(a0));
      case "ACOS":
        return a0 === null ? null : Math.acos(toSqlNumber(a0));
      case "ATAN":
        return a0 === null ? null : Math.atan(toSqlNumber(a0));
      case "ATAN2":
        return a0 === null || a1 === null ? null : Math.atan2(toSqlNumber(a0), toSqlNumber(a1));
      case "PI":
        return Math.PI;
      case "DEGREES":
        return a0 === null ? null : (toSqlNumber(a0) * 180) / Math.PI;
      case "RADIANS":
        return a0 === null ? null : (toSqlNumber(a0) * Math.PI) / 180;
      case "MOD":
        return a0 === null || a1 === null || toSqlNumber(a1) === 0
          ? null
          : toSqlNumber(a0) % toSqlNumber(a1);
      case "MIN":
        if (
          args.some((x) => {
            return x === null || x === undefined;
          })
        ) {
          return null;
        }
        return yield* stepReduce(
          args,
          function* (m, x) { yield;
            return compareSqlValues(x, m) < 0 ? x : m;
          },
          args[0] ?? null
        , this);
      case "MAX":
        if (
          args.some((x) => {
            return x === null || x === undefined;
          })
        ) {
          return null;
        }
        return yield* stepReduce(
          args,
          function* (m, x) { yield;
            return compareSqlValues(x, m) > 0 ? x : m;
          },
          args[0] ?? null
        , this);
      case "RANDOM":
        return Math.floor((Math.random() - 0.5) * 2 * Number.MAX_SAFE_INTEGER);
      case "RANDOMBLOB": {
        const n = Math.max(0, Math.trunc(toSqlNumber(a0 ?? 0)));
        const b = new Uint8Array(n);
        for (let i = 0; i < n; i += 1) {
          yield;
          b[i] = Math.floor(Math.random() * 256);
        }
        return b;
      }
      case "ZEROBLOB": {
        const n = Math.max(0, Math.trunc(toSqlNumber(a0 ?? 0)));
        return new Uint8Array(n);
      }
      case "CHANGES":
        return this.lastChanges;
      case "TOTAL_CHANGES":
        return this.totalChanges;
      case "LAST_INSERT_ROWID":
        return this.lastInsertRowid;
      case "SQLITE_VERSION":
        return "3.45.0";
      case "SQLITE_SOURCE_ID":
        return "2024-01-15 17:01:13 1066602b2b1976fe58b5150777cced894af17c803e068f5918390d6915b46e1d";
      case "LIKELIHOOD":
      case "LIKELY":
      case "UNLIKELY":
        return a0;
      case "GLOB":
        return a0 === null || a1 === null
          ? null
          : matchGlob(toSqlString(a1), toSqlString(a0))
            ? 1
            : 0;
      case "LIKE":
        return a0 === null || a1 === null
          ? null
          : matchLike(toSqlString(a1), toSqlString(a0), true, args[2] ? toSqlString(args[2]) : "")
            ? 1
            : 0;
      case "DATE": {
        const d = parseSqliteDateTime(args.length === 0 ? ["now"] : args);
        return d ? formatStrftime("%Y-%m-%d", d) : null;
      }
      case "TIME": {
        const d = parseSqliteDateTime(args.length === 0 ? ["now"] : args);
        return d ? formatStrftime("%H:%M:%S", d) : null;
      }
      case "DATETIME": {
        const d = parseSqliteDateTime(args.length === 0 ? ["now"] : args);
        return d ? formatStrftime("%Y-%m-%d %H:%M:%S", d) : null;
      }
      case "JULIANDAY": {
        const d = parseSqliteDateTime(args.length === 0 ? ["now"] : args);
        return d ? d.getTime() / 86400000 + 2440587.5 : null;
      }
      case "UNIXEPOCH": {
        const d = parseSqliteDateTime(args.length === 0 ? ["now"] : args);
        return d ? Math.floor(d.getTime() / 1000) : null;
      }
      case "STRFTIME": {
        if (a0 === null) {
          return null;
        }
        const d = parseSqliteDateTime(args.length <= 1 ? ["now"] : args.slice(1));
        return d ? formatStrftime(toSqlString(a0), d) : null;
      }
      case "JSON": {
        if (a0 === null) {
          return null;
        }
        const text = toSqlString(a0);
        JSON.parse(text);
        let quoted = false;
        let escaped = false;
        let compact = "";
        for (const char of text) {
          if (quoted || ![" ", "\n", "\r", "\t"].includes(char)) compact += char;
          if (!escaped && char === '"') quoted = !quoted;
          escaped = quoted && !escaped && char === "\\";
        }
        return compact;
      }
      case "JSON_VALID": {
        if (a0 === null) {
          return null;
        }
        try {
          JSON.parse(toSqlString(a0));
          return 1;
        } catch {
          return 0;
        }
      }
      case "JSON_QUOTE":
        return a0 === null ? "null" : serializeSqlJson(a0);
      case "JSON_ARRAY":
        return serializeSqlJson(args);
      case "JSON_OBJECT": {
        const entries: string[] = [];
        for (let i = 0; i + 1 < args.length; i += 2) {
          yield;
          if (args[i] !== null && args[i] !== undefined) {
            entries.push(`${JSON.stringify(toSqlString(args[i]!))}:${serializeSqlJson(args[i + 1] ?? null)}`);
          }
        }
        return `{${entries.join(",")}}`;
      }
      case "JSON_EXTRACT": {
        if (a0 === null) {
          return null;
        }
        try {
          const parsed = JSON.parse(toSqlString(a0));
          if (args.length <= 2) {
            const extracted = extractByJsonPath(parsed, toSqlString(a1 ?? "$"));
            const value = jsonValueToSql(extracted, true);
            return extracted !== null && typeof extracted === "object" && typeof value === "string" ? new JsonText(value) : value;
          }
          const arr = args.slice(1).map((p) => {
            const v = extractByJsonPath(parsed, toSqlString(p ?? "$"));
            return v === undefined ? null : v;
          });
          return new JsonText(JSON.stringify(arr));
        } catch {
          return null;
        }
      }
      case "JSON_TYPE": {
        if (a0 === null) {
          return null;
        }
        try {
          const parsed = JSON.parse(toSqlString(a0));
          const target =
            a1 !== null && a1 !== undefined ? extractByJsonPath(parsed, toSqlString(a1)) : parsed;
          if (target === undefined) {
            return null;
          }
          if (target === null) {
            return "null";
          }
          if (target === true) {
            return "true";
          }
          if (target === false) {
            return "false";
          }
          if (typeof target === "number") {
            return Number.isInteger(target) ? "integer" : "real";
          }
          if (typeof target === "string") {
            return "text";
          }
          return Array.isArray(target) ? "array" : "object";
        } catch {
          return null;
        }
      }
      case "JSON_ARRAY_LENGTH": {
        if (a0 === null) {
          return null;
        }
        try {
          const parsed = JSON.parse(toSqlString(a0));
          const target =
            a1 !== null && a1 !== undefined ? extractByJsonPath(parsed, toSqlString(a1)) : parsed;
          return Array.isArray(target) ? target.length : 0;
        } catch {
          return null;
        }
      }
      case "JSON_SET":
      case "JSON_INSERT":
      case "JSON_REPLACE": {
        if (a0 === null) {
          return null;
        }
        try {
          let cur = JSON.parse(toSqlString(a0));
          const mode = u === "JSON_SET" ? "set" : u === "JSON_INSERT" ? "insert" : "replace";
          for (let i = 1; i + 1 < args.length; i += 2) {
            yield;
            const p = toSqlString(args[i] ?? "$");
            const value = args[i + 1] ?? null;
            const v = value instanceof JsonText ? JSON.parse(value.valueOf()) : value;
            cur = setByJsonPath(cur, p, v, mode);
          }
          return serializeSqlJson(cur);
        } catch {
          return null;
        }
      }
      case "JSON_REMOVE": {
        if (a0 === null) {
          return null;
        }
        try {
          let cur = JSON.parse(toSqlString(a0));
          for (let i = 1; i < args.length; i += 1) {
            yield;
            cur = removeByJsonPath(cur, toSqlString(args[i] ?? "$"));
          }
          return serializeSqlJson(cur);
        } catch {
          return null;
        }
      }
      case "JSON_PATCH": {
        if (a0 === null || a1 === null) {
          return null;
        }
        try {
          const target = JSON.parse(toSqlString(a0));
          const patch = JSON.parse(toSqlString(a1));
          const applyMergePatch = (t: any, p: any): any => {
            if (p === null || typeof p !== "object" || Array.isArray(p)) {
              return p;
            }
            const res = t && typeof t === "object" && !Array.isArray(t) ? { ...t } : {};
            for (const [k, v] of Object.entries(p)) {
              if (v === null) {
                delete res[k];
              } else {
                res[k] = applyMergePatch(res[k], v);
              }
            }
            return res;
          };
          return JSON.stringify(applyMergePatch(target, patch));
        } catch {
          return null;
        }
      }
      default:
        return null;
    }
  }
}
