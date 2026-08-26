import { ShellSyntaxError } from "./types.js";
import { arithmeticEnd, parseArithmetic } from "./arithmetic.js";
import type { Arithmetic } from "./arithmetic.js";

export type WordPart =
  | { kind: "text"; value: string; quoted: boolean }
  | { kind: "arithmetic"; expression: Arithmetic; quoted: boolean }
  | { kind: "variable"; name: string; quoted: boolean; length?: boolean; operator?: string; alternate?: Word }
  | { kind: "substitution"; script: Script; quoted: boolean };

export interface Word {
  readonly parts: WordPart[];
  readonly offset: number;
  readonly plain?: string;
}

interface Token {
  kind: "word" | "operator" | "end";
  value: string;
  offset: number;
  end: number;
  word?: Word;
  document?: HereDocument;
}

interface HereDocument {
  readonly delimiter: string;
  readonly quoted: boolean;
  readonly stripTabs: boolean;
  readonly offset: number;
  body: Word;
}

export interface Redirect {
  readonly descriptor: number;
  readonly operator: string;
  readonly target: Word;
  readonly document?: HereDocument;
}

export interface CaseClause {
  readonly patterns: Word[];
  readonly body: Script;
  readonly terminator: ";;" | ";&" | ";;&" | "esac";
}

export type Command = (
  | { kind: "simple"; words: Word[] }
  | { kind: "subshell"; body: Script }
  | { kind: "group"; body: Script }
  | { kind: "if"; branches: { condition: Script; body: Script }[]; otherwise?: Script }
  | { kind: "case"; subject: Word; clauses: CaseClause[] }
  | { kind: "while"; condition: Script; body: Script }
  | { kind: "until"; condition: Script; body: Script }
  | { kind: "for"; name: string; words?: Word[]; body: Script }
  | { kind: "function"; name: string; body: Command }
  | { kind: "arithmetic"; expression: Arithmetic }
) & { redirects: Redirect[] };

export interface Pipeline {
  readonly commands: Command[];
  readonly negate: boolean;
}

export interface AndOr {
  readonly pipelines: Pipeline[];
  readonly operators: ("&&" | "||")[];
}

export interface Script {
  readonly lists: AndOr[];
  readonly warnings?: readonly string[];
}

class Lexer {
  position = 0;
  delimiterOperator: string | undefined;
  readonly documents: HereDocument[] = [];

  constructor(readonly source: string, readonly depth: number, readonly warnings: string[] = []) {
    if (depth > 64) throw new ShellSyntaxError("Syntax nesting exceeds 64", 0);
  }

  error(message: string): never {
    throw new ShellSyntaxError(message, this.position);
  }

  next(): Token {
    while (this.position < this.source.length) {
      const current = this.source[this.position]!;
      if (current === " " || current === "\t") {
        this.position++;
      } else if (current === "\\" && this.source[this.position + 1] === "\n") {
        this.position += 2;
      } else if (current === "#") {
        while (this.position < this.source.length && this.source[this.position] !== "\n") this.position++;
      } else break;
    }
    const offset = this.position;
    if (offset === this.source.length) {
      this.readDocuments();
      return { kind: "end", value: "", offset, end: offset };
    }
    let logical = "";
    let cursor = offset;
    const ends: number[] = [];
    while (cursor < this.source.length && logical.length < 3) {
      if (this.source.startsWith("\\\n", cursor)) { cursor += 2; continue; }
      logical += this.source[cursor++]!;
      ends.push(cursor);
    }
    const operator = /^(?:;;&|<<-|;&|&&|\|\||>>|>&|<&|>\||<<|;;|&>|[;\n|&()<>])/u.exec(logical)?.[0];
    if (operator) {
      if (["&", "&>"].includes(operator)) this.error(`Unsupported operator ${operator}`);
      this.position = ends[operator.length - 1]!;
      if (operator === "<<" || operator === "<<-") this.delimiterOperator = operator;
      if (operator === "\n") this.readDocuments();
      return { kind: "operator", value: operator, offset, end: this.position };
    }
    const delimiterOperator = this.delimiterOperator;
    this.delimiterOperator = undefined;
    const word = this.word(undefined, false, delimiterOperator !== undefined);
    if (this.position <= offset) this.error("Tokenizer made no progress");
    let document: HereDocument | undefined;
    if (delimiterOperator) {
      document = {
        delimiter: word.parts.map((part) => part.kind === "text" ? part.value : "").join(""),
        quoted: word.parts.some((part) => part.quoted), stripTabs: delimiterOperator === "<<-", offset,
        body: { offset, parts: [] },
      };
      this.documents.push(document);
    }
    return { kind: "word", value: word.plain ?? "", offset, end: this.position, word, ...(document ? { document } : {}) };
  }

  readDocuments(): void {
    for (const document of this.documents.splice(0)) {
      let body = "";
      let terminated = false;
      while (this.position < this.source.length) {
        let line = "";
        while (this.position < this.source.length) {
          const current = this.source[this.position++]!;
          if (!document.quoted && current === "\\" && this.position < this.source.length) {
            const next = this.source[this.position++]!;
            if (next !== "\n") line += current + next;
          } else if (current === "\n") break;
          else line += current;
        }
        if (line === document.delimiter || (document.stripTabs && line.replace(/^\t+/u, "") === document.delimiter)) {
          terminated = true;
          break;
        }
        body += (document.stripTabs ? line.replace(/^\t+/u, "") : line) + "\n";
      }
      if (!terminated) this.warnings.push(`here-document at offset ${document.offset} delimited by end-of-file (wanted ${JSON.stringify(document.delimiter)})`);
      document.body = document.quoted
        ? { offset: document.offset, parts: [{ kind: "text", value: body, quoted: true }] }
        : new Lexer(body, this.depth, this.warnings).documentWord();
    }
  }

  documentWord(): Word {
    const parts: WordPart[] = [];
    let text = "";
    const flush = () => {
      if (text) parts.push({ kind: "text", value: text, quoted: true });
      text = "";
    };
    while (this.position < this.source.length) {
      const current = this.source[this.position]!;
      if (current === "$" || current === "`") {
        flush();
        this.expansion(parts, true);
      } else if (current === "\\" && /[$`\\]/u.test(this.source[this.position + 1] ?? "")) {
        text += this.source[this.position + 1]!;
        this.position += 2;
      } else {
        text += current;
        this.position++;
      }
    }
    flush();
    return { offset: 0, parts };
  }

  literalExpansion(): string {
    const backtick = this.source[this.position] === "`";
    const opening = this.source[this.position + 1];
    if (!backtick && opening !== "(" && opening !== "{") return this.source[this.position++]!;
    let value = backtick ? "`" : `$${opening}`;
    this.position += backtick ? 1 : 2;
    const closers = [backtick ? "`" : opening === "(" ? ")" : "}"];
    let quote = "";
    while (this.position < this.source.length) {
      const current = this.source[this.position++]!;
      if (current === "\\" && quote !== "'") {
        const next = this.source[this.position++];
        if (next === undefined) this.error("Trailing delimiter escape");
        if (next !== "\n") value += quote === '"' && !/[$`"\\]/u.test(next) ? current + next : next;
      } else if (quote) {
        if (current === quote) quote = "";
        else value += current;
      } else if (current === "'" || current === '"') quote = current;
      else {
        value += current;
        if (current === closers.at(-1)) {
          closers.pop();
          if (!closers.length) return value;
        } else if (current === "(" || current === "{") {
          closers.push(current === "(" ? ")" : "}");
          if (closers.length + this.depth > 64) this.error("Syntax nesting exceeds 64");
        }
      }
    }
    this.error("Unterminated delimiter expansion syntax");
  }

  word(terminator?: string, enclosingQuoted = false, literal = false): Word {
    const offset = this.position;
    const parts: WordPart[] = [];
    let plain = true;
    const text = (value: string, quoted: boolean) => {
      const previous = parts.at(-1);
      if (previous?.kind === "text" && previous.quoted === quoted) previous.value += value;
      else parts.push({ kind: "text", value, quoted });
    };
    while (this.position < this.source.length) {
      const current = this.source[this.position]!;
      if (terminator ? current === terminator : /[ \t\n;|&()<>]/u.test(current)) break;
      if (current === "'" && !enclosingQuoted) {
        plain = false;
        const end = this.source.indexOf("'", this.position + 1);
        if (end === -1) this.error("Unterminated single quote");
        text(this.source.slice(this.position + 1, end), true);
        this.position = end + 1;
      } else if (current === '"') {
        plain = false;
        this.position++;
        text("", true);
        while (this.position < this.source.length && this.source[this.position] !== '"') {
          const inner = this.source[this.position]!;
          if (!literal && (inner === "$" || inner === "`")) this.expansion(parts, true);
          else if (inner === "\\" && /[$`"\\\n]/u.test(this.source[this.position + 1] ?? "")) {
            const escaped = this.source[this.position + 1]!;
            if (escaped !== "\n") text(escaped, true);
            this.position += 2;
          } else {
            text(inner, true);
            this.position++;
          }
        }
        if (this.source[this.position] !== '"') this.error("Unterminated double quote");
        this.position++;
      } else if (current === "\\") {
        if (this.source[this.position + 1] !== "\n") plain = false;
        this.position++;
        if (this.position === this.source.length) this.error("Trailing escape");
        if (this.source[this.position] !== "\n") text(this.source[this.position]!, true);
        this.position++;
      } else if (current === "$" || current === "`") {
        plain = false;
        if (literal) text(this.literalExpansion(), current === "`");
        else this.expansion(parts, enclosingQuoted);
      } else {
        text(current, false);
        this.position++;
      }
    }
    return { parts, offset, ...(plain ? { plain: parts.map((part) => part.kind === "text" ? part.value : "").join("") } : {}) };
  }

  expansion(parts: WordPart[], quoted: boolean): void {
    if (this.source[this.position] === "`") {
      this.position++;
      let source = "";
      while (this.position < this.source.length && this.source[this.position] !== "`") {
        if (this.source[this.position] === "\\" && /[$`\\]/u.test(this.source[this.position + 1] ?? "")) this.position++;
        source += this.source[this.position++]!;
      }
      if (this.source[this.position] !== "`") this.error("Unterminated command substitution");
      this.position++;
      parts.push({ kind: "substitution", script: parseSource(source, this.depth + 1, this.warnings), quoted });
      return;
    }
    this.position++;
    if (["$", "!", "-"].includes(this.source[this.position] ?? "") || (!quoted && ["'", '"'].includes(this.source[this.position] ?? ""))) this.error("Unsupported shell quoting or special parameter");
    if (this.source.startsWith("((", this.position)) {
      const start = this.position + 2;
      const end = arithmeticEnd(this.source, start);
      parts.push({ kind: "arithmetic", expression: parseArithmetic(this.source.slice(start, end), start), quoted });
      this.position = end + 2;
    } else if (this.source[this.position] === "(") {
      const nested = new Parser(this.source.slice(this.position + 1), this.depth + 1, this.warnings);
      const script = nested.script(new Set([")"]));
      if (nested.current.value !== ")") this.error("Unterminated command substitution");
      if (nested.lexer.documents.length) this.error("Here-document requires a newline before closing command substitution");
      this.position += nested.current.end + 1;
      parts.push({ kind: "substitution", script, quoted });
    } else if (this.source[this.position] === "{") {
      this.position++;
      const length = this.source[this.position] === "#" && /[a-zA-Z_]/u.test(this.source[this.position + 1] ?? "");
      if (length) this.position++;
      const name = /^(?:[a-zA-Z_][a-zA-Z_0-9]*|[?@*#0-9])/u.exec(this.source.slice(this.position))?.[0];
      if (!name) this.error("Unsupported parameter expansion");
      this.position += name.length;
      const operator = /^(?::[-=+?]|##|%%|[-=+?#%])/u.exec(this.source.slice(this.position))?.[0];
      let alternate: Word | undefined;
      if (operator) {
        if (length) this.error("Invalid length expansion");
        this.position += operator.length;
        alternate = this.word("}", quoted && !["#", "##", "%", "%%"].includes(operator));
      }
      if (this.source[this.position] !== "}") this.error("Unterminated or unsupported parameter expansion");
      this.position++;
      parts.push({ kind: "variable", name, quoted, ...(length ? { length } : {}), ...(operator ? { operator, alternate: alternate! } : {}) });
    } else {
      const name = /^(?:[a-zA-Z_][a-zA-Z_0-9]*|[?@*#0-9])/u.exec(this.source.slice(this.position))?.[0];
      if (name) {
        this.position += name.length;
        parts.push({ kind: "variable", name, quoted });
      } else parts.push({ kind: "text", value: "$", quoted });
    }
  }
}

class Parser {
  readonly lexer: Lexer;
  current: Token;
  lookahead: Token | undefined;
  nesting = 0;

  constructor(source: string, depth: number, warnings: string[] = []) {
    if (source.includes("\0")) throw new ShellSyntaxError("NUL bytes are not valid shell source", source.indexOf("\0"));
    this.lexer = new Lexer(source, depth, warnings);
    this.current = this.lexer.next();
  }

  error(message: string): never {
    throw new ShellSyntaxError(message, this.current.offset);
  }

  advance(): Token {
    const previous = this.current;
    this.current = this.lookahead ?? this.lexer.next();
    this.lookahead = undefined;
    return previous;
  }

  peek(): Token {
    return this.lookahead ??= this.lexer.next();
  }

  is(value: string): boolean { return this.current.value === value; }

  isEnd(): boolean { return this.current.kind === "end"; }

  expect(value: string): void {
    if (!this.is(value)) this.error(`Expected ${value}`);
    this.advance();
  }

  newlines(): void { while (this.is("\n")) this.advance(); }

  script(stops = new Set<string>()): Script {
    const lists: AndOr[] = [];
    this.newlines();
    while (this.current.kind !== "end" && !stops.has(this.current.value)) {
      const pipelines = [this.pipeline()];
      const operators: ("&&" | "||")[] = [];
      while (this.is("&&") || this.is("||")) {
        operators.push(this.advance().value as "&&" | "||");
        this.newlines();
        pipelines.push(this.pipeline());
      }
      lists.push({ pipelines, operators });
      if (this.is(";") || this.is("\n")) {
        this.advance();
        this.newlines();
      } else if (!this.isEnd() && !this.is(")") && !(stops.has(this.current.value) && [";;", ";&", ";;&"].includes(this.current.value))) this.error("Expected command separator");
    }
    return { lists };
  }

  pipeline(): Pipeline {
    const negate = this.is("!");
    if (negate) this.advance();
    const commands = [this.command()];
    while (this.is("|")) {
      this.advance();
      this.newlines();
      commands.push(this.command());
    }
    return { commands, negate };
  }

  command(): Command {
    if (++this.nesting + this.lexer.depth > 64) this.error("Syntax nesting exceeds 64");
    try { return this.commandInner(); } finally { this.nesting--; }
  }

  commandInner(): Command {
    let command: Command;
    if (this.is("(") && this.lexer.source.startsWith("((", this.current.offset)) {
      const start = this.current.offset + 2;
      const end = arithmeticEnd(this.lexer.source, start);
      command = { kind: "arithmetic", expression: parseArithmetic(this.lexer.source.slice(start, end), start), redirects: [] };
      this.lexer.position = end + 2;
      this.lookahead = undefined;
      this.current = this.lexer.next();
    } else if (this.is("(") || this.is("{")) {
      const subshell = this.is("(");
      this.advance();
      const body = this.script(new Set([subshell ? ")" : "}"]));
      if (!body.lists.length) this.error("Empty compound command");
      this.expect(subshell ? ")" : "}");
      command = { kind: subshell ? "subshell" : "group", body, redirects: [] };
    } else if (this.is("if")) {
      this.advance();
      const branches: { condition: Script; body: Script }[] = [];
      while (true) {
        const condition = this.nonemptyScript(new Set(["then"]));
        this.expect("then");
        const body = this.nonemptyScript(new Set(["elif", "else", "fi"]));
        branches.push({ condition, body });
        if (!this.is("elif")) break;
        this.advance();
      }
      let otherwise: Script | undefined;
      if (this.is("else")) {
        this.advance();
        otherwise = this.nonemptyScript(new Set(["fi"]));
      }
      this.expect("fi");
      command = { kind: "if", branches, ...(otherwise ? { otherwise } : {}), redirects: [] };
    } else if (this.is("case")) {
      this.advance();
      if (!this.current.word) this.error("Expected case subject");
      const subject = this.advance().word!;
      this.newlines();
      this.expect("in");
      this.newlines();
      const clauses: CaseClause[] = [];
      while (!this.is("esac")) {
        if (this.is("(")) this.advance();
        const patterns: Word[] = [];
        while (true) {
          if (!this.current.word) this.error("Expected case pattern");
          patterns.push(this.advance().word!);
          if (!this.is("|")) break;
          this.advance();
        }
        this.expect(")");
        const body = this.script(new Set([";;", ";&", ";;&", "esac"]));
        if (![";;", ";&", ";;&", "esac"].includes(this.current.value)) this.error("Expected case terminator");
        const terminator = this.current.value as CaseClause["terminator"];
        clauses.push({ patterns, body, terminator });
        if (terminator === "esac") break;
        this.advance();
        this.newlines();
      }
      this.expect("esac");
      command = { kind: "case", subject, clauses, redirects: [] };
    } else if (this.is("while") || this.is("until")) {
      const kind = this.advance().value as "while" | "until";
      const condition = this.nonemptyScript(new Set(["do"]));
      this.expect("do");
      const body = this.nonemptyScript(new Set(["done"]));
      this.expect("done");
      command = { kind, condition, body, redirects: [] };
    } else if (this.is("for")) {
      this.advance();
      const name = this.advance().value;
      if (!/^[a-zA-Z_][a-zA-Z_0-9]*$/u.test(name)) this.error("Invalid for variable");
      this.newlines();
      let words: Word[] | undefined;
      if (this.is("in")) {
        this.advance();
        words = [];
        while (this.current.kind === "word") words.push(this.advance().word!);
      }
      if (this.is(";") || this.is("\n")) this.advance();
      else if (words) this.error("Expected for separator");
      this.newlines();
      this.expect("do");
      const body = this.nonemptyScript(new Set(["done"]));
      this.expect("done");
      command = { kind: "for", name, ...(words ? { words } : {}), body, redirects: [] };
    } else if (this.current.kind === "word" && this.peek().value === "(") {
      const name = this.advance().value;
      if (!/^[a-zA-Z_][a-zA-Z_0-9]*$/u.test(name)) this.error("Invalid function name");
      this.expect("(");
      this.expect(")");
      this.newlines();
      if (!["{", "(", "if", "case", "while", "until", "for"].includes(this.current.value)) this.error("Expected function body");
      command = { kind: "function", name, body: this.command(), redirects: [] };
    } else {
      if (["!", "then", "else", "elif", "fi", "do", "done", "}", "case", "esac", "select", "function", "[[", "]]"].includes(this.current.value)) this.error(`Unexpected or unsupported keyword ${this.current.value}`);
      const words: Word[] = [];
      const redirects: Redirect[] = [];
      while (true) {
        const redirect = this.redirect();
        if (redirect) redirects.push(redirect);
        else if (this.current.kind === "word") words.push(this.advance().word!);
        else break;
      }
      if (!words.length && !redirects.length) this.error("Expected command");
      return { kind: "simple", words, redirects };
    }
    let redirect: Redirect | undefined;
    while ((redirect = this.redirect())) command.redirects.push(redirect);
    return command;
  }

  nonemptyScript(stops: Set<string>): Script {
    const script = this.script(stops);
    if (!script.lists.length) this.error("Expected nonempty compound list");
    return script;
  }

  redirect(): Redirect | undefined {
    let descriptor: number | undefined;
    if (this.current.kind === "word" && /^\d+$/u.test(this.current.value)) {
      const next = this.peek();
      if (/^(?:>|>>|<|<<|<<-|>&|<&|>\|)$/u.test(next.value) && this.current.end === next.offset) descriptor = Number(this.advance().value);
    }
    if (!/^(?:>|>>|<|<<|<<-|>&|<&|>\|)$/u.test(this.current.value) || this.current.kind !== "operator") return undefined;
    const operator = this.advance().value;
    descriptor ??= operator.startsWith("<") ? 0 : 1;
    if (!Number.isSafeInteger(descriptor) || descriptor > 255) this.error("File descriptor must be between 0 and 255");
    if (!this.current.word) this.error("Expected redirect target");
    const target = this.advance();
    return { descriptor, operator, target: target.word!, ...(target.document ? { document: target.document } : {}) };
  }
}

export function parseShell(source: string, depth = 0): Script {
  const warnings: string[] = [];
  const script = parseSource(source, depth, warnings);
  return { ...script, ...(warnings.length ? { warnings } : {}) };
}

function parseSource(source: string, depth: number, warnings: string[]): Script {
  const parser = new Parser(source, depth, warnings);
  const script = parser.script();
  if (parser.current.kind !== "end") parser.error("Unexpected token");
  return script;
}
