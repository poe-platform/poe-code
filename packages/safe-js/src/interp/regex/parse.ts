import { RegexCompileGuard, type CompileScope } from "./compile-guard.js";

export type RegexFlags = {
  hasIndices: boolean;
  global: boolean;
  sticky: boolean;
  ignoreCase: boolean;
  multiline: boolean;
  dotAll: boolean;
};

export type CharacterKind = "digit" | "word" | "space";

export type CharacterClassItem =
  | { type: "character"; value: string }
  | { type: "range"; from: string; to: string }
  | { type: "kind"; kind: CharacterKind; negated: boolean };

export type RegexNode =
  | { type: "empty" }
  | { type: "literal"; value: string }
  | { type: "dot" }
  | { type: "anchor"; kind: "start" | "end" }
  | { type: "wordBoundary"; negated: boolean }
  | { type: "characterClass"; negated: boolean; items: CharacterClassItem[] }
  | { type: "sequence"; elements: RegexNode[] }
  | { type: "alternation"; alternatives: RegexNode[] }
  | { type: "group"; capturing: boolean; index?: number; body: RegexNode }
  | { type: "quantifier"; body: RegexNode; min: number; max?: number; greedy: boolean };

export type RegexPattern = {
  source: string;
  flags: RegexFlags;
  captureCount: number;
  body: RegexNode;
};

export function parseRegex(
  source: string,
  flags = "",
  compilation?: CompileScope,
  valueUnits = 0
): RegexPattern {
  const guard = new RegexCompileGuard(compilation);
  try {
    guard.checkLength(source.length);
    guard.checkLength(flags.length, true);
    guard.allocate(5 + valueUnits);
    const parsedFlags = parseFlags(flags, guard);
    const parser = new RegexParser(source, guard);
    const body = parser.parse();
    guard.allocate(5 + source.length);
    const pattern = { source, flags: parsedFlags, captureCount: parser.captureCount, body };
    guard.retain(pattern, valueUnits);
    return pattern;
  } finally {
    guard.close();
  }
}

class RegexParser {
  captureCount = 0;
  private cursor = 0;

  constructor(
    private readonly source: string,
    private readonly guard: RegexCompileGuard
  ) {}

  private get position(): number {
    return this.cursor;
  }

  private set position(next: number) {
    this.guard.work(Math.max(0, next - this.cursor));
    this.cursor = next;
  }

  parse(): RegexNode {
    const body = this.parseAlternation();
    if (!this.atEnd()) {
      if (this.peek() === ")") {
        this.fail("Unmatched closing parenthesis");
      }
      this.fail(`Unexpected character '${this.peek()}'`);
    }
    return body;
  }

  private parseAlternation(): RegexNode {
    this.guard.allocate(1);
    this.guard.array(1);
    const alternatives = [this.parseSequence()];
    while (this.peek() === "|") {
      this.position += 1;
      this.guard.array(alternatives.length + 1);
      alternatives.push(this.parseSequence());
    }

    if (alternatives.length === 1) return alternatives[0];
    this.guard.allocate(3);
    return { type: "alternation", alternatives };
  }

  private parseSequence(): RegexNode {
    this.guard.allocate(1);
    const elements: RegexNode[] = [];
    while (!this.atEnd() && this.peek() !== ")" && this.peek() !== "|") {
      this.guard.array(elements.length + 1);
      elements.push(this.parseQuantifiedAtom());
    }

    if (elements.length === 0) {
      this.guard.allocate(2);
      return { type: "empty" };
    }
    if (elements.length === 1) return elements[0];
    this.guard.allocate(3);
    return { type: "sequence", elements };
  }

  private parseQuantifiedAtom(): RegexNode {
    const quantifierStart = this.position;
    const current = this.peek();
    if (current === "*" || current === "+" || current === "?" || current === "{") {
      this.fail("Nothing to repeat", quantifierStart);
    }

    const body = this.parseAtom();
    const quantifier = this.parseQuantifier();
    if (quantifier === undefined) {
      return body;
    }

    if (body.type === "anchor" || body.type === "wordBoundary") {
      this.fail("Invalid quantifier target", quantifierStart);
    }

    const greedy = this.peek() !== "?";
    if (!greedy) {
      this.position += 1;
    }

    this.guard.allocate(Object.hasOwn(quantifier, "max") ? 6 : 5);
    return { type: "quantifier", body, ...quantifier, greedy };
  }

  private parseAtom(): RegexNode {
    const character = this.take();
    switch (character) {
      case ".":
        this.guard.allocate(2);
        return { type: "dot" };
      case "^":
        this.guard.allocate(3);
        return { type: "anchor", kind: "start" };
      case "$":
        this.guard.allocate(3);
        return { type: "anchor", kind: "end" };
      case "(":
        return this.parseGroup(this.position - 1);
      case "[":
        return this.parseCharacterClass(this.position - 1);
      case "\\":
        return this.parseEscape(false, this.position - 1);
      default:
        this.guard.allocate(3 + character.length);
        return { type: "literal", value: character };
    }
  }

  private parseGroup(start: number): RegexNode {
    let capturing = true;
    if (this.peek() === "?") {
      this.guard.allocate(Math.min(3, this.source.length - this.position));
      this.guard.work(Math.min(3, this.source.length - this.position));
      const extension = this.source.slice(this.position, this.position + 3);
      if (extension.startsWith("?:")) {
        capturing = false;
        this.position += 2;
      } else if (extension.startsWith("?=") || extension.startsWith("?!")) {
        this.fail("Lookahead is not supported", start);
      } else if (extension.startsWith("?<=") || extension.startsWith("?<!")) {
        this.fail("Lookbehind is not supported", start);
      } else if (extension.startsWith("?<")) {
        this.fail("Named groups are not supported", start);
      } else {
        this.fail("Unsupported group construct", start);
      }
    }

    if (capturing) this.guard.allocate(1);
    const index = capturing ? ++this.captureCount : undefined;
    this.guard.enterGroup();
    let body: RegexNode;
    try {
      body = this.parseAlternation();
    } finally {
      this.guard.leaveGroup();
    }
    if (this.peek() !== ")") {
      this.fail("Unterminated group", start);
    }
    this.position += 1;

    this.guard.allocate(5);
    return { type: "group", capturing, index, body };
  }

  private parseCharacterClass(start: number): RegexNode {
    const negated = this.peek() === "^";
    if (negated) {
      this.position += 1;
    }

    this.guard.allocate(1);
    const items: CharacterClassItem[] = [];
    while (!this.atEnd()) {
      if (this.peek() === "]") {
        this.position += 1;
        this.guard.allocate(4);
        return { type: "characterClass", negated, items };
      }

      this.guard.array(items.length + 1);
      const left = this.parseClassItem(start);
      if (this.peek() === "-" && this.source[this.position + 1] !== "]") {
        const rangePosition = this.position;
        this.position += 1;
        const right = this.parseClassItem(start);
        if (left.type !== "character" || right.type !== "character") {
          this.fail("Character class ranges require literal endpoints", rangePosition);
        }
        if (left.value.charCodeAt(0) > right.value.charCodeAt(0)) {
          this.fail("Character class range is out of order", rangePosition);
        }
        this.guard.allocate(4 + left.value.length + right.value.length);
        items.push({ type: "range", from: left.value, to: right.value });
      } else {
        items.push(left);
      }
    }

    this.fail("Unterminated character class", start);
  }

  private parseClassItem(classStart: number): CharacterClassItem {
    if (this.atEnd()) {
      this.fail("Unterminated character class", classStart);
    }
    if (this.peek() === "\\") {
      const escapeStart = this.position;
      this.position += 1;
      const escaped = this.parseEscape(true, escapeStart);
      if (escaped.type === "literal") {
        this.guard.allocate(3 + escaped.value.length);
        return { type: "character", value: escaped.value };
      }
      if (escaped.type === "characterClass" && escaped.items.length === 1) {
        return escaped.items[0];
      }
      this.fail("Unsupported character class escape", escapeStart);
    }

    this.guard.allocate(4);
    return { type: "character", value: this.take() };
  }

  private parseEscape(inCharacterClass: boolean, start: number): RegexNode {
    if (this.atEnd()) {
      this.fail("Trailing escape", start);
    }

    const escaped = this.take();
    if (escaped >= "1" && escaped <= "9") {
      this.fail("Backreferences are not supported", start);
    }
    if (escaped === "p" || escaped === "P") {
      this.fail("Unicode property escapes are not supported", start);
    }
    if (escaped === "x") {
      this.guard.allocate(4);
      return { type: "literal", value: this.parseHexEscape(2, "hexadecimal", start) };
    }
    if (escaped === "u") {
      this.guard.allocate(4);
      return { type: "literal", value: this.parseHexEscape(4, "Unicode", start) };
    }

    this.guard.allocate(25);
    const kinds: Partial<Record<string, { kind: CharacterKind; negated: boolean }>> = {
      d: { kind: "digit", negated: false },
      D: { kind: "digit", negated: true },
      w: { kind: "word", negated: false },
      W: { kind: "word", negated: true },
      s: { kind: "space", negated: false },
      S: { kind: "space", negated: true }
    };
    const kind = kinds[escaped];
    if (kind !== undefined) {
      this.guard.allocate(9);
      this.guard.array(1);
      return { type: "characterClass", negated: false, items: [{ type: "kind", ...kind }] };
    }
    if (!inCharacterClass && (escaped === "b" || escaped === "B")) {
      this.guard.allocate(3);
      return { type: "wordBoundary", negated: escaped === "B" };
    }

    this.guard.allocate(8);
    const controls: Partial<Record<string, string>> = {
      b: "\b",
      f: "\f",
      n: "\n",
      r: "\r",
      t: "\t",
      v: "\v",
      "0": "\0"
    };
    this.guard.allocate(4);
    return { type: "literal", value: controls[escaped] ?? escaped };
  }

  private parseHexEscape(length: number, name: string, start: number): string {
    const end = this.position + length;
    this.guard.allocate(Math.min(length, this.source.length - this.position));
    this.guard.work(Math.min(length, this.source.length - this.position));
    const digits = this.source.slice(this.position, end);
    if (digits.length !== length || !allHexDigits(digits)) {
      this.fail(`Invalid ${name} escape`, start);
    }
    this.position = end;
    return String.fromCharCode(Number.parseInt(digits, 16));
  }

  private parseQuantifier(): { min: number; max?: number } | undefined {
    const character = this.peek();
    if (character === "*") {
      this.position += 1;
      this.guard.allocate(2);
      return { min: 0 };
    }
    if (character === "+") {
      this.position += 1;
      this.guard.allocate(2);
      return { min: 1 };
    }
    if (character === "?") {
      this.position += 1;
      this.guard.allocate(3);
      return { min: 0, max: 1 };
    }
    if (character !== "{") {
      return undefined;
    }

    const start = this.position;
    this.position += 1;
    const min = this.parseDecimal();
    if (min === undefined) {
      this.position = start;
      return undefined;
    }

    if (this.peek() === "}") {
      this.position += 1;
      this.guard.allocate(3);
      return { min, max: min };
    }
    if (this.peek() !== ",") {
      this.fail("Invalid quantifier", start);
    }
    this.position += 1;
    const max = this.parseDecimal();
    if (this.peek() !== "}") {
      this.fail("Unterminated quantifier", start);
    }
    this.position += 1;
    if (max !== undefined && min > max) {
      this.fail("Quantifier range is out of order", start);
    }
    this.guard.allocate(3);
    return { min, max };
  }

  private parseDecimal(): number | undefined {
    const start = this.position;
    while (isDecimalDigit(this.peek())) {
      this.position += 1;
    }
    if (start === this.position) {
      return undefined;
    }

    this.guard.allocate(this.position - start);
    this.guard.work(this.position - start);
    const value = Number(this.source.slice(start, this.position));
    if (!Number.isSafeInteger(value)) {
      this.fail("Quantifier is too large", start);
    }
    return value;
  }

  private peek(): string {
    return this.source[this.position] ?? "";
  }

  private take(): string {
    const character = this.peek();
    this.position += 1;
    return character;
  }

  private atEnd(): boolean {
    return this.position >= this.source.length;
  }

  private fail(message: string, position = this.position): never {
    throw new SyntaxError(`${message} at position ${position}`);
  }
}

function parseFlags(flags: string, guard: RegexCompileGuard): RegexFlags {
  guard.allocate(10);
  const parsed: RegexFlags = {
    hasIndices: false,
    global: false,
    sticky: false,
    ignoreCase: false,
    multiline: false,
    dotAll: false
  };
  const names: Record<string, keyof RegexFlags> = {
    d: "hasIndices",
    g: "global",
    i: "ignoreCase",
    m: "multiline",
    s: "dotAll",
    y: "sticky"
  };

  for (let position = 0; position < flags.length; position += 1) {
    guard.work(1);
    const flag = flags[position];
    const name = names[flag];
    if (name === undefined) {
      throw new SyntaxError(`Unsupported regex flag '${flag}' at position ${position}`);
    }
    if (parsed[name]) {
      throw new SyntaxError(`Duplicate regex flag '${flag}' at position ${position}`);
    }
    parsed[name] = true;
  }

  return parsed;
}

function isDecimalDigit(character: string): boolean {
  return character >= "0" && character <= "9";
}

function allHexDigits(value: string): boolean {
  for (const character of value) {
    if (
      !isDecimalDigit(character) &&
      !(character >= "A" && character <= "F") &&
      !(character >= "a" && character <= "f")
    ) {
      return false;
    }
  }
  return true;
}
