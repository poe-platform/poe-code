import { RegexCompileGuard, type CompileScope } from "./compile-guard.js";

const groupNameStart = /^[$_\p{ID_Start}]$/u;
const groupNamePart = /^[$\u200c\u200d\p{ID_Continue}]$/u;

export type RegexFlags = {
  hasIndices: boolean;
  global: boolean;
  sticky: boolean;
  unicode: boolean;
  ignoreCase: boolean;
  multiline: boolean;
  dotAll: boolean;
};

export type CharacterKind = "digit" | "word" | "space";

export type CharacterClassItem =
  | { type: "character"; value: string }
  | { type: "range"; from: string; to: string }
  | { type: "kind"; kind: CharacterKind; negated: boolean }
  | { type: "property"; value: string; negated: boolean };

export type RegexNode =
  | { type: "empty" }
  | { type: "literal"; value: string }
  | { type: "backreference"; index: number }
  | { type: "namedBackreference"; name: string }
  | { type: "dot" }
  | { type: "anchor"; kind: "start" | "end" }
  | { type: "wordBoundary"; negated: boolean }
  | { type: "characterClass"; negated: boolean; items: CharacterClassItem[] }
  | { type: "sequence"; elements: RegexNode[] }
  | { type: "alternation"; alternatives: RegexNode[] }
  | { type: "group"; capturing: boolean; index?: number; name?: string; body: RegexNode }
  | { type: "lookahead"; negated: boolean; body: RegexNode }
  | { type: "lookbehind"; negated: boolean; body: RegexNode }
  | { type: "quantifier"; body: RegexNode; min: number; max?: number; greedy: boolean };

export type RegexPattern = {
  source: string;
  flags: RegexFlags;
  captureCount: number;
  body: RegexNode;
  groups?: Record<string, number[]>;
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
    const parser = new RegexParser(source, guard, parsedFlags.unicode);
    const body = parser.parse();
    guard.allocate(5 + source.length);
    const pattern: RegexPattern = { source, flags: parsedFlags, captureCount: parser.captureCount, body };
    if (Object.keys(parser.namedGroups).length > 0) pattern.groups = parser.namedGroups;
    guard.retain(pattern, valueUnits);
    return pattern;
  } finally {
    guard.close();
  }
}

class RegexParser {
  captureCount = 0;
  private cursor = 0;
  private totalCaptureCount?: number;
  private hasNamedCaptures = false;
  readonly namedGroups: Record<string, number[]> = Object.create(null);

  constructor(
    private readonly source: string,
    private readonly guard: RegexCompileGuard,
    private readonly unicode: boolean
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
    if (this.unicode || Object.keys(this.namedGroups).length > 0) this.validateNamedGroups(body);
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

    if (body.type === "anchor" || body.type === "wordBoundary" || body.type === "lookbehind" ||
        (this.unicode && body.type === "lookahead")) {
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
    const character = this.takeCharacter();
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
        if (this.unicode && (character === "]" || character === "}")) this.fail("Invalid Unicode pattern character");
        this.guard.allocate(3 + character.length);
        return { type: "literal", value: character };
    }
  }

  private parseGroup(start: number): RegexNode {
    let capturing = true;
    let name: string | undefined;
    let assertionNegated: boolean | undefined;
    let lookbehind = false;
    if (this.peek() === "?") {
      this.guard.allocate(Math.min(3, this.source.length - this.position));
      this.guard.work(Math.min(3, this.source.length - this.position));
      const extension = this.source.slice(this.position, this.position + 3);
      if (extension.startsWith("?:")) {
        capturing = false;
        this.position += 2;
      } else if (extension.startsWith("?=") || extension.startsWith("?!")) {
        capturing = false;
        assertionNegated = extension.startsWith("?!");
        this.position += 2;
      } else if (extension.startsWith("?<=") || extension.startsWith("?<!")) {
        capturing = false;
        assertionNegated = extension.startsWith("?<!");
        lookbehind = true;
        this.position += 3;
      } else if (extension.startsWith("?<")) {
        this.position += 2;
        name = this.parseGroupName(start);
      } else {
        this.fail("Unsupported group construct", start);
      }
    }

    if (capturing) this.guard.allocate(1);
    const index = capturing ? ++this.captureCount : undefined;
    if (name !== undefined) {
      this.guard.allocate(name.length + 2);
      const indices = this.namedGroups[name] ??= [];
      this.guard.array(indices.length + 1);
      indices.push(index!);
    }
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

    if (assertionNegated !== undefined) {
      this.guard.allocate(4);
      return { type: lookbehind ? "lookbehind" : "lookahead", negated: assertionNegated, body };
    }
    this.guard.allocate(5);
    return { type: "group", capturing, index, body, ...(name === undefined ? {} : { name }) };
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
        if (left.value.codePointAt(0)! > right.value.codePointAt(0)!) {
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
    return { type: "character", value: this.takeCharacter() };
  }

  private parseEscape(inCharacterClass: boolean, start: number): RegexNode {
    if (this.atEnd()) {
      this.fail("Trailing escape", start);
    }

    const escaped = this.take();
    if (escaped === "k") {
      this.totalCaptureCount ??= this.countAllCaptures();
      if (this.unicode || this.hasNamedCaptures) {
        if (inCharacterClass || this.take() !== "<") this.fail("Invalid named backreference", start);
        const name = this.parseGroupName(start);
        this.guard.allocate(3 + name.length);
        return { type: "namedBackreference", name };
      }
    }
    if (isDecimalDigit(escaped)) {
      if (!inCharacterClass && escaped !== "0") {
        let end = this.position;
        let index = Number(escaped);
        while (isDecimalDigit(this.source[end] ?? "")) {
          this.guard.work(1);
          index = index * 10 + Number(this.source[end++]);
        }
        this.totalCaptureCount ??= this.countAllCaptures();
        if (index <= this.totalCaptureCount) {
          this.position = end;
          this.guard.allocate(3);
          return { type: "backreference", index };
        }
      }
      if (this.unicode && (escaped !== "0" || isDecimalDigit(this.peek())))
        this.fail("Invalid decimal escape", start);
      this.guard.allocate(4);
      if (escaped === "8" || escaped === "9") return { type: "literal", value: escaped };
      let code = Number(escaped);
      const maximum = escaped <= "3" ? 3 : 2;
      for (let digits = 1; digits < maximum && this.peek() >= "0" && this.peek() <= "7"; digits++) {
        code = code * 8 + Number(this.take());
      }
      return { type: "literal", value: String.fromCharCode(code) };
    }
    if (escaped === "p" || escaped === "P") {
      if (!this.unicode) this.fail("Unicode property escapes are not supported", start);
      if (this.take() !== "{") this.fail("Invalid Unicode property escape", start);
      const begin = this.position;
      while (!this.atEnd() && this.peek() !== "}") {
        const character = this.take();
        if (!isDecimalDigit(character) && !(character >= "a" && character <= "z") &&
            !(character >= "A" && character <= "Z") && character !== "_" && character !== "=")
          this.fail("Invalid Unicode property escape", start);
      }
      this.guard.allocate(this.position - begin + 9);
      const value = this.source.slice(begin, this.position);
      if (this.take() !== "}") this.fail("Unterminated Unicode property escape", start);
      // Only a validated property token reaches the host's single-character classifier.
      try { new RegExp(`\\p{${value}}`, "u"); }
      catch { this.fail("Unknown Unicode property", start); }
      this.guard.array(1);
      return { type: "characterClass", negated: false, items: [{ type: "property", value, negated: escaped === "P" }] };
    }
    if (escaped === "x") {
      this.guard.allocate(4);
      return { type: "literal", value: this.parseHexEscape(2, "hexadecimal", start) };
    }
    if (escaped === "u") {
      this.guard.allocate(4);
      if (this.unicode && this.peek() === "{") {
        this.position++;
        const begin = this.position;
        while (!this.atEnd() && this.peek() !== "}") this.position++;
        this.guard.allocate(this.position - begin);
        const digits = this.source.slice(begin, this.position);
        const point = Number.parseInt(digits, 16);
        if (this.take() !== "}" || digits.length === 0 || !allHexDigits(digits) || point > 0x10ffff)
          this.fail("Invalid Unicode escape", start);
        return { type: "literal", value: String.fromCodePoint(point) };
      }
      let value = this.parseHexEscape(4, "Unicode", start);
      if (this.unicode && value.charCodeAt(0) >= 0xd800 && value.charCodeAt(0) <= 0xdbff &&
          this.source.startsWith("\\u", this.position)) {
        const digits = this.source.slice(this.position + 2, this.position + 6);
        const point = Number.parseInt(digits, 16);
        this.guard.work(digits.length);
        this.guard.allocate(digits.length);
        if (digits.length === 4 && allHexDigits(digits) && point >= 0xdc00 && point <= 0xdfff) {
          value += String.fromCharCode(point);
          this.position += 6;
        }
      }
      return { type: "literal", value };
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
    if (escaped === "c" && this.unicode) {
      const letter = this.take();
      if (!(letter >= "a" && letter <= "z") && !(letter >= "A" && letter <= "Z"))
        this.fail("Invalid control escape", start);
      this.guard.allocate(4);
      return { type: "literal", value: String.fromCharCode(letter.charCodeAt(0) % 32) };
    }
    if (this.unicode && controls[escaped] === undefined &&
        !"^$\\.*+?()[]{}|/".includes(escaped) && !(inCharacterClass && escaped === "-"))
      this.fail("Invalid identity escape", start);
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

  private countAllCaptures(): number {
    let count = 0;
    let escaped = false;
    let characterClass = false;
    for (let index = 0; index < this.source.length; index++) {
      this.guard.work(1);
      const character = this.source[index];
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === "[") characterClass = true;
      else if (character === "]") characterClass = false;
      else if (!characterClass && character === "(") {
        const named = this.source[index + 1] === "?" && this.source[index + 2] === "<" &&
          this.source[index + 3] !== "=" && this.source[index + 3] !== "!";
        if (named) this.hasNamedCaptures = true;
        if (named || this.source[index + 1] !== "?") count++;
      }
    }
    return count;
  }

  private parseGroupName(start: number): string {
    let name = "";
    while (!this.atEnd() && this.peek() !== ">") {
      let character = this.take();
      if (character === "\\") {
        if (this.take() !== "u") this.fail("Invalid group name escape", start);
        if (this.peek() === "{") {
          this.position++;
          const begin = this.position;
          while (!this.atEnd() && this.peek() !== "}") this.position++;
          this.guard.allocate(this.position - begin);
          const digits = this.source.slice(begin, this.position);
          const point = Number.parseInt(digits, 16);
          if (this.take() !== "}" || digits.length === 0 || !allHexDigits(digits) || point > 0x10ffff)
            this.fail("Invalid group name escape", start);
          character = String.fromCodePoint(point);
        } else character = this.parseHexEscape(4, "Unicode", start);
      }
      this.guard.allocate(character.length);
      name += character;
    }
    if (this.take() !== ">" || name.length === 0) this.fail("Invalid group name", start);
    let first = true;
    for (const character of name) {
      this.guard.work(1);
      if (!(first ? groupNameStart : groupNamePart).test(character)) this.fail("Invalid group name", start);
      first = false;
    }
    return name;
  }

  private validateNamedGroups(node: RegexNode): Set<string> {
    this.guard.work(1);
    this.guard.allocate(1);
    const names = new Set<string>();
    if (node.type === "namedBackreference" && !Object.hasOwn(this.namedGroups, node.name))
      this.fail("Unknown named backreference");
    if (node.type === "group" && node.name !== undefined) names.add(node.name);
    const children = node.type === "sequence" ? node.elements : node.type === "alternation" ? node.alternatives
      : node.type === "group" || node.type === "quantifier" || node.type === "lookahead" || node.type === "lookbehind" ? [node.body] : [];
    for (const child of children) {
      for (const name of this.validateNamedGroups(child)) {
        this.guard.work(1);
        if (names.has(name) && node.type !== "alternation") this.fail("Duplicate capture group name");
        this.guard.allocate(1);
        names.add(name);
      }
    }
    return names;
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

  private takeCharacter(): string {
    if (!this.unicode || this.atEnd()) return this.take();
    const character = String.fromCodePoint(this.source.codePointAt(this.position)!);
    this.position += character.length;
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
    unicode: false,
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
    y: "sticky",
    u: "unicode"
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
