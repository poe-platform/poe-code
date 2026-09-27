import {
  type SqlValue,
  type StoredTableMeta,
  readSqliteDatabaseBytes,
  writeSqliteDatabaseBytes
} from "./btree.js";

export type { SqlValue };

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
  uniqueColSets: string[][];
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
      } | undefined;
    }
  | { kind: "subquery"; sql: string; exists?: boolean; notExists?: boolean };

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
            }
          | undefined;
        if (this.matchWord("OVER")) {
          const partitionBy: ExprNode[] = [];
          const orderBy: { expr: ExprNode; desc: boolean; nulls?: "FIRST" | "LAST" | undefined }[] = [];
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
            // Skip optional frame clause (ROWS/RANGE/GROUPS ...)
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
          over = { partitionBy, orderBy };
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
  if (typeof v === "string") {
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
    let sA = a as string;
    let sB = b as string;
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
  if (typeof v === "string") {
    const trimmed = v.trim();
    const m = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(trimmed);
    return m ? Number(m[0]) : 0;
  }
  return 0;
}

// SQLite derives affinity from the declared type in this precedence order.
function applyColumnAffinity(value: SqlValue, declaredType: string): SqlValue {
  if (value === null || value instanceof Uint8Array) return value;
  const type = declaredType.toUpperCase();
  const integer = type.includes("INT");
  if (!integer && ["CHAR", "CLOB", "TEXT"].some((part) => type.includes(part))) {
    return toSqlString(value);
  }
  if (!integer && (type === "" || type.includes("BLOB"))) return value;
  const real = !integer && ["REAL", "FLOA", "DOUB"].some((part) => type.includes(part));
  if (typeof value === "string") {
    const text = value.trim();
    if (!text || ![...text].every((char) => "0123456789.+-eE".includes(char)) || Number.isNaN(Number(text))) return value;
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
  if (typeof v === "string") {
    return v;
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

function matchLike(str: string, pattern: string, caseInsensitive: boolean, escapeChar = ""): boolean {
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
    return unquoteScalar ? v : JSON.stringify(v);
  }
  return JSON.stringify(v);
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
  private outerRows: Record<string, SqlValue>[] = [];
  private preparing = false;
  private txSnapshot: SnapshotState | null = null;
  private savepoints = new Map<string, SnapshotState>();

  private captureSnapshot(): SnapshotState {
    const tables = new Map<string, TableDef>();
    for (const [k, v] of this.tables) {
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

  private restoreSnapshot(snap: SnapshotState): void {
    this.tables = new Map();
    for (const [k, v] of snap.tables) {
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
    if (bytes.byteLength === 0) {
      return;
    }
    const image = readSqliteDatabaseBytes(bytes);
    if (!image) {
      // Check if it's plain SQL dump text
      const text = textDecoder.decode(bytes);
      if (/^\s*(CREATE|INSERT|BEGIN|PRAGMA|--)/i.test(text)) {
        this.exec(text);
        return;
      }
      throw new Error("file is not a database");
    }
    this.userVersion = image.userVersion;
    this.applicationId = image.applicationId;
    this.schemaCookie = image.schemaCookie;
    this.loadedMaster = image.master.map((m) => ({ ...m }));

    const preservedMaster = image.master.map((m) => ({ ...m }));
    for (const m of image.master) {
      if (m.name.startsWith("sqlite_autoindex_") || m.name.toLowerCase() === "sqlite_sequence") {
        continue;
      }
      if (m.sql) {
        try {
          this.exec(m.sql);
        } catch {
          // Ignore malformed legacy DDL if any
        }
      }
    }
    this.loadedMaster = preservedMaster;

    for (const [tblName, rawRows] of image.tableRows.entries()) {
      const tbl = this.findTable(tblName);
      if (!tbl) {
        continue;
      }
      tbl.rows = [];
      let maxRowid = 0;
      for (const r of rawRows) {
        const data: Record<string, SqlValue> = {};
        let valIdx = 0;
        for (const col of tbl.columns) {
          if (col.primaryKey && col.type.toUpperCase() === "INTEGER" && !tbl.withoutRowId && tbl.primaryKeyCols.length === 1) {
            const cellVal = r.values[valIdx];
            data[col.name] = cellVal === null || cellVal === undefined ? r.rowid : cellVal;
          } else {
            let cellVal = r.values[valIdx] ?? null;
            if (typeof cellVal === "number" && Number.isInteger(cellVal) && /(REAL|FLOA|DOUB)/i.test(col.type)) {
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
    const master: StoredTableMeta[] = [];
    const tableRows = new Map<string, { rowid: number; values: SqlValue[] }[]>();
    const indexRows = new Map<string, SqlValue[][]>();
    const seqRows: { rowid: number; values: SqlValue[] }[] = [];
    let hasAutoIncTable = false;

    let rootPageCounter = 2;
    for (const tbl of this.tables.values()) {
      master.push({
        type: "table",
        name: tbl.name,
        tbl_name: tbl.name,
        rootpage: rootPageCounter++,
        sql: tbl.sql
      });
      if (tbl.columns.some((c) => c.autoIncrement) || tbl.maxAutoInc > 0) {
        if (tbl.columns.some((c) => c.autoIncrement)) {
          hasAutoIncTable = true;
        }
        if (tbl.maxAutoInc > 0) {
          seqRows.push({
            rowid: seqRows.length + 1,
            values: [tbl.name, tbl.maxAutoInc]
          });
        }
      }
      const rows = tbl.rows.map((r) => ({
        rowid: r.rowid,
        values: tbl.columns.map((c) => {
          const isRowidAlias =
            c.primaryKey &&
            c.type.toUpperCase() === "INTEGER" &&
            !tbl.withoutRowId &&
            tbl.primaryKeyCols.length === 1;
          return isRowidAlias ? null : (r.data[c.name] ?? null);
        })
      }));
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
      master.push({
        type: "index",
        name: idx.name,
        tbl_name: idx.tableName,
        rootpage: rootPageCounter++,
        sql: idx.sql
      });
      const tbl = this.findTable(idx.tableName);
      if (tbl) {
        const entries: SqlValue[][] = tbl.rows.map((r) => [
          ...idx.columns.map((colName) => {
            const cleaned = colName.replace(/\s+(ASC|DESC)$/i, "").trim();
            const matchCol = tbl.columns.find((c) => c.name.toLowerCase() === cleaned.toLowerCase());
            return matchCol ? (r.data[matchCol.name] ?? null) : null;
          }),
          r.rowid
        ]);
        indexRows.set(idx.name, entries);
      }
    }
    for (const v of this.views.values()) {
      master.push({
        type: "view",
        name: v.name,
        tbl_name: v.name,
        rootpage: 0,
        sql: v.sql
      });
    }
    for (const tr of this.triggers.values()) {
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
    const stmts = splitSqlStatements(sql);
    const results: QueryResultSet[] = [];
    for (const stmt of stmts) {
      const res = this.executeStatement(stmt, positionalParams);
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
        this.txSnapshot = this.captureSnapshot();
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
      const toIdx = tokens.findIndex((t) => t.value.toUpperCase() === "TO");
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
        this.restoreSnapshot(snap);
        return null;
      }
      if (this.txSnapshot) {
        this.restoreSnapshot(this.txSnapshot);
      }
      this.inTransaction = false;
      this.txSnapshot = null;
      this.savepoints.clear();
      return null;
    }

    if (first === "SAVEPOINT") {
      const spName = (tokens[1]?.value ?? "").toLowerCase();
      this.savepoints.set(spName, this.captureSnapshot());
      return null;
    }

    if (first === "RELEASE") {
      const spIdx = tokens[1]?.value.toUpperCase() === "SAVEPOINT" ? 2 : 1;
      const spName = (tokens[spIdx]?.value ?? "").toLowerCase();
      this.savepoints.delete(spName);
      return null;
    }

    if (first === "VACUUM" || first === "ANALYZE" || first === "REINDEX" || first === "ATTACH" || first === "DETACH") {
      return null;
    }

    if (first === "PRAGMA") {
      return this.executePragma(tokens);
    }

    if (first === "CREATE") {
      this.executeCreate(sql, tokens, positionalParams);
      this.schemaCookie += 1;
      return null;
    }

    if (first === "DROP") {
      this.executeDrop(tokens);
      this.schemaCookie += 1;
      return null;
    }

    if (first === "ALTER") {
      this.executeAlter(tokens);
      this.schemaCookie += 1;
      return null;
    }

    if (first === "INSERT" || first === "REPLACE") {
      return this.executeInsert(sql, tokens, positionalParams, cteScope);
    }

    if (first === "UPDATE") {
      return this.executeUpdate(tokens, positionalParams, cteScope);
    }

    if (first === "DELETE") {
      return this.executeDelete(tokens, positionalParams, cteScope);
    }

    if (first === "WITH") {
      return this.executeWith(tokens, positionalParams, cteScope);
    }

    if (first === "SELECT" || first === "VALUES") {
      return this.executeSelectCompound(tokens, positionalParams, cteScope);
    }

    throw new Error(`near "${tokens[0]!.raw}": syntax error`);
  }

  private executePragma(tokens: Token[]): QueryResultSet | null {
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
        this.foreignKeys = u === "1" || u === "ON" || u === "TRUE";
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
        const pkIdx = tbl.primaryKeyCols.findIndex((p) => p.toLowerCase() === c.name.toLowerCase());
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
        if (idxDef.tableName.toLowerCase() === tName) {
          rows.push([seq++, idxDef.name, idxDef.unique ? 1 : 0, "c", 0]);
        }
      }
      return { columns: ["seq", "name", "unique", "origin", "partial"], rows };
    }
    if (name === "index_info") {
      const iName = (arg ?? "").toLowerCase();
      for (const idxDef of this.indexes.values()) {
        if (idxDef.name.toLowerCase() === iName) {
          const tbl = this.findTable(idxDef.tableName);
          const rows: SqlValue[][] = idxDef.columns.map((colName, seqno) => {
            const cid = tbl?.columns.findIndex((c) => c.name.toLowerCase() === colName.toLowerCase()) ?? 0;
            return [seqno, cid, colName];
          });
          return { columns: ["seqno", "cid", "name"], rows };
        }
      }
      return { columns: ["seqno", "cid", "name"], rows: [] };
    }
    if (name === "foreign_key_list") {
      return { columns: ["id", "seq", "table", "from", "to", "on_update", "on_delete", "match"], rows: [] };
    }
    if (name === "compile_options") {
      return {
        columns: ["compile_options"],
        rows: [["ENABLE_FTS5"], ["ENABLE_JSON1"], ["ENABLE_MATH_FUNCTIONS"], ["ENABLE_RTREE"], ["THREADSAFE=1"]]
      };
    }
    return null;
  }

  private executeCreate(sql: string, tokens: Token[], positionalParams: SqlValue[]): void {
    let idx = 1;
    let unique = false;
    if (tokens[idx]?.value.toUpperCase() === "TEMP" || tokens[idx]?.value.toUpperCase() === "TEMPORARY") {
      idx += 1;
    }
    if (tokens[idx]?.value.toUpperCase() === "UNIQUE") {
      unique = true;
      idx += 1;
    }
    const kind = (tokens[idx]?.value ?? "").toUpperCase();
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

      // Check CREATE TABLE ... AS SELECT
      const asIdx = tokens.findIndex((t, i) => i >= idx && t.value.toUpperCase() === "AS");
      if (asIdx !== -1 && tokens[idx]?.value !== "(") {
        const selectTokens = tokens.slice(asIdx + 1);
        const res = this.executeSelectCompound(selectTokens, positionalParams, new Map());
        const columns: ColumnDef[] = res.columns.map((c) => ({
          name: c,
          type: "TEXT",
          notNull: false,
          primaryKey: false,
          autoIncrement: false,
          unique: false
        }));
        const rows: TableRow[] = res.rows.map((r, rIdx) => {
          const data: Record<string, SqlValue> = {};
          res.columns.forEach((c, cIdx) => {
            data[c] = r[cIdx] ?? null;
          });
          return { rowid: rIdx + 1, data };
        });
        this.tables.set(objName, {
          name: objName,
          sql: `CREATE TABLE ${objName}(${columns.map((c) => `"${c.name}"`).join(",")})`,
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
        openParen += 1;
      }
      let depth = 1;
      let closeParen = openParen + 1;
      const bodyParts: Token[][] = [];
      let curPart: Token[] = [];
      while (closeParen < tokens.length && depth > 0) {
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

      const trailingTokens = tokens.slice(closeParen + 1).map((t) => t.value.toUpperCase());
      const withoutRowId = trailingTokens.includes("WITHOUT") && trailingTokens.includes("ROWID");
      const strict = trailingTokens.includes("STRICT");

      const columns: ColumnDef[] = [];
      const primaryKeyCols: string[] = [];
      const uniqueColSets: string[][] = [];

      for (const part of bodyParts) {
        if (part.length === 0) {
          continue;
        }
        let pIdx = 0;
        if (part[pIdx]?.value.toUpperCase() === "CONSTRAINT") {
          pIdx += 2;
        }
        const firstWord = (part[pIdx]?.value ?? "").toUpperCase();
        if (firstWord === "PRIMARY" && part[pIdx + 1]?.value.toUpperCase() === "KEY") {
          pIdx += 2;
          if (part[pIdx]?.value === "(") {
            pIdx += 1;
            while (pIdx < part.length && part[pIdx]?.value !== ")") {
              const colName = part[pIdx]!.value;
              if (colName !== "," && colName.toUpperCase() !== "ASC" && colName.toUpperCase() !== "DESC") {
                primaryKeyCols.push(colName);
              }
              pIdx += 1;
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
              const colName = part[pIdx]!.value;
              if (colName !== "," && colName.toUpperCase() !== "ASC" && colName.toUpperCase() !== "DESC") {
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
        }
        if (colDef.unique) {
          uniqueColSets.push([colDef.name]);
        }
      }

      if (primaryKeyCols.length === 1) {
        const pkCol = columns.find((c) => c.name.toLowerCase() === primaryKeyCols[0]!.toLowerCase());
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
        uniqueColSets
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
      const onIdx = tokens.findIndex((t, i) => i >= idx && t.value.toUpperCase() === "ON");
      const tableName = tokens[onIdx + 1]?.value ?? "";
      const cols: string[] = [];
      let p = onIdx + 2;
      if (tokens[p]?.value === "(") {
        p += 1;
        while (p < tokens.length && tokens[p]?.value !== ")") {
          const v = tokens[p]!.value;
          if (v !== "," && v.toUpperCase() !== "ASC" && v.toUpperCase() !== "DESC" && v.toUpperCase() !== "COLLATE") {
            cols.push(v);
          }
          p += 1;
        }
      }
      this.indexes.set(objName, {
        name: objName,
        tableName,
        unique,
        columns: cols,
        sql
      });
      if (unique) {
        const tbl = this.findTable(tableName);
        if (tbl && cols.length > 0) {
          tbl.uniqueColSets.push(cols);
        }
      }
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
          if (tokens[idx]!.value !== ",") {
            viewCols.push(tokens[idx]!.value);
          }
          idx += 1;
        }
        idx += 1;
      }
      const asIdx = tokens.findIndex((t, i) => i >= idx && t.value.toUpperCase() === "AS");
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
      } else if (w === "DEFAULT") {
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

  private executeAlter(tokens: Token[]): void {
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
      const colObj = tbl.columns.find((c) => c.name.toLowerCase() === oldCol.toLowerCase());
      if (!colObj) {
        throw new Error(`in prepare, no such column: "${oldCol}"`);
      }
      const realOld = colObj.name;
      colObj.name = newCol;
      for (const r of tbl.rows) {
        r.data[newCol] = r.data[realOld] ?? null;
        delete r.data[realOld];
      }
      return;
    }

    if (action === "ADD") {
      if (tokens[idx]?.value.toUpperCase() === "COLUMN") {
        idx += 1;
      }
      const colDef = this.parseColumnDefTokens(tokens.slice(idx));
      tbl.columns.push(colDef);
      const defVal = colDef.defaultExpr ? this.evalScalarSql(colDef.defaultExpr, {}, []) : null;
      for (const r of tbl.rows) {
        r.data[colDef.name] = defVal;
      }
      tbl.sql = tbl.sql.replace(/\)\s*$/, `, ${colDef.name} ${colDef.type})`);
      return;
    }

    if (action === "DROP") {
      if (tokens[idx]?.value.toUpperCase() === "COLUMN") {
        idx += 1;
      }
      const dropCol = tokens[idx]?.value ?? "";
      const colIdx = tbl.columns.findIndex((c) => c.name.toLowerCase() === dropCol.toLowerCase());
      if (colIdx === -1) {
        throw new Error(`in prepare, no such column: "${dropCol}"`);
      }
      const realName = tbl.columns[colIdx]!.name;
      tbl.columns.splice(colIdx, 1);
      for (const r of tbl.rows) {
        delete r.data[realName];
      }
    }
  }

  private fireTriggers(
    tableName: string,
    timing: TriggerDef["timing"],
    event: TriggerDef["event"],
    oldRow?: Record<string, SqlValue>,
    newRow?: Record<string, SqlValue>
  ): void {
    for (const tr of this.triggers.values()) {
      if (
        tr.tableName.toLowerCase() === tableName.toLowerCase() &&
        tr.timing === timing &&
        tr.event === event
      ) {
        const ctx: Record<string, SqlValue> = {};
        if (oldRow) {
          for (const [k, v] of Object.entries(oldRow)) {
            ctx[`OLD.${k}`] = v;
            ctx[`old.${k}`] = v;
          }
        }
        if (newRow) {
          for (const [k, v] of Object.entries(newRow)) {
            ctx[`NEW.${k}`] = v;
            ctx[`new.${k}`] = v;
          }
        }
        if (tr.whenExpr) {
          const cond = this.evalExpr(parseExprSql(tr.whenExpr), ctx, []);
          if (!isTruthy(cond)) {
            continue;
          }
        }
        let body = tr.bodySql;
        // Substitute NEW.col and OLD.col references with SQL literals in trigger body
        body = body.replace(/\b(NEW|OLD)\.([A-Za-z0-9_]+)\b/gi, (_, prefix: string, col: string) => {
          const source = prefix.toUpperCase() === "NEW" ? newRow : oldRow;
          if (!source) {
            return "NULL";
          }
          const matchKey = Object.keys(source).find((k) => k.toLowerCase() === col.toLowerCase());
          const val = matchKey ? source[matchKey] : null;
          return this.toSqlLiteral(val ?? null);
        });
        this.exec(body);
      }
    }
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
    if (typeof val === "string") {
      return `'${val.replace(/'/g, "''")}'`;
    }
    let hex = "";
    for (const b of val as Uint8Array) {
      hex += b.toString(16).padStart(2, "0").toUpperCase();
    }
    return `X'${hex}'`;
  }

  private checkConstraintsAndConflicts(
    tbl: TableDef,
    candidate: TableRow,
    excludeRowid?: number
  ): TableRow | null {
    // NOT NULL and CHECK constraints
    for (const col of tbl.columns) {
      const val = candidate.data[col.name] ?? null;
      if (col.notNull && val === null) {
        if (col.primaryKey && col.type.toUpperCase() === "INTEGER" && !tbl.withoutRowId) {
          candidate.data[col.name] = candidate.rowid;
        } else {
          throw new Error(`NOT NULL constraint failed: ${tbl.name}.${col.name}`);
        }
      }
      if (col.checkExpr && val !== null) {
        const ok = this.evalExpr(parseExprSql(col.checkExpr), candidate.data, []);
        if (ok !== null && !isTruthy(ok)) {
          throw new Error(`CHECK constraint failed: ${col.checkExpr}`);
        }
      }
    }

    // Check PRIMARY KEY and UNIQUE constraints against existing rows
    const keySets: string[][] = [];
    if (tbl.primaryKeyCols.length > 0) {
      keySets.push(tbl.primaryKeyCols);
    }
    for (const u of tbl.uniqueColSets) {
      keySets.push(u);
    }
    if (keySets.length === 0 && candidate.rowid >= tbl.nextRowId) {
      return null;
    }
    const resolvedKeySets = keySets.map((kSet) =>
      kSet.map((colName) => {
        const realCol = tbl.columns.find((c) => c.name.toLowerCase() === colName.toLowerCase());
        return { cKey: realCol ? realCol.name : colName, collate: realCol?.collate ?? "BINARY" };
      })
    );

    for (const existing of tbl.rows) {
      if (excludeRowid !== undefined && existing.rowid === excludeRowid) {
        continue;
      }
      if (existing.rowid === candidate.rowid) {
        return existing;
      }
      for (const kSet of resolvedKeySets) {
        let allEqual = true;
        for (const { cKey, collate } of kSet) {
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

  private executeInsert(
    _sql: string,
    tokens: Token[],
    positionalParams: SqlValue[],
    cteScope: Map<string, { columns: string[]; rows: SqlValue[][] }>
  ): QueryResultSet | null {
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

    let targetCols = tbl.columns.map((c) => c.name);
    if (tokens[idx]?.value === "(") {
      targetCols = [];
      idx += 1;
      while (idx < tokens.length && tokens[idx]?.value !== ")") {
        if (tokens[idx]!.value !== ",") {
          const cName = tokens[idx]!.value;
          const colMatch = tbl.columns.find((c) => c.name.toLowerCase() === cName.toLowerCase());
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

    const endValuesIdx = onConflictIdx !== -1 ? onConflictIdx : returningIdx !== -1 ? returningIdx : tokens.length;
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
        if (tokens[idx]?.value === "(") {
          idx += 1;
          const rowToks: Token[][] = [];
          let cur: Token[] = [];
          let d = 1;
          while (idx < endValuesIdx && d > 0) {
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
          const evaledRow = rowToks.map((rt) =>
            this.evalExpr(new ExprParser(rt).parseExpression(), {}, positionalParams)
          );
          valueRows.push(evaledRow);
        } else {
          idx += 1;
        }
      }
    } else {
      // INSERT INTO ... SELECT ...
      const selectRes = this.executeSelectCompound(tokens.slice(idx, endValuesIdx), positionalParams, cteScope);
      for (const r of selectRes.rows) {
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
          uIdx += 1;
        }
        uIdx += 1;
      }
      if (tokens[uIdx]?.value.toUpperCase() === "WHERE") {
        while (uIdx < tokens.length && tokens[uIdx]?.value.toUpperCase() !== "DO") {
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

    let insertedCount = 0;
    const affectedRows: TableRow[] = [];

    for (const vRow of valueRows) {
      const data: Record<string, SqlValue> = {};
      for (const col of tbl.columns) {
        if (col.defaultExpr !== undefined) {
          data[col.name] = this.evalScalarSql(col.defaultExpr, {}, positionalParams);
        } else {
          data[col.name] = null;
        }
      }

      for (let c = 0; c < targetCols.length; c += 1) {
        data[targetCols[c]!] = vRow[c] ?? null;
      }

      for (const col of tbl.columns) {
        data[col.name] = applyColumnAffinity(data[col.name] ?? null, col.type);
      }

      // Determine rowid
      let rowid = tbl.nextRowId;
      for (const col of tbl.columns) {
        if (col.autoIncrement) {
          rowid = Math.max(rowid, tbl.maxAutoInc + 1);
        }
        if (col.primaryKey && col.type.toUpperCase() === "INTEGER" && !tbl.withoutRowId && tbl.primaryKeyCols.length === 1) {
          const explicit = data[col.name];
          if (typeof explicit === "number" && Number.isInteger(explicit)) {
            rowid = explicit;
          } else if (explicit === null || explicit === undefined) {
            data[col.name] = rowid;
          }
        }
      }

      for (const col of tbl.columns) {
        if (col.generatedExpr) {
          data[col.name] = applyColumnAffinity(this.evalScalarSql(col.generatedExpr, data, positionalParams), col.type);
        }
      }

      const candidate: TableRow = { rowid, data };
      this.fireTriggers(tbl.name, "BEFORE", "INSERT", undefined, candidate.data);

      const conflictRow = this.checkConstraintsAndConflicts(tbl, candidate);
      if (conflictRow) {
        if (upsertDoNothing || conflictAction === "IGNORE") {
          continue;
        }
        if (upsertSetPairs.length > 0) {
          const ctx: Record<string, SqlValue> = { ...conflictRow.data };
          for (const [k, v] of Object.entries(conflictRow.data)) {
            ctx[`${tbl.name}.${k}`] = v;
          }
          for (const [k, v] of Object.entries(candidate.data)) {
            ctx[`excluded.${k}`] = v;
            ctx[`EXCLUDED.${k}`] = v;
          }
          if (upsertWhere) {
            const cond = this.evalExpr(upsertWhere, ctx, positionalParams);
            if (!isTruthy(cond)) {
              continue;
            }
          }
          for (const assign of upsertSetPairs) {
            const realCol = tbl.columns.find((c) => c.name.toLowerCase() === assign.col.toLowerCase());
            const colKey = realCol ? realCol.name : assign.col;
            conflictRow.data[colKey] = applyColumnAffinity(this.evalExpr(assign.expr, ctx, positionalParams), realCol?.type ?? "");
          }
          insertedCount += 1;
          affectedRows.push(conflictRow);
          continue;
        }
        if (conflictAction === "REPLACE") {
          const idxToRemove = tbl.rows.indexOf(conflictRow);
          if (idxToRemove !== -1) {
            tbl.rows.splice(idxToRemove, 1);
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
      this.fireTriggers(tbl.name, "AFTER", "INSERT", undefined, candidate.data);
    }

    this.lastChanges = insertedCount;
    this.totalChanges += insertedCount;

    if (returningIdx !== -1) {
      return this.evaluateReturning(tbl, affectedRows, tokens.slice(returningIdx + 1), positionalParams);
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

  private executeUpdate(
    tokens: Token[],
    positionalParams: SqlValue[],
    _cteScope: Map<string, { columns: string[]; rows: SqlValue[][] }>
  ): QueryResultSet | null {
    let idx = 1;
    if (tokens[idx]?.value.toUpperCase() === "OR") {
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
    if (tokens[idx]?.value.toUpperCase() !== "SET") {
      idx += 1; // Optional table alias
    }
    if (tokens[idx]?.value.toUpperCase() === "SET") {
      idx += 1;
    }

    let returningIdx = -1;
    let pDepth = 0;
    for (let i = idx; i < tokens.length; i += 1) {
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
    const { assignments, whereExpr } = this.parseSetAssignments(tokens.slice(idx, sliceEnd));

    let updated = 0;
    const affectedRows: TableRow[] = [];

    for (const row of tbl.rows) {
      const ctx: Record<string, SqlValue> = { ...row.data, rowid: row.rowid, _rowid_: row.rowid };
      for (const [k, v] of Object.entries(row.data)) {
        ctx[`${tbl.name}.${k}`] = v;
      }
      if (whereExpr) {
        const cond = this.evalExpr(whereExpr, ctx, positionalParams);
        if (!isTruthy(cond)) {
          continue;
        }
      }
      const oldData = { ...row.data };
      const newData = { ...row.data };
      for (const assign of assignments) {
        const realCol = tbl.columns.find((c) => c.name.toLowerCase() === assign.col.toLowerCase());
        const colKey = realCol ? realCol.name : assign.col;
        newData[colKey] = applyColumnAffinity(this.evalExpr(assign.expr, ctx, positionalParams), realCol?.type ?? "");
      }
      for (const col of tbl.columns) {
        if (col.generatedExpr) {
          newData[col.name] = applyColumnAffinity(this.evalScalarSql(col.generatedExpr, newData, positionalParams), col.type);
        }
      }
      this.fireTriggers(tbl.name, "BEFORE", "UPDATE", oldData, newData);
      const candidate: TableRow = { rowid: row.rowid, data: newData };
      const conflict = this.checkConstraintsAndConflicts(tbl, candidate, row.rowid);
      if (conflict) {
        throw new Error(`UNIQUE constraint failed: ${tbl.name}`);
      }
      row.data = newData;
      updated += 1;
      affectedRows.push(row);
      this.fireTriggers(tbl.name, "AFTER", "UPDATE", oldData, newData);
    }

    this.lastChanges = updated;
    this.totalChanges += updated;

    if (returningIdx !== -1) {
      return this.evaluateReturning(tbl, affectedRows, tokens.slice(returningIdx + 1), positionalParams);
    }
    return null;
  }

  private executeDelete(
    tokens: Token[],
    positionalParams: SqlValue[],
    _cteScope: Map<string, { columns: string[]; rows: SqlValue[][] }>
  ): QueryResultSet | null {
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

    let returningIdx = -1;
    let pDepth = 0;
    for (let i = idx; i < tokens.length; i += 1) {
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

    const kept: TableRow[] = [];
    const deletedRows: TableRow[] = [];

    for (const row of tbl.rows) {
      const ctx: Record<string, SqlValue> = { ...row.data, rowid: row.rowid, _rowid_: row.rowid };
      for (const [k, v] of Object.entries(row.data)) {
        ctx[`${tbl.name}.${k}`] = v;
      }
      if (whereExpr) {
        const cond = this.evalExpr(whereExpr, ctx, positionalParams);
        if (!isTruthy(cond)) {
          kept.push(row);
          continue;
        }
      }
      this.fireTriggers(tbl.name, "BEFORE", "DELETE", row.data, undefined);
      deletedRows.push(row);
      this.fireTriggers(tbl.name, "AFTER", "DELETE", row.data, undefined);
    }

    tbl.rows = kept;
    this.lastChanges = deletedRows.length;
    this.totalChanges += deletedRows.length;

    if (returningIdx !== -1) {
      return this.evaluateReturning(tbl, deletedRows, tokens.slice(returningIdx + 1), positionalParams);
    }
    return null;
  }

  private evaluateReturning(
    tbl: TableDef,
    rows: TableRow[],
    returningTokens: Token[],
    positionalParams: SqlValue[]
  ): QueryResultSet {
    const items = this.splitTopLevelComma(returningTokens);
    const outCols: string[] = [];
    const exprs: ExprNode[] = [];
    for (const itemToks of items) {
      if (itemToks.length === 1 && itemToks[0]!.value === "*") {
        for (const c of tbl.columns) {
          outCols.push(c.name);
          exprs.push({ kind: "column", name: c.name });
        }
      } else {
        const { expr, alias } = this.parseSelectTarget(itemToks);
        outCols.push(alias);
        exprs.push(expr);
      }
    }
    const outRows: SqlValue[][] = rows.map((r) => {
      const ctx = { ...r.data, rowid: r.rowid };
      return exprs.map((e) => this.evalExpr(e, ctx, positionalParams));
    });
    return { columns: outCols, rows: outRows };
  }

  private executeWith(
    tokens: Token[],
    positionalParams: SqlValue[],
    outerCtes: Map<string, { columns: string[]; rows: SqlValue[][] }>
  ): QueryResultSet | null {
    const cteMap = new Map(outerCtes);
    let idx = 1;
    let isRecursive = false;
    if (tokens[idx]?.value.toUpperCase() === "RECURSIVE") {
      isRecursive = true;
      idx += 1;
    }

    while (idx < tokens.length) {
      const cteName = tokens[idx]!.value;
      idx += 1;
      let explicitCols: string[] | undefined;
      if (tokens[idx]?.value === "(") {
        explicitCols = [];
        idx += 1;
        while (idx < tokens.length && tokens[idx]?.value !== ")") {
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
      if (tokens[idx]?.value.toUpperCase() === "NOT" && tokens[idx + 1]?.value.toUpperCase() === "MATERIALIZED") {
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
        const evaluated = this.evalRecursiveCte(cteName, explicitCols, bodyTokens, positionalParams, cteMap);
        cteMap.set(cteName.toLowerCase(), evaluated);
      } else {
        const res = this.executeSelectCompound(bodyTokens, positionalParams, cteMap);
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
    return this.executeStatement(mainSql, positionalParams, cteMap);
  }

  private containsTokenWord(tokens: Token[], word: string): boolean {
    const lower = word.toLowerCase();
    return tokens.some((t) => t.value.toLowerCase() === lower);
  }

  private evalRecursiveCte(
    cteName: string,
    explicitCols: string[] | undefined,
    bodyTokens: Token[],
    positionalParams: SqlValue[],
    cteMap: Map<string, { columns: string[]; rows: SqlValue[][] }>
  ): { columns: string[]; rows: SqlValue[][] } {
    // Split at top-level UNION / UNION ALL
    let d = 0;
    let unionIdx = -1;
    let unionAll = false;
    for (let i = 0; i < bodyTokens.length; i += 1) {
      const t = bodyTokens[i]!;
      if (t.value === "(") {
        d += 1;
      } else if (t.value === ")") {
        d -= 1;
      } else if (d === 0 && t.value.toUpperCase() === "UNION") {
        unionIdx = i;
        unionAll = bodyTokens[i + 1]?.value.toUpperCase() === "ALL";
        break;
      }
    }

    if (unionIdx === -1) {
      const res = this.executeSelectCompound(bodyTokens, positionalParams, cteMap);
      return { columns: explicitCols ?? res.columns, rows: res.rows };
    }

    const anchorTokens = bodyTokens.slice(0, unionIdx);
    const recTokens = bodyTokens.slice(unionIdx + (unionAll ? 2 : 1));

    const anchorRes = this.executeSelectCompound(anchorTokens, positionalParams, cteMap);
    const cols = explicitCols && explicitCols.length > 0 ? explicitCols : anchorRes.columns;
    if (this.preparing) {
      const scope = new Map(cteMap);
      scope.set(cteName.toLowerCase(), { columns: cols, rows: [] });
      this.executeSelectCompound(recTokens, positionalParams, scope);
      return { columns: cols, rows: [] };
    }
    const allRows: SqlValue[][] = [...anchorRes.rows];
    let workingRows: SqlValue[][] = [...anchorRes.rows];
    const seenKeys = new Set<string>();
    if (!unionAll) {
      for (const r of allRows) {
        seenKeys.add(JSON.stringify(r));
      }
    }

    let iterations = 0;
    const stepMap = new Map(cteMap);
    const cteKey = cteName.toLowerCase();
    while (workingRows.length > 0 && iterations < 5000) {
      iterations += 1;
      stepMap.set(cteKey, { columns: cols, rows: workingRows });
      const nextRes = this.executeSelectCompound(recTokens, positionalParams, stepMap);
      const nextWorking: SqlValue[][] = [];
      for (const r of nextRes.rows) {
        if (!unionAll) {
          const k = JSON.stringify(r);
          if (seenKeys.has(k)) {
            continue;
          }
          seenKeys.add(k);
        }
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

  private executeSelectCompound(
    tokens: Token[],
    positionalParams: SqlValue[],
    cteScope: Map<string, { columns: string[]; rows: SqlValue[][] }>
  ): QueryResultSet {
    if (tokens[0]?.value.toUpperCase() === "WITH") {
      return this.executeWith(tokens, positionalParams, cteScope) ?? { columns: [], rows: [] };
    }
    // Split by top-level UNION / UNION ALL / INTERSECT / EXCEPT
    // Note: ORDER BY and LIMIT at the very end apply to the entire compound query
    const segments: { op: "NONE" | "UNION" | "UNION ALL" | "INTERSECT" | "EXCEPT"; tokens: Token[] }[] = [];
    let d = 0;
    let start = 0;
    let pendingOp: "NONE" | "UNION" | "UNION ALL" | "INTERSECT" | "EXCEPT" = "NONE";

    for (let i = 0; i < tokens.length; i += 1) {
      const t = tokens[i]!;
      if (t.value === "(") {
        d += 1;
      } else if (t.value === ")") {
        d -= 1;
      } else if (d === 0) {
        const u = t.value.toUpperCase();
        if (u === "UNION" || u === "INTERSECT" || u === "EXCEPT") {
          segments.push({ op: pendingOp, tokens: tokens.slice(start, i) });
          if (u === "UNION" && tokens[i + 1]?.value.toUpperCase() === "ALL") {
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
      return this.executeSingleSelect(tokens, positionalParams, cteScope);
    }

    // Check if the last segment has top-level ORDER BY / LIMIT
    const lastSegTokens = tokens.slice(start);
    let orderLimitStart = -1;
    d = 0;
    for (let i = 0; i < lastSegTokens.length; i += 1) {
      const t = lastSegTokens[i]!;
      if (t.value === "(") {
        d += 1;
      } else if (t.value === ")") {
        d -= 1;
      } else if (d === 0) {
        const u = t.value.toUpperCase();
        if ((u === "ORDER" && lastSegTokens[i + 1]?.value.toUpperCase() === "BY") || u === "LIMIT") {
          orderLimitStart = i;
          break;
        }
      }
    }

    const tailClauses = orderLimitStart !== -1 ? lastSegTokens.slice(orderLimitStart) : [];
    const cleanLastTokens = orderLimitStart !== -1 ? lastSegTokens.slice(0, orderLimitStart) : lastSegTokens;
    segments.push({ op: pendingOp, tokens: cleanLastTokens });

    let acc: QueryResultSet = { columns: [], rows: [] };
    for (const seg of segments) {
      const res = this.executeSingleSelect(seg.tokens, positionalParams, cteScope);
      if (seg.op === "NONE") {
        acc = res;
      } else if (seg.op === "UNION ALL") {
        acc.rows.push(...res.rows);
      } else if (seg.op === "UNION") {
        const combined = [...acc.rows, ...res.rows];
        acc.rows = this.deduplicateResultRows(combined);
      } else if (seg.op === "INTERSECT") {
        const rightSet = new Set(res.rows.map((r) => JSON.stringify(r)));
        acc.rows = this.deduplicateResultRows(acc.rows.filter((r) => rightSet.has(JSON.stringify(r))));
      } else if (seg.op === "EXCEPT") {
        const rightSet = new Set(res.rows.map((r) => JSON.stringify(r)));
        acc.rows = this.deduplicateResultRows(acc.rows.filter((r) => !rightSet.has(JSON.stringify(r))));
      }
    }

    if (tailClauses.length > 0) {
      // Apply ORDER BY / LIMIT on `acc` by wrapping in a temp CTE
      const tmpScope = new Map(cteScope);
      tmpScope.set("__compound_res__", acc);
      const wrapToks = tokenizeSql(`SELECT * FROM __compound_res__ ${reconstructTokensSql(tailClauses)}`);
      return this.executeSingleSelect(wrapToks, positionalParams, tmpScope);
    }

    return acc;
  }

  private deduplicateResultRows(rows: SqlValue[][]): SqlValue[][] {
    const out: SqlValue[][] = [];
    const seen = new Set<string>();
    for (const r of rows) {
      const k = JSON.stringify(r);
      if (!seen.has(k)) {
        seen.add(k);
        out.push(r);
      }
    }
    return out;
  }

  private executeSingleSelect(
    tokens: Token[],
    positionalParams: SqlValue[],
    cteScope: Map<string, { columns: string[]; rows: SqlValue[][] }>
  ): QueryResultSet {
    if (tokens[0]?.value.toUpperCase() === "VALUES") {
      let idx = 1;
      const rows: SqlValue[][] = [];
      let maxCols = 0;
      while (idx < tokens.length) {
        if (tokens[idx]?.value === "(") {
          idx += 1;
          const exprs: Token[][] = [];
          let cur: Token[] = [];
          let d = 1;
          while (idx < tokens.length && d > 0) {
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
          const r = exprs.map((et) => this.evalExpr(new ExprParser(et).parseExpression(), {}, positionalParams));
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
      const whereExpr = whereTokens && whereTokens.length > 0 ? new ExprParser(whereTokens).parseExpression() : undefined;
      const targetItems = this.splitTopLevelComma(selectListTokens);
      const hasWildcard = targetItems.some(
        (itemToks) =>
          (itemToks.length === 1 && itemToks[0]!.value === "*") ||
          (itemToks.length === 3 && itemToks[1]!.value === "." && itemToks[2]!.value === "*")
      );
      const staticTargets = hasWildcard ? undefined : targetItems.map((itemToks) => this.parseSelectTarget(itemToks));
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
    let sourceSchema: { tableAlias: string; columns: string[] }[] = [];

    if (fromTokens && fromTokens.length > 0) {
      const built = this.evaluateFromClause(fromTokens, positionalParams, cteScope);
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
        if (itemToks.length === 1 && itemToks[0]!.value === "*") {
          for (const src of sourceSchema) {
            for (const col of src.columns) {
              selectTargets.push({
                expr: { kind: "column", table: src.tableAlias || undefined, name: col },
                alias: col
              });
            }
          }
        } else if (itemToks.length === 3 && itemToks[1]!.value === "." && itemToks[2]!.value === "*") {
          const tblAlias = itemToks[0]!.value;
          const src = sourceSchema.find((s) => s.tableAlias.toLowerCase() === tblAlias.toLowerCase());
          if (src) {
            for (const col of src.columns) {
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
    for (const source of sourceSchema) {
      for (const column of [...source.columns, "rowid", "_rowid_", "oid"]) {
        bindings[column] = null;
        bindings[`${source.tableAlias}.${column}`] = null;
      }
    }
    for (const target of selectTargets) this.validateColumns(target.expr, bindings, positionalParams, cteScope);
    const aliasBindings = { ...bindings };
    for (const target of selectTargets) aliasBindings[target.alias] = null;
    this.validateColumns(whereExpr, aliasBindings, positionalParams, cteScope);
    for (const clause of [groupByTokens, havingTokens, orderByTokens]) {
      if (clause) {
        for (const expression of this.splitTopLevelComma(clause)) {
          this.validateColumns(new ExprParser(expression).parseExpression(), aliasBindings, positionalParams, cteScope);
        }
      }
    }

    if (this.preparing) return { columns: selectTargets.map((target) => target.alias), rows: [] };

    // Evaluate WHERE after resolving identifiers
    if (whereExpr) {
      workingRows = workingRows.filter((row) => isTruthy(this.evalExpr(whereExpr, row, positionalParams, cteScope)));
    }

    // Check if query has aggregates or GROUP BY
    const hasGroupBy = Boolean(groupByTokens && groupByTokens.length > 0);
    const hasAggregateInSelect = selectTargets.some((t) => this.containsAggregate(t.expr));
    const hasAggregateInHaving = havingTokens
      ? this.containsAggregate(new ExprParser(havingTokens).parseExpression())
      : false;
    const isAggregatedQuery = hasGroupBy || hasAggregateInSelect || hasAggregateInHaving;

    let groupedRows: { representative: Record<string, SqlValue>; group: Record<string, SqlValue>[] }[] = [];

    if (isAggregatedQuery) {
      if (hasGroupBy) {
        const groupExprs = this.splitTopLevelComma(groupByTokens!).map((gt) =>
          new ExprParser(gt).parseExpression()
        );
        const groups = new Map<string, { representative: Record<string, SqlValue>; group: Record<string, SqlValue>[] }>();
        for (const row of workingRows) {
          const keyVals = groupExprs.map((ge) => {
            if (ge.kind === "literal" && typeof ge.value === "number" && Number.isInteger(ge.value)) {
              const idx1 = ge.value - 1;
              if (selectTargets[idx1]) {
                return this.evalExpr(selectTargets[idx1]!.expr, row, positionalParams, cteScope);
              }
            }
            return this.evalExpr(ge, row, positionalParams, cteScope);
          });
          const keyStr = JSON.stringify(keyVals.map((v) => [typeof v, v]));
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
        groupedRows = groupedRows.filter((g) => {
          // Provide select aliases in representative context
          const repCtx = { ...g.representative };
          for (const st of selectTargets) {
            if (!(st.alias in repCtx)) {
              repCtx[st.alias] = this.evalExprWithAgg(st.expr, g.representative, g.group, positionalParams, cteScope);
            }
          }
          return isTruthy(this.evalExprWithAgg(havingExpr, repCtx, g.group, positionalParams, cteScope));
        });
      }
    } else {
      groupedRows = workingRows.map((r) => ({ representative: r, group: [r] }));
    }

    // Evaluate window functions if any target has OVER (...)
    const windowResults = new Map<ExprNode, SqlValue[]>();
    for (const st of selectTargets) {
      this.collectWindowExprs(st.expr, groupedRows, positionalParams, cteScope, windowResults);
    }

    // Build projection rows + augmented sort contexts
    const projected: { values: SqlValue[]; ctx: Record<string, SqlValue>; group: Record<string, SqlValue>[] }[] =
      groupedRows.map((g, rowIdx) => {
        const repCtx = { ...g.representative };
        const values = selectTargets.map((st) => {
          const val = this.evalExprWithAggAndWindow(
            st.expr,
            repCtx,
            g.group,
            rowIdx,
            windowResults,
            positionalParams,
            cteScope
          );
          if (!(st.alias in repCtx)) {
            repCtx[st.alias] = val;
          }
          return val;
        });
        return { values, ctx: repCtx, group: g.group };
      });

    // 4. Deduplicate if SELECT DISTINCT
    let finalProjected = projected;
    if (distinct) {
      const seen = new Set<string>();
      finalProjected = projected.filter((p) => {
        const k = JSON.stringify(p.values);
        if (seen.has(k)) {
          return false;
        }
        seen.add(k);
        return true;
      });
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

      finalProjected.sort((a, b) => {
        for (const spec of orderSpecs) {
          let vA: SqlValue;
          let vB: SqlValue;
          if (spec.expr.kind === "literal" && typeof spec.expr.value === "number" && Number.isInteger(spec.expr.value)) {
            const colIdx = spec.expr.value - 1;
            vA = a.values[colIdx] ?? null;
            vB = b.values[colIdx] ?? null;
          } else {
            vA = this.evalExprWithAgg(spec.expr, a.ctx, a.group, positionalParams, cteScope);
            vB = this.evalExprWithAgg(spec.expr, b.ctx, b.group, positionalParams, cteScope);
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
      });
    }

    // 6. Evaluate LIMIT / OFFSET
    if (limitTokens && limitTokens.length > 0) {
      const offsetIdx = limitTokens.findIndex((t) => t.value.toUpperCase() === "OFFSET");
      const commaIdx = limitTokens.findIndex((t) => t.value === ",");
      let limitVal = -1;
      let offsetVal = 0;

      if (offsetIdx !== -1) {
        limitVal = Math.trunc(
          toSqlNumber(this.evalExpr(new ExprParser(limitTokens.slice(0, offsetIdx)).parseExpression(), {}, positionalParams))
        );
        offsetVal = Math.trunc(
          toSqlNumber(this.evalExpr(new ExprParser(limitTokens.slice(offsetIdx + 1)).parseExpression(), {}, positionalParams))
        );
      } else if (commaIdx !== -1) {
        // LIMIT offset, count
        offsetVal = Math.trunc(
          toSqlNumber(this.evalExpr(new ExprParser(limitTokens.slice(0, commaIdx)).parseExpression(), {}, positionalParams))
        );
        limitVal = Math.trunc(
          toSqlNumber(this.evalExpr(new ExprParser(limitTokens.slice(commaIdx + 1)).parseExpression(), {}, positionalParams))
        );
      } else {
        limitVal = Math.trunc(
          toSqlNumber(this.evalExpr(new ExprParser(limitTokens).parseExpression(), {}, positionalParams))
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
      rows: finalProjected.map((p) => p.values)
    };
  }

  private evaluateFromClause(
    fromTokens: Token[],
    positionalParams: SqlValue[],
    cteScope: Map<string, { columns: string[]; rows: SqlValue[][] }>
  ): { rows: Record<string, SqlValue>[]; schema: { tableAlias: string; columns: string[] }[] } {
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
          const u = t.value.toUpperCase();
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
      if (fromTokens[i]?.value.toUpperCase() === "ON") {
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
            const u = t.value.toUpperCase();
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
      if (fromTokens[i]?.value.toUpperCase() === "USING") {
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
      let joinType: JoinItem["joinType"] = "INNER";
      let natural = false;
      if (fromTokens[i]?.value === ",") {
        joinType = "CROSS";
        i += 1;
      } else {
        while (i < fromTokens.length) {
          const u = fromTokens[i]!.value.toUpperCase();
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
    const schema: { tableAlias: string; columns: string[] }[] = [];

    for (let itemIdx = 0; itemIdx < items.length; itemIdx += 1) {
      const item = items[itemIdx]!;
      const preparationScope: Record<string, SqlValue> = {};
      if (this.preparing) {
        for (const source of schema) {
          for (const column of [...source.columns, "rowid", "_rowid_", "oid"]) {
            preparationScope[column] = null;
            preparationScope[`${source.tableAlias}.${column}`] = null;
          }
        }
      }
      const resolved = this.resolveSingleTableSource(
        item.sourceTokens,
        this.preparing ? [preparationScope] : itemIdx === 0 ? [{}] : currentRows,
        positionalParams,
        cteScope
      );
      const prevCols = new Set(schema.flatMap((s) => s.columns.map((c) => c.toLowerCase())));
      schema.push({ tableAlias: resolved.alias, columns: resolved.columns });

      if (itemIdx === 0) {
        currentRows = resolved.rows;
        continue;
      }

      // Perform join between currentRows and resolved
      const nextRows: Record<string, SqlValue>[] = [];
      const onExpr = item.onTokens ? new ExprParser(item.onTokens).parseExpression() : undefined;
      const joinBindings: Record<string, SqlValue> = {};
      for (const source of schema) {
        for (const column of [...source.columns, "rowid", "_rowid_", "oid"]) {
          joinBindings[column] = null;
          joinBindings[`${source.tableAlias}.${column}`] = null;
        }
      }
      this.validateColumns(onExpr, joinBindings, positionalParams, cteScope);
      const usingList = item.natural
        ? resolved.columns.filter((c) => prevCols.has(c.toLowerCase()))
        : item.usingCols;

      const rightMatched = new Set<number>();

      for (const leftRow of currentRows) {
        const candidateRightRows = resolved.isCorrelated
          ? this.resolveSingleTableSource(item.sourceTokens, [leftRow], positionalParams, cteScope).rows
          : resolved.rows;

        let matchedLeft = false;
        for (let rIdx = 0; rIdx < candidateRightRows.length; rIdx += 1) {
          const rightRow = candidateRightRows[rIdx]!;
          const merged: Record<string, SqlValue> = { ...leftRow };
          for (const [k, v] of Object.entries(rightRow)) {
            if (k.includes(".") || !(k in merged) || merged[k] === null) {
              merged[k] = v;
            }
          }

          let matches = true;
          if (onExpr) {
            matches = isTruthy(this.evalExpr(onExpr, merged, positionalParams, cteScope));
          } else if (usingList && usingList.length > 0) {
            for (const uCol of usingList) {
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
            nextRows.push(merged);
          }
        }

        if (!matchedLeft && (item.joinType === "LEFT" || item.joinType === "FULL")) {
          const nullPadded: Record<string, SqlValue> = { ...leftRow };
          for (const col of resolved.columns) {
            nullPadded[`${resolved.alias}.${col}`] = null;
            if (!(col in nullPadded)) {
              nullPadded[col] = null;
            }
          }
          nextRows.push(nullPadded);
        }
      }

      if (item.joinType === "RIGHT" || item.joinType === "FULL") {
        for (let rIdx = 0; rIdx < resolved.rows.length; rIdx += 1) {
          if (!rightMatched.has(rIdx)) {
            const rightRow = resolved.rows[rIdx]!;
            const nullPadded: Record<string, SqlValue> = {};
            for (const s of schema.slice(0, -1)) {
              for (const col of s.columns) {
                nullPadded[`${s.tableAlias}.${col}`] = null;
                nullPadded[col] = null;
              }
            }
            Object.assign(nullPadded, rightRow);
            nextRows.push(nullPadded);
          }
        }
      }

      currentRows = nextRows;
    }

    return { rows: currentRows, schema };
  }

  private resolveSingleTableSource(
    srcTokens: Token[],
    outerRows: Record<string, SqlValue>[],
    positionalParams: SqlValue[],
    cteScope: Map<string, { columns: string[]; rows: SqlValue[][] }>
  ): { alias: string; columns: string[]; rows: Record<string, SqlValue>[]; isCorrelated?: boolean } {
    if (srcTokens.length === 0) {
      return { alias: "", columns: [], rows: [{}] };
    }

    // Subquery in FROM: (SELECT ...) [AS] alias
    if (srcTokens[0]!.value === "(") {
      let d = 1;
      let p = 1;
      const inner: Token[] = [];
      while (p < srcTokens.length && d > 0) {
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
      const res = this.executeStatement(reconstructTokensSql(inner), positionalParams, cteScope) ?? {
        columns: [],
        rows: []
      };
      const rows = res.rows.map((r) => {
        const obj: Record<string, SqlValue> = {};
        res.columns.forEach((c, idx) => {
          obj[c] = r[idx] ?? null;
          obj[`${alias}.${c}`] = r[idx] ?? null;
        });
        return obj;
      });
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
      const args = argToks.map((at) => {
        const expression = new ExprParser(at).parseExpression();
        if (this.preparing) {
          this.validateColumns(expression, outerCtx, positionalParams, cteScope);
          return null;
        }
        return this.evalExpr(expression, outerCtx, positionalParams, cteScope);
      });
      const tvf = this.evaluateTableValuedFunction(name, args);
      const rows = tvf.rows.map((r) => {
        const obj: Record<string, SqlValue> = {};
        tvf.columns.forEach((c, cIdx) => {
          obj[c] = r[cIdx] ?? null;
          obj[`${alias}.${c}`] = r[cIdx] ?? null;
          obj[`${name}.${c}`] = r[cIdx] ?? null;
        });
        return obj;
      });
      return { alias, columns: tvf.columns, rows, isCorrelated: argToks.some((at) => at.some((t) => t.type === "word" || t.type === "ident")) };
    }

    if (srcTokens[idx]?.value.toUpperCase() === "AS") {
      idx += 1;
    }
    const alias = srcTokens[idx]?.value ?? name;

    // Check CTE scope first
    const cte = cteScope.get(name.toLowerCase());
    if (cte) {
      const rows = cte.rows.map((r) => {
        const obj: Record<string, SqlValue> = {};
        cte.columns.forEach((c, cIdx) => {
          obj[c] = r[cIdx] ?? null;
          obj[`${alias}.${c}`] = r[cIdx] ?? null;
          obj[`${name}.${c}`] = r[cIdx] ?? null;
        });
        return obj;
      });
      return { alias, columns: cte.columns, rows };
    }

    // Check sqlite_master / sqlite_schema / sqlite_temp_master
    const lowerName = name.toLowerCase();
    if (lowerName === "sqlite_sequence" && !this.findTable("sqlite_sequence")) {
      const cols = ["name", "seq"];
      const seqResultRows: Record<string, SqlValue>[] = [];
      for (const tbl of this.tables.values()) {
        if ((tbl.columns.some((c) => c.autoIncrement) || tbl.maxAutoInc > 0) && tbl.maxAutoInc > 0) {
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
          const entry: Record<string, SqlValue> = {
            type: m.type,
            name: m.name,
            tbl_name: m.tbl_name,
            rootpage: m.rootpage,
            sql: m.sql || null
          };
          for (const c of cols) {
            entry[`${alias}.${c}`] = entry[c]!;
          }
          masterRows.push(entry);
        }
        return { alias, columns: cols, rows: masterRows };
      }
      let rp = 2;
      for (const tbl of this.tables.values()) {
        const entry: Record<string, SqlValue> = {
          type: "table",
          name: tbl.name,
          tbl_name: tbl.name,
          rootpage: rp++,
          sql: tbl.sql
        };
        for (const c of cols) {
          entry[`${alias}.${c}`] = entry[c]!;
        }
        masterRows.push(entry);
      }
      for (const idxDef of this.indexes.values()) {
        const entry: Record<string, SqlValue> = {
          type: "index",
          name: idxDef.name,
          tbl_name: idxDef.tableName,
          rootpage: rp++,
          sql: idxDef.sql
        };
        for (const c of cols) {
          entry[`${alias}.${c}`] = entry[c]!;
        }
        masterRows.push(entry);
      }
      for (const vDef of this.views.values()) {
        const entry: Record<string, SqlValue> = {
          type: "view",
          name: vDef.name,
          tbl_name: vDef.name,
          rootpage: 0,
          sql: vDef.sql
        };
        for (const c of cols) {
          entry[`${alias}.${c}`] = entry[c]!;
        }
        masterRows.push(entry);
      }
      for (const trDef of this.triggers.values()) {
        const entry: Record<string, SqlValue> = {
          type: "trigger",
          name: trDef.name,
          tbl_name: trDef.tableName,
          rootpage: 0,
          sql: trDef.sql
        };
        for (const c of cols) {
          entry[`${alias}.${c}`] = entry[c]!;
        }
        masterRows.push(entry);
      }
      return { alias, columns: cols, rows: masterRows };
    }

    // Check Views
    const view = this.findView(name);
    if (view) {
      const res = this.executeStatement(view.selectSql, positionalParams, cteScope) ?? { columns: [], rows: [] };
      const cols = view.columns && view.columns.length > 0 ? view.columns : res.columns;
      const rows = res.rows.map((r) => {
        const obj: Record<string, SqlValue> = {};
        cols.forEach((c, cIdx) => {
          obj[c] = r[cIdx] ?? null;
          obj[`${alias}.${c}`] = r[cIdx] ?? null;
          obj[`${name}.${c}`] = r[cIdx] ?? null;
        });
        return obj;
      });
      return { alias, columns: cols, rows };
    }

    // Check Tables
    const tbl = this.findTable(name);
    if (!tbl) {
      throw new Error(`no such table: ${name}`);
    }
    const cols = tbl.columns.map((c) => c.name);
    const rows = (this.preparing ? [] : tbl.rows).map((r) => {
      const obj: Record<string, SqlValue> = {
        rowid: r.rowid,
        _rowid_: r.rowid,
        oid: r.rowid,
        [`${alias}.rowid`]: r.rowid,
        [`${name}.rowid`]: r.rowid
      };
      for (const c of cols) {
        const val = r.data[c] ?? null;
        obj[c] = val;
        obj[`${alias}.${c}`] = val;
        obj[`${name}.${c}`] = val;
      }
      return obj;
    });
    return { alias, columns: cols, rows };
  }

  private evaluateTableValuedFunction(
    fnName: string,
    args: SqlValue[]
  ): { columns: string[]; rows: SqlValue[][] } {
    const lower = fnName.toLowerCase();
    if (lower === "generate_series") {
      if (this.preparing) return { columns: ["value"], rows: [] };
      const start = Math.trunc(toSqlNumber(args[0] ?? 1));
      const stop = Math.trunc(toSqlNumber(args[1] ?? start));
      const step = args[2] !== undefined ? Math.trunc(toSqlNumber(args[2])) : 1;
      const rows: SqlValue[][] = [];
      if (step > 0) {
        for (let v = start; v <= stop && rows.length < 100000; v += step) {
          rows.push([v]);
        }
      } else if (step < 0) {
        for (let v = start; v >= stop && rows.length < 100000; v += step) {
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

      const toRow = (key: SqlValue, val: unknown, parentId: SqlValue, fullkey: string, pathStr: string): number => {
        const myId = idCounter++;
        const tStr = getTypeStr(val);
        const isContainer = tStr === "array" || tStr === "object";
        const sqlVal: SqlValue = isContainer
          ? JSON.stringify(val)
          : val === null
            ? null
            : typeof val === "boolean"
              ? val ? 1 : 0
              : (val as string | number);
        const atom: SqlValue = isContainer ? null : sqlVal;
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
            toRow(k, item, null, `${rootPath}.${k}`, rootPath);
          }
        } else if (target !== undefined) {
          toRow(null, target, null, rootPath, rootPath);
        }
      } else {
        const walk = (node: unknown, key: SqlValue, parentId: SqlValue, fullkey: string, pathStr: string) => {
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
    if (expr.kind === "func") {
      if (expr.over) {
        return false; // Window functions are evaluated after grouping
      }
      const u = expr.name.toUpperCase();
      if (
        [
          "COUNT",
          "SUM",
          "TOTAL",
          "AVG",
          "MIN",
          "MAX",
          "GROUP_CONCAT",
          "STRING_AGG",
          "JSON_GROUP_ARRAY",
          "JSON_GROUP_OBJECT"
        ].includes(u)
      ) {
        if ((u === "MIN" || u === "MAX") && expr.args.length > 1) {
          return expr.args.some((a) => this.containsAggregate(a));
        }
        return true;
      }
      return expr.args.some((a) => this.containsAggregate(a));
    }
    if (expr.kind === "unary") {
      return this.containsAggregate(expr.expr);
    }
    if (expr.kind === "binary") {
      return this.containsAggregate(expr.left) || this.containsAggregate(expr.right);
    }
    if (expr.kind === "case") {
      return (
        (expr.base ? this.containsAggregate(expr.base) : false) ||
        expr.branches.some((b) => this.containsAggregate(b.when) || this.containsAggregate(b.then)) ||
        (expr.elseExpr ? this.containsAggregate(expr.elseExpr) : false)
      );
    }
    if (expr.kind === "cast") {
      return this.containsAggregate(expr.expr);
    }
    return false;
  }

  private collectWindowExprs(
    expr: ExprNode,
    groupedRows: { representative: Record<string, SqlValue>; group: Record<string, SqlValue>[] }[],
    positionalParams: SqlValue[],
    cteScope: Map<string, { columns: string[]; rows: SqlValue[][] }>,
    out: Map<ExprNode, SqlValue[]>
  ): void {
    if (expr.kind === "func" && expr.over) {
      const values = this.evaluateWindowFunc(expr, groupedRows, positionalParams, cteScope);
      out.set(expr, values);
      return;
    }
    if (expr.kind === "unary") {
      this.collectWindowExprs(expr.expr, groupedRows, positionalParams, cteScope, out);
    } else if (expr.kind === "binary") {
      this.collectWindowExprs(expr.left, groupedRows, positionalParams, cteScope, out);
      this.collectWindowExprs(expr.right, groupedRows, positionalParams, cteScope, out);
    } else if (expr.kind === "func") {
      for (const a of expr.args) {
        this.collectWindowExprs(a, groupedRows, positionalParams, cteScope, out);
      }
    } else if (expr.kind === "case") {
      if (expr.base) {
        this.collectWindowExprs(expr.base, groupedRows, positionalParams, cteScope, out);
      }
      for (const b of expr.branches) {
        this.collectWindowExprs(b.when, groupedRows, positionalParams, cteScope, out);
        this.collectWindowExprs(b.then, groupedRows, positionalParams, cteScope, out);
      }
      if (expr.elseExpr) {
        this.collectWindowExprs(expr.elseExpr, groupedRows, positionalParams, cteScope, out);
      }
    } else if (expr.kind === "cast") {
      this.collectWindowExprs(expr.expr, groupedRows, positionalParams, cteScope, out);
    }
  }

  private evaluateWindowFunc(
    fnExpr: Extract<ExprNode, { kind: "func" }>,
    groupedRows: { representative: Record<string, SqlValue>; group: Record<string, SqlValue>[] }[],
    positionalParams: SqlValue[],
    cteScope: Map<string, { columns: string[]; rows: SqlValue[][] }>
  ): SqlValue[] {
    const result: SqlValue[] = new Array(groupedRows.length).fill(null);
    const over = fnExpr.over!;
    const partitions = new Map<string, number[]>();

    for (let i = 0; i < groupedRows.length; i += 1) {
      const g = groupedRows[i]!;
      const pKey = JSON.stringify(
        over.partitionBy.map((pe) => this.evalExprWithAgg(pe, g.representative, g.group, positionalParams, cteScope))
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
      if (over.orderBy.length > 0) {
        indices.sort((iA, iB) => {
          const gA = groupedRows[iA]!;
          const gB = groupedRows[iB]!;
          for (const ob of over.orderBy) {
            const vA = this.evalExprWithAgg(ob.expr, gA.representative, gA.group, positionalParams, cteScope);
            const vB = this.evalExprWithAgg(ob.expr, gB.representative, gB.group, positionalParams, cteScope);
            const cmp = compareSqlValues(vA, vB);
            if (cmp !== 0) {
              return ob.desc ? -cmp : cmp;
            }
          }
          return iA - iB;
        });
      }

      const orderPeerKeys = indices.map((idx) => {
        const g = groupedRows[idx]!;
        return JSON.stringify(
          over.orderBy.map((ob) => this.evalExprWithAgg(ob.expr, g.representative, g.group, positionalParams, cteScope))
        );
      });

      let currentRank = 1;
      let currentDenseRank = 1;

      for (let pPos = 0; pPos < indices.length; pPos += 1) {
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
          const buckets = Math.max(1, Math.trunc(toSqlNumber(this.evalExprWithAgg(fnExpr.args[0]!, g.representative, g.group, positionalParams, cteScope))));
          result[rowIdx] = Math.floor((pPos * buckets) / indices.length) + 1;
        } else if (fnUpper === "PERCENT_RANK") {
          result[rowIdx] = indices.length <= 1 ? 0 : (currentRank - 1) / (indices.length - 1);
        } else if (fnUpper === "CUME_DIST") {
          let peerEnd = pPos;
          while (peerEnd + 1 < indices.length && orderPeerKeys[peerEnd + 1] === orderPeerKeys[pPos]) {
            peerEnd += 1;
          }
          result[rowIdx] = (peerEnd + 1) / indices.length;
        } else if (fnUpper === "LAG" || fnUpper === "LEAD") {
          const offset = fnExpr.args[1]
            ? Math.trunc(toSqlNumber(this.evalExprWithAgg(fnExpr.args[1], g.representative, g.group, positionalParams, cteScope)))
            : 1;
          const defVal = fnExpr.args[2]
            ? this.evalExprWithAgg(fnExpr.args[2], g.representative, g.group, positionalParams, cteScope)
            : null;
          const targetPos = fnUpper === "LAG" ? pPos - offset : pPos + offset;
          if (targetPos < 0 || targetPos >= indices.length) {
            result[rowIdx] = defVal;
          } else {
            const targetG = groupedRows[indices[targetPos]!]!;
            result[rowIdx] = this.evalExprWithAgg(fnExpr.args[0]!, targetG.representative, targetG.group, positionalParams, cteScope);
          }
        } else if (fnUpper === "FIRST_VALUE") {
          const firstG = groupedRows[indices[0]!]!;
          result[rowIdx] = this.evalExprWithAgg(fnExpr.args[0]!, firstG.representative, firstG.group, positionalParams, cteScope);
        } else if (fnUpper === "LAST_VALUE") {
          let peerEnd = over.orderBy.length > 0 ? pPos : indices.length - 1;
          while (over.orderBy.length > 0 && peerEnd + 1 < indices.length && orderPeerKeys[peerEnd + 1] === orderPeerKeys[pPos]) {
            peerEnd += 1;
          }
          const lastG = groupedRows[indices[peerEnd]!]!;
          result[rowIdx] = this.evalExprWithAgg(fnExpr.args[0]!, lastG.representative, lastG.group, positionalParams, cteScope);
        } else if (fnUpper === "NTH_VALUE") {
          const n = Math.trunc(toSqlNumber(this.evalExprWithAgg(fnExpr.args[1]!, g.representative, g.group, positionalParams, cteScope)));
          if (n >= 1 && n <= indices.length) {
            const nthG = groupedRows[indices[n - 1]!]!;
            result[rowIdx] = this.evalExprWithAgg(fnExpr.args[0]!, nthG.representative, nthG.group, positionalParams, cteScope);
          } else {
            result[rowIdx] = null;
          }
        } else {
          // Aggregate window function (SUM, COUNT, AVG, MIN, MAX, etc.)
          let frameEnd = over.orderBy.length > 0 ? pPos : indices.length - 1;
          while (over.orderBy.length > 0 && frameEnd + 1 < indices.length && orderPeerKeys[frameEnd + 1] === orderPeerKeys[pPos]) {
            frameEnd += 1;
          }
          const frameRows = indices.slice(0, frameEnd + 1).flatMap((idx) => groupedRows[idx]!.group);
          const strippedFn: Extract<ExprNode, { kind: "func" }> = { ...fnExpr, over: undefined };
          result[rowIdx] = this.evalAggregateFunction(strippedFn, frameRows, positionalParams, cteScope);
        }
      }
    }

    return result;
  }

  private evalExprWithAggAndWindow(
    expr: ExprNode,
    rep: Record<string, SqlValue>,
    group: Record<string, SqlValue>[],
    rowIdx: number,
    windowResults: Map<ExprNode, SqlValue[]>,
    positionalParams: SqlValue[],
    cteScope: Map<string, { columns: string[]; rows: SqlValue[][] }>
  ): SqlValue {
    if (windowResults.has(expr)) {
      return windowResults.get(expr)![rowIdx] ?? null;
    }
    if (expr.kind === "unary") {
      const v = this.evalExprWithAggAndWindow(expr.expr, rep, group, rowIdx, windowResults, positionalParams, cteScope);
      return this.applyUnary(expr.op, v);
    }
    if (expr.kind === "binary") {
      const l = this.evalExprWithAggAndWindow(expr.left, rep, group, rowIdx, windowResults, positionalParams, cteScope);
      const r = this.evalExprWithAggAndWindow(expr.right, rep, group, rowIdx, windowResults, positionalParams, cteScope);
      return this.applyBinary(expr.op, l, r);
    }
    if (expr.kind === "func" && !this.containsAggregate(expr) && !expr.over) {
      const args = expr.args.map((a) =>
        this.evalExprWithAggAndWindow(a, rep, group, rowIdx, windowResults, positionalParams, cteScope)
      );
      return this.evalScalarFunction(expr.name, args);
    }
    return this.evalExprWithAgg(expr, rep, group, positionalParams, cteScope);
  }

  private evalExprWithAgg(
    expr: ExprNode,
    rep: Record<string, SqlValue>,
    group: Record<string, SqlValue>[],
    positionalParams: SqlValue[],
    cteScope: Map<string, { columns: string[]; rows: SqlValue[][] }>
  ): SqlValue {
    if (expr.kind === "func") {
      const u = expr.name.toUpperCase();
      if (
        [
          "COUNT",
          "SUM",
          "TOTAL",
          "AVG",
          "MIN",
          "MAX",
          "GROUP_CONCAT",
          "STRING_AGG",
          "JSON_GROUP_ARRAY",
          "JSON_GROUP_OBJECT"
        ].includes(u) &&
        !((u === "MIN" || u === "MAX") && expr.args.length > 1)
      ) {
        return this.evalAggregateFunction(expr, group, positionalParams, cteScope);
      }
      if (u === "COALESCE" || u === "IFNULL") {
        for (const a of expr.args) {
          const v = this.evalExprWithAgg(a, rep, group, positionalParams, cteScope);
          if (v !== null && v !== undefined) {
            return v;
          }
        }
        return null;
      }
      if (u === "IIF") {
        const cond = this.evalExprWithAgg(expr.args[0]!, rep, group, positionalParams, cteScope);
        return isTruthy(cond)
          ? this.evalExprWithAgg(expr.args[1]!, rep, group, positionalParams, cteScope)
          : expr.args[2]
            ? this.evalExprWithAgg(expr.args[2], rep, group, positionalParams, cteScope)
            : null;
      }
      const args = expr.args.map((a) => this.evalExprWithAgg(a, rep, group, positionalParams, cteScope));
      return this.evalScalarFunction(expr.name, args);
    }
    if (expr.kind === "unary") {
      return this.applyUnary(expr.op, this.evalExprWithAgg(expr.expr, rep, group, positionalParams, cteScope));
    }
    if (expr.kind === "binary") {
      const l = this.evalExprWithAgg(expr.left, rep, group, positionalParams, cteScope);
      const r = this.evalExprWithAgg(expr.right, rep, group, positionalParams, cteScope);
      return this.applyBinary(expr.op, l, r);
    }
    if (expr.kind === "is_null") {
      const v = this.evalExprWithAgg(expr.expr, rep, group, positionalParams, cteScope);
      return (expr.not ? v !== null : v === null) ? 1 : 0;
    }
    if (expr.kind === "between") {
      const v = this.evalExprWithAgg(expr.expr, rep, group, positionalParams, cteScope);
      const lo = this.evalExprWithAgg(expr.low, rep, group, positionalParams, cteScope);
      const hi = this.evalExprWithAgg(expr.high, rep, group, positionalParams, cteScope);
      if (v === null || lo === null || hi === null) {
        return null;
      }
      const inside = compareSqlValues(v, lo) >= 0 && compareSqlValues(v, hi) <= 0;
      return (expr.not ? !inside : inside) ? 1 : 0;
    }
    if (expr.kind === "case") {
      const baseVal = expr.base ? this.evalExprWithAgg(expr.base, rep, group, positionalParams, cteScope) : undefined;
      for (const b of expr.branches) {
        const wVal = this.evalExprWithAgg(b.when, rep, group, positionalParams, cteScope);
        const matched = expr.base ? sqlEquals(baseVal ?? null, wVal) === true : isTruthy(wVal);
        if (matched) {
          return this.evalExprWithAgg(b.then, rep, group, positionalParams, cteScope);
        }
      }
      return expr.elseExpr ? this.evalExprWithAgg(expr.elseExpr, rep, group, positionalParams, cteScope) : null;
    }
    if (expr.kind === "cast") {
      const v = this.evalExprWithAgg(expr.expr, rep, group, positionalParams, cteScope);
      return this.applyCast(v, expr.targetType);
    }
    return this.evalExpr(expr, rep, positionalParams, cteScope);
  }

  private evalAggregateFunction(
    expr: Extract<ExprNode, { kind: "func" }>,
    group: Record<string, SqlValue>[],
    positionalParams: SqlValue[],
    cteScope: Map<string, { columns: string[]; rows: SqlValue[][] }>
  ): SqlValue {
    const u = expr.name.toUpperCase();
    let filteredGroup = group;
    if (expr.filterWhere) {
      filteredGroup = group.filter((r) => isTruthy(this.evalExpr(expr.filterWhere!, r, positionalParams, cteScope)));
    }

    if (u === "COUNT") {
      if (expr.star || expr.args.length === 0) {
        return filteredGroup.length;
      }
      const vals = filteredGroup
        .map((r) => this.evalExpr(expr.args[0]!, r, positionalParams, cteScope))
        .filter((v) => v !== null && v !== undefined);
      if (expr.distinct) {
        return new Set(vals.map((v) => JSON.stringify(v))).size;
      }
      return vals.length;
    }

    if (u === "JSON_GROUP_OBJECT") {
      const obj: Record<string, unknown> = {};
      for (const r of filteredGroup) {
        const k = this.evalExpr(expr.args[0]!, r, positionalParams, cteScope);
        const v = this.evalExpr(expr.args[1]!, r, positionalParams, cteScope);
        if (k !== null && k !== undefined) {
          obj[toSqlString(k)] = this.sqlValToJsJson(v);
        }
      }
      return this.serializeJson(obj);
    }

    let vals = filteredGroup.map((r) =>
      expr.args[0] ? this.evalExpr(expr.args[0], r, positionalParams, cteScope) : null
    );

    if (u === "JSON_GROUP_ARRAY") {
      if (expr.distinct) {
        const seen = new Set<string>();
        vals = vals.filter((v) => {
          const k = JSON.stringify(v);
          if (seen.has(k)) {
            return false;
          }
          seen.add(k);
          return true;
        });
      }
      return this.serializeJson(vals.map((v) => this.sqlValToJsJson(v)));
    }

    const nonNull = vals.filter((v): v is Exclude<SqlValue, null> => v !== null && v !== undefined);
    let activeVals: SqlValue[] = nonNull;
    if (expr.distinct) {
      const seen = new Set<string>();
      activeVals = nonNull.filter((v) => {
        const k = JSON.stringify(v);
        if (seen.has(k)) {
          return false;
        }
        seen.add(k);
        return true;
      });
    }

    if (u === "SUM") {
      if (activeVals.length === 0) {
        return null;
      }
      const sum = activeVals.reduce<number>((total, v) => total + toSqlNumber(v), 0);
      return activeVals.some((value) => value instanceof Number || !Number.isInteger(toSqlNumber(value)))
        ? new Number(sum) : sum;
    }
    if (u === "TOTAL") {
      return new Number(activeVals.reduce<number>((sum, v) => sum + toSqlNumber(v), 0.0));
    }
    if (u === "AVG") {
      if (activeVals.length === 0) {
        return null;
      }
      const sum = activeVals.reduce<number>((s, v) => s + toSqlNumber(v), 0);
      return new Number(sum / activeVals.length);
    }
    if (u === "MIN") {
      if (activeVals.length === 0) {
        return null;
      }
      return activeVals.reduce((min, v) => (compareSqlValues(v, min) < 0 ? v : min), activeVals[0]!);
    }
    if (u === "MAX") {
      if (activeVals.length === 0) {
        return null;
      }
      return activeVals.reduce((max, v) => (compareSqlValues(v, max) > 0 ? v : max), activeVals[0]!);
    }
    if (u === "GROUP_CONCAT" || u === "STRING_AGG") {
      if (activeVals.length === 0) {
        return null;
      }
      const sep = expr.args[1]
        ? toSqlString(this.evalExpr(expr.args[1], filteredGroup[0] ?? {}, positionalParams, cteScope))
        : ",";
      return activeVals.map((v) => toSqlString(v)).join(sep);
    }

    return null;
  }

  private sqlValToJsJson(v: SqlValue): unknown {
    if (v === null || v === undefined) {
      return null;
    }
    if (typeof v === "string") {
      const trimmed = v.trim();
      if ((trimmed.startsWith("{") && trimmed.endsWith("}")) || (trimmed.startsWith("[") && trimmed.endsWith("]"))) {
        try {
          return JSON.parse(trimmed);
        } catch {
          return v;
        }
      }
      return v;
    }
    return v;
  }

  private validateColumns(
    node: unknown,
    scope: Record<string, SqlValue>,
    positionalParams: SqlValue[],
    cteScope: Map<string, { columns: string[]; rows: SqlValue[][] }>
  ): void {
    if (!node || typeof node !== "object") return;
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
        this.executeStatement(subquery.kind === "subquery" ? subquery.sql : subquery.subquerySql, positionalParams, cteScope);
      } finally {
        this.outerRows.pop();
        this.preparing = preparing;
      }
    }
    for (const child of Object.values(node)) this.validateColumns(child, scope, positionalParams, cteScope);
  }

  private serializeJson(value: unknown): string {
    if (value instanceof Number) {
      const number = value.valueOf();
      if (!Number.isFinite(number)) return "null";
      const text = String(number);
      return Number.isInteger(number) && !text.includes("e") ? `${text}.0` : text;
    }
    if (Array.isArray(value)) return `[${value.map((item) => this.serializeJson(item)).join(",")}]`;
    if (value !== null && typeof value === "object") {
      return `{${Object.entries(value).map(([key, item]) => `${JSON.stringify(key)}:${this.serializeJson(item)}`).join(",")}}`;
    }
    return JSON.stringify(value) ?? "null";
  }

  private lookupColInRow(row: Record<string, SqlValue>, table: string | undefined, name: string, doubleQuoted = false): SqlValue {
    if (table) {
      const exact = `${table}.${name}`;
      if (exact in row) {
        return row[exact]!;
      }
      const lowerExact = exact.toLowerCase();
      for (const [k, v] of Object.entries(row)) {
        if (k.toLowerCase() === lowerExact) {
          return v;
        }
      }
    }
    if (!table && name in row) {
      return row[name]!;
    }
    const lowerName = name.toLowerCase();
    for (const [k, v] of Object.entries(row)) {
      if (!table && (k.toLowerCase() === lowerName || k.toLowerCase().endsWith(`.${lowerName}`))) {
        return v;
      }
    }
    for (let i = this.outerRows.length - 1; i >= 0; i -= 1) {
      const outer = this.outerRows[i]!;
      const key = Object.keys(outer).find((key) => table
        ? key.toLowerCase() === `${table}.${name}`.toLowerCase()
        : key.toLowerCase() === lowerName);
      if (key !== undefined) return outer[key]!;
    }
    if (doubleQuoted && !table) return name;
    throw new Error(`in prepare, no such column: ${table ? `${table}.` : ""}${name}`);
  }

  private evalScalarSql(sql: string, row: Record<string, SqlValue>, positionalParams: SqlValue[]): SqlValue {
    return this.evalExpr(parseExprSql(sql), row, positionalParams);
  }

  public evalExpr(
    expr: ExprNode,
    row: Record<string, SqlValue>,
    positionalParams: SqlValue[],
    cteScope: Map<string, { columns: string[]; rows: SqlValue[][] }> = new Map()
  ): SqlValue {
    switch (expr.kind) {
      case "literal":
        return expr.value;
      case "column":
        return this.lookupColInRow(row, expr.table, expr.name, expr.doubleQuoted);
      case "star":
        return null;
      case "param": {
        if (expr.name === "?") {
          return positionalParams[expr.index - 1] ?? this.parameters.get(String(expr.index)) ?? null;
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
        return this.evalExpr(expr.expr, row, positionalParams, cteScope);
      case "unary":
        return this.applyUnary(expr.op, this.evalExpr(expr.expr, row, positionalParams, cteScope));
      case "binary": {
        if (expr.op === "AND") {
          const l = this.evalExpr(expr.left, row, positionalParams, cteScope);
          if (l !== null && !isTruthy(l)) {
            return 0;
          }
          const r = this.evalExpr(expr.right, row, positionalParams, cteScope);
          if (r !== null && !isTruthy(r)) {
            return 0;
          }
          if (l === null || r === null) {
            return null;
          }
          return 1;
        }
        if (expr.op === "OR") {
          const l = this.evalExpr(expr.left, row, positionalParams, cteScope);
          if (l !== null && isTruthy(l)) {
            return 1;
          }
          const r = this.evalExpr(expr.right, row, positionalParams, cteScope);
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
        const l = this.evalExpr(expr.left, row, positionalParams, cteScope);
        if (
          (expr.op === "LIKE" || expr.op === "GLOB") &&
          expr.right.kind === "func" &&
          expr.right.name === "__like_escape__"
        ) {
          const pat = this.evalExpr(expr.right.args[0]!, row, positionalParams, cteScope);
          const esc = this.evalExpr(expr.right.args[1]!, row, positionalParams, cteScope);
          if (l === null || pat === null || esc === null) {
            return null;
          }
          return matchLike(toSqlString(l), toSqlString(pat), expr.op === "LIKE", toSqlString(esc)) ? 1 : 0;
        }
        const r = this.evalExpr(expr.right, row, positionalParams, cteScope);
        return this.applyBinary(expr.op, l, r, collation);
      }
      case "between": {
        const v = this.evalExpr(expr.expr, row, positionalParams, cteScope);
        const lo = this.evalExpr(expr.low, row, positionalParams, cteScope);
        const hi = this.evalExpr(expr.high, row, positionalParams, cteScope);
        if (v === null || lo === null || hi === null) {
          return null;
        }
        const inside = compareSqlValues(v, lo) >= 0 && compareSqlValues(v, hi) <= 0;
        return (expr.not ? !inside : inside) ? 1 : 0;
      }
      case "in_list": {
        const v = this.evalExpr(expr.expr, row, positionalParams, cteScope);
        if (v === null) {
          return expr.list.length === 0 ? (expr.not ? 1 : 0) : null;
        }
        let sawNull = false;
        for (const item of expr.list) {
          const iv = this.evalExpr(item, row, positionalParams, cteScope);
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
        const v = this.evalExpr(expr.expr, row, positionalParams, cteScope);
        this.outerRows.push(row);
        let res: QueryResultSet;
        try {
          res = this.executeStatement(expr.subquerySql, positionalParams, cteScope) ?? { columns: [], rows: [] };
        } finally {
          this.outerRows.pop();
        }
        if (v === null) {
          return res.rows.length === 0 ? (expr.not ? 1 : 0) : null;
        }
        let sawNull = false;
        for (const r of res.rows) {
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
        const v = this.evalExpr(expr.expr, row, positionalParams, cteScope);
        return (expr.not ? v !== null : v === null) ? 1 : 0;
      }
      case "case": {
        const baseVal = expr.base ? this.evalExpr(expr.base, row, positionalParams, cteScope) : undefined;
        for (const b of expr.branches) {
          const wVal = this.evalExpr(b.when, row, positionalParams, cteScope);
          const matched = expr.base ? sqlEquals(baseVal ?? null, wVal) === true : isTruthy(wVal);
          if (matched) {
            return this.evalExpr(b.then, row, positionalParams, cteScope);
          }
        }
        return expr.elseExpr ? this.evalExpr(expr.elseExpr, row, positionalParams, cteScope) : null;
      }
      case "cast": {
        const v = this.evalExpr(expr.expr, row, positionalParams, cteScope);
        return this.applyCast(v, expr.targetType);
      }
      case "subquery": {
        this.outerRows.push(row);
        let res: QueryResultSet;
        try {
          res = this.executeStatement(expr.sql, positionalParams, cteScope) ?? { columns: [], rows: [] };
        } finally {
          this.outerRows.pop();
        }
        if (expr.exists) {
          const has = res.rows.length > 0;
          return (expr.notExists ? !has : has) ? 1 : 0;
        }
        return res.rows[0]?.[0] ?? null;
      }
      case "func": {
        const u = expr.name.toUpperCase();
        if (u === "COALESCE" || u === "IFNULL") {
          for (const a of expr.args) {
            const v = this.evalExpr(a, row, positionalParams, cteScope);
            if (v !== null && v !== undefined) {
              return v;
            }
          }
          return null;
        }
        if (u === "IIF") {
          const cond = this.evalExpr(expr.args[0]!, row, positionalParams, cteScope);
          return isTruthy(cond)
            ? this.evalExpr(expr.args[1]!, row, positionalParams, cteScope)
            : expr.args[2]
              ? this.evalExpr(expr.args[2], row, positionalParams, cteScope)
              : null;
        }
        const args = expr.args.map((a) => this.evalExpr(a, row, positionalParams, cteScope));
        return this.evalScalarFunction(expr.name, args);
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
      return v instanceof Number ? new Number(-v.valueOf()) : -toSqlNumber(v);
    }
    if (op === "+") {
      return v;
    }
    if (op === "~") {
      return ~Math.trunc(toSqlNumber(v));
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
        const path = typeof r === "number" ? `$[${r}]` : toSqlString(r).startsWith("$") ? toSqlString(r) : `$.${toSqlString(r)}`;
        const extracted = extractByJsonPath(parsed, path);
        return jsonValueToSql(extracted, op === "->>");
      } catch {
        return null;
      }
    }
    if (l === null || r === null) {
      return null;
    }
    const real = l instanceof Number || r instanceof Number || !Number.isInteger(toSqlNumber(l)) || !Number.isInteger(toSqlNumber(r));
    switch (op) {
      case "||":
        return `${toSqlString(l)}${toSqlString(r)}`;
      case "+":
        return real ? new Number(toSqlNumber(l) + toSqlNumber(r)) : toSqlNumber(l) + toSqlNumber(r);
      case "-":
        return real ? new Number(toSqlNumber(l) - toSqlNumber(r)) : toSqlNumber(l) - toSqlNumber(r);
      case "*":
        return real ? new Number(toSqlNumber(l) * toSqlNumber(r)) : toSqlNumber(l) * toSqlNumber(r);
      case "/": {
        const denom = toSqlNumber(r);
        if (denom === 0) {
          return null;
        }
        const nL = toSqlNumber(l);
        if (Number.isInteger(nL) && Number.isInteger(denom) && typeof l === "number" && typeof r === "number") {
          return Math.trunc(nL / denom);
        }
        return new Number(nL / denom);
      }
      case "%": {
        const denom = Math.trunc(toSqlNumber(r));
        if (denom === 0) {
          return null;
        }
        return real ? new Number(Math.trunc(toSqlNumber(l)) % denom) : Math.trunc(toSqlNumber(l)) % denom;
      }
      case "<<":
        return Math.trunc(toSqlNumber(l)) << Math.trunc(toSqlNumber(r));
      case ">>":
        return Math.trunc(toSqlNumber(l)) >> Math.trunc(toSqlNumber(r));
      case "&":
        return Math.trunc(toSqlNumber(l)) & Math.trunc(toSqlNumber(r));
      case "|":
        return Math.trunc(toSqlNumber(l)) | Math.trunc(toSqlNumber(r));
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
      case "MATCH":
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
      return Math.trunc(toSqlNumber(v));
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

  private evalScalarFunction(name: string, args: SqlValue[]): SqlValue {
    const u = name.toUpperCase();
    const a0 = args[0] ?? null;
    const a1 = args[1] ?? null;

    switch (u) {
      case "NULLIF":
        return sqlEquals(a0, a1) === true ? null : a0;
      case "COALESCE":
      case "IFNULL": {
        for (const a of args) {
          if (a !== null && a !== undefined) {
            return a;
          }
        }
        return null;
      }
      case "IIF":
        return isTruthy(a0) ? (a1 ?? null) : (args[2] ?? null);
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
        if (typeof a0 === "string") {
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
            start += 1;
          }
        }
        if (u === "TRIM" || u === "RTRIM") {
          while (end > start && set.has(s[end - 1]!)) {
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
        const len = args[2] !== undefined && args[2] !== null ? Math.trunc(toSqlNumber(args[2])) : chars.length;
        let startIdx: number;
        if (pos > 0) {
          startIdx = pos - 1;
        } else if (pos < 0) {
          startIdx = chars.length + pos;
        } else {
          startIdx = 0;
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
        return args.map((x) => (x === null || x === undefined ? "" : toSqlString(x))).join("");
      case "CONCAT_WS": {
        if (a0 === null) {
          return null;
        }
        const sep = toSqlString(a0);
        return args
          .slice(1)
          .filter((x) => x !== null && x !== undefined)
          .map((x) => toSqlString(x))
          .join(sep);
      }
      case "REVERSE":
        return a0 === null ? null : Array.from(toSqlString(a0)).reverse().join("");
      case "REPEAT":
        return a0 === null || a1 === null ? null : toSqlString(a0).repeat(Math.max(0, Math.trunc(toSqlNumber(a1))));
      case "LPAD":
        return a0 === null || a1 === null
          ? null
          : toSqlString(a0).padStart(Math.trunc(toSqlNumber(a1)), args[2] ? toSqlString(args[2]) : " ");
      case "RPAD":
        return a0 === null || a1 === null
          ? null
          : toSqlString(a0).padEnd(Math.trunc(toSqlNumber(a1)), args[2] ? toSqlString(args[2]) : " ");
      case "CHAR":
        return args.map((x) => String.fromCodePoint(Math.max(0, Math.trunc(toSqlNumber(x))))).join("");
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
          out[i] = Number.parseInt(h.slice(i * 2, i * 2 + 2), 16);
        }
        return out;
      }
      case "QUOTE":
        return this.toSqlLiteral(a0);
      case "ABS":
        return a0 === null ? null : a0 instanceof Number ? new Number(Math.abs(a0.valueOf())) : Math.abs(toSqlNumber(a0));
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
        return a0 === null || a1 === null || toSqlNumber(a1) === 0 ? null : toSqlNumber(a0) % toSqlNumber(a1);
      case "MIN":
        if (args.some((x) => x === null || x === undefined)) {
          return null;
        }
        return args.reduce((m, x) => (compareSqlValues(x, m) < 0 ? x : m), args[0] ?? null);
      case "MAX":
        if (args.some((x) => x === null || x === undefined)) {
          return null;
        }
        return args.reduce((m, x) => (compareSqlValues(x, m) > 0 ? x : m), args[0] ?? null);
      case "RANDOM":
        return Math.floor((Math.random() - 0.5) * 2 * Number.MAX_SAFE_INTEGER);
      case "RANDOMBLOB": {
        const n = Math.max(0, Math.min(65536, Math.trunc(toSqlNumber(a0 ?? 0))));
        const b = new Uint8Array(n);
        for (let i = 0; i < n; i += 1) {
          b[i] = Math.floor(Math.random() * 256);
        }
        return b;
      }
      case "ZEROBLOB": {
        const n = Math.max(0, Math.min(65536, Math.trunc(toSqlNumber(a0 ?? 0))));
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
        return a0 === null || a1 === null ? null : matchGlob(toSqlString(a1), toSqlString(a0)) ? 1 : 0;
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
        return JSON.stringify(JSON.parse(toSqlString(a0)));
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
        return a0 === null ? "null" : this.serializeJson(this.sqlValToJsJson(a0));
      case "JSON_ARRAY":
        return this.serializeJson(args.map((x) => this.sqlValToJsJson(x)));
      case "JSON_OBJECT": {
        const obj: Record<string, unknown> = {};
        for (let i = 0; i + 1 < args.length; i += 2) {
          if (args[i] !== null && args[i] !== undefined) {
            obj[toSqlString(args[i]!)] = this.sqlValToJsJson(args[i + 1] ?? null);
          }
        }
        return this.serializeJson(obj);
      }
      case "JSON_EXTRACT": {
        if (a0 === null) {
          return null;
        }
        try {
          const parsed = JSON.parse(toSqlString(a0));
          if (args.length <= 2) {
            const extracted = extractByJsonPath(parsed, toSqlString(a1 ?? "$"));
            return jsonValueToSql(extracted, true);
          }
          const arr = args.slice(1).map((p) => {
            const v = extractByJsonPath(parsed, toSqlString(p ?? "$"));
            return v === undefined ? null : v;
          });
          return JSON.stringify(arr);
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
          const target = a1 !== null && a1 !== undefined ? extractByJsonPath(parsed, toSqlString(a1)) : parsed;
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
          const target = a1 !== null && a1 !== undefined ? extractByJsonPath(parsed, toSqlString(a1)) : parsed;
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
            const p = toSqlString(args[i] ?? "$");
            const v = this.sqlValToJsJson(args[i + 1] ?? null);
            cur = setByJsonPath(cur, p, v, mode);
          }
          return JSON.stringify(cur);
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
            cur = removeByJsonPath(cur, toSqlString(args[i] ?? "$"));
          }
          return JSON.stringify(cur);
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
