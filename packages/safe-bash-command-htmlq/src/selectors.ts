import { HtmlBudget, HtmlError, type HtmlNode, type HtmlOptions } from "./contracts.js";
import { inclusiveHtmlDescendants } from "./traversal.js";
export const cssSpace = (c: string): boolean =>
  c === " " || c === "\t" || c === "\n" || c === "\r" || c === "\f";
function asciiLower(s: string): string {
  let out = "",
    changed = false;
  for (let i = 0; i < s.length; i++) {
    const n = s.charCodeAt(i);
    if (n >= 65 && n <= 90) {
      if (!changed) out = s.slice(0, i);
      changed = true;
      out += String.fromCharCode(n + 32);
    } else if (changed) out += s[i];
  }
  return changed ? out : s;
}
type Test =
  | { kind: "type" | "id" | "class"; value: string; namespace?: "any" | "none" }
  | { kind: "attribute"; value: string; operator: string; expected: string; insensitive: boolean }
  | { kind: "pseudo"; value: string; a: number; b: number; negated?: Program };
type Part = { tests: Test[]; relation: "" | " " | ">" | "+" | "~" };
type Program = Part[][];
class Parser {
  private at = 0;
  constructor(
    private source: string,
    private budget: HtmlBudget
  ) {
    budget.bound("tokenBytes", source.length * 2);
    budget.charge("retainedBytes", source.length * 2);
  }
  fail(): never {
    throw new HtmlError("E_SELECTOR", "Invalid or unsupported CSS selector", this.at);
  }
  peek(): string {
    return this.source[this.at] ?? "";
  }
  take(): string {
    this.budget.charge("work", 1);
    return this.source[this.at++] ?? "";
  }
  spaces(): boolean {
    const start = this.at;
    while (this.peek() && cssSpace(this.peek())) this.take();
    return this.at !== start;
  }
  escapeWhitespace(): void {
    const c = this.take();
    if (c === "\r" && this.peek() === "\n") this.take();
  }
  identifier(): string {
    const first = this.peek(),
      second = this.source[this.at + 1] ?? "";
    const start = (c: string): boolean =>
      !!c &&
      (c === "_" ||
        c === "\0" ||
        c === "\\" ||
        (c >= "a" && c <= "z") ||
        (c >= "A" && c <= "Z") ||
        c.charCodeAt(0) >= 128);
    if (!start(first) && !(first === "-" && (second === "-" || start(second)))) this.fail();
    let out = "";
    while (this.peek()) {
      const c = this.peek();
      if (c === "\\") {
        this.take();
        let hex = "";
        while (hex.length < 6 && this.peek() && "0123456789abcdefABCDEF".includes(this.peek()))
          hex += this.take();
        if (hex) {
          const n = Number.parseInt(hex, 16);
          out += String.fromCodePoint(
            n === 0 || n > 0x10ffff || (n >= 0xd800 && n <= 0xdfff) ? 0xfffd : n
          );
          if (cssSpace(this.peek())) this.escapeWhitespace();
        } else {
          if (!this.peek() || this.peek() === "\n" || this.peek() === "\r" || this.peek() === "\f")
            this.fail();
          const escaped = this.take();
          out += escaped === "\0" ? "\ufffd" : escaped;
        }
      } else if (
        c === "-" ||
        c === "_" ||
        c === "\0" ||
        (c >= "a" && c <= "z") ||
        (c >= "A" && c <= "Z") ||
        (c >= "0" && c <= "9") ||
        c.charCodeAt(0) >= 128
      )
        out += this.take() === "\0" ? "\ufffd" : c;
      else break;
    }
    if (!out) this.fail();
    this.budget.charge("retainedBytes", out.length * 2);
    return out;
  }
  quoted(): string {
    const quote = this.take();
    let out = "";
    while (this.peek() && this.peek() !== quote) {
      if (this.peek() === "\\") {
        // Reuse CSS escape decoding, allowing punctuation in quoted strings.
        this.take();
        let hex = "";
        while (hex.length < 6 && this.peek() && "0123456789abcdefABCDEF".includes(this.peek()))
          hex += this.take();
        if (hex) {
          const n = Number.parseInt(hex, 16);
          out += String.fromCodePoint(
            n === 0 || n > 0x10ffff || (n >= 0xd800 && n <= 0xdfff) ? 0xfffd : n
          );
          if (cssSpace(this.peek())) this.escapeWhitespace();
        } else if (this.peek() === "\n" || this.peek() === "\r" || this.peek() === "\f")
          this.escapeWhitespace();
        else if (this.peek()) {
          const escaped = this.take();
          out += escaped === "\0" ? "\ufffd" : escaped;
        }
        else this.fail();
      } else {
        if (this.peek() === "\n" || this.peek() === "\r" || this.peek() === "\f") this.fail();
        const c = this.take();
        out += c === "\0" ? "\ufffd" : c;
      }
    }
    if (this.take() !== quote) this.fail();
    this.budget.charge("retainedBytes", out.length * 2);
    return out;
  }
  list(inNot = false): Program {
    const result: Program = [];
    do {
      this.spaces();
      const parts: Part[] = [];
      let relation: Part["relation"] = "";
      while (true) {
        this.budget.bound("depth", parts.length);
        const tests: Test[] = [];
        let c = this.peek();
        if (c === "*" || c === "|" || (c && !".#[:>,+~)".includes(c))) {
          let value = c === "*" ? this.take() : c === "|" ? "*" : this.identifier();
          let namespace: "any" | "none" | undefined;
          if (this.peek() === "|") {
            this.take();
            namespace = value === "*" && c === "|" ? "none" : value === "*" ? "any" : this.fail();
            value = this.peek() === "*" ? this.take() : this.identifier();
          }
          tests.push(namespace ? { kind: "type", value, namespace } : { kind: "type", value });
        }
        while ((c = this.peek()) && ".#[:".includes(c)) {
          this.take();
          if (c === "." || c === "#")
            tests.push({ kind: c === "." ? "class" : "id", value: this.identifier() });
          else if (c === "[") {
            this.spaces();
            const value = this.identifier();
            this.spaces();
            let operator = "",
              expected = "",
              insensitive = false;
            if (this.peek() !== "]") {
              operator = this.take();
              if (operator !== "=") {
                if (!"~|^$*".includes(operator) || this.take() !== "=") this.fail();
                operator += "=";
              }
              this.spaces();
              expected =
                this.peek() === '"' || this.peek() === "'" ? this.quoted() : this.identifier();
              this.spaces();
              if (this.peek() !== "]") {
                const flag = asciiLower(this.identifier());
                if (flag !== "i" && flag !== "s") this.fail();
                insensitive = flag === "i";
                this.spaces();
              }
            }
            if (this.take() !== "]") this.fail();
            tests.push({ kind: "attribute", value, operator, expected, insensitive });
          } else {
            const value = asciiLower(this.identifier());
            if (value === "not") {
              if (inNot || this.take() !== "(") this.fail();
              const negated = this.list(true);
              if (
                negated.length !== 1 ||
                negated[0]!.length !== 1 ||
                negated[0]![0]!.tests.length !== 1
              )
                this.fail();
              if (this.take() !== ")") this.fail();
              tests.push({ kind: "pseudo", value, a: 0, b: 0, negated });
            } else if (
              ["nth-child", "nth-last-child", "nth-of-type", "nth-last-of-type"].includes(value)
            ) {
              if (this.take() !== "(") this.fail();
              let formula = "";
              while (this.peek() && this.peek() !== ")") formula += this.take();
              if (this.take() !== ")") this.fail();
              this.budget.charge("retainedBytes", formula.length * 4);
              this.budget.charge("work", formula.length);
              const [a, b] = this.nth(formula);
              tests.push({ kind: "pseudo", value, a, b });
            } else {
              if (
                ![
                  "root",
                  "scope",
                  "empty",
                  "first-child",
                  "last-child",
                  "only-child",
                  "first-of-type",
                  "last-of-type",
                  "only-of-type",
                  "any-link",
                  "link",
                  "visited",
                  "active",
                  "focus",
                  "hover",
                  "enabled",
                  "disabled",
                  "checked",
                  "indeterminate"
                ].includes(value)
              )
                this.fail();
              tests.push({ kind: "pseudo", value, a: 0, b: 0 });
            }
          }
          this.budget.charge("retainedBytes", 96);
        }
        if (!tests.length) this.fail();
        parts.push({ tests, relation });
        this.budget.charge("retainedBytes", 64);
        const space = this.spaces();
        c = this.peek();
        if (!c || c === "," || c === ")") break;
        if (">+~".includes(c)) {
          relation = this.take() as Part["relation"];
          this.spaces();
        } else if (space) relation = " ";
        else this.fail();
      }
      result.push(parts);
      if (this.peek() !== ",") break;
      this.take();
    } while (this.at <= this.source.length);
    if (!inNot && this.peek()) this.fail();
    return result;
  }
  nth(source: string): [number, number] {
    let at = 0;
    const spaces = (): void => {
      while (source[at] && cssSpace(source[at]!)) at++;
    };
    const digits = (): string => {
      let out = "";
      while (source[at] && source[at]! >= "0" && source[at]! <= "9") out += source[at++];
      return out;
    };
    const integer = (v: string): number => {
      const n = Number(v);
      if (!Number.isSafeInteger(n) || n < -2147483648 || n > 2147483647) this.fail();
      return n;
    };
    spaces();
    let end = source.length;
    while (end > at && cssSpace(source[end - 1]!)) end--;
    const word = asciiLower(source.slice(at, end));
    if (word === "odd") return [2, 1];
    if (word === "even") return [2, 0];
    let sign = "";
    if (source[at] === "+" || source[at] === "-") sign = source[at++]!;
    const number = digits();
    if (asciiLower(source[at] ?? "") !== "n") {
      spaces();
      if (!number || at !== source.length) this.fail();
      return [0, integer(sign + number)];
    }
    at++;
    const a = number ? integer(sign + number) : sign === "-" ? -1 : 1;
    spaces();
    if (at === source.length) return [a, 0];
    const offsetSign = source[at++];
    if (offsetSign !== "+" && offsetSign !== "-") this.fail();
    spaces();
    const offset = digits();
    spaces();
    if (!offset || at !== source.length) this.fail();
    return [a, integer(offsetSign + offset)];
  }
}
function attribute(node: HtmlNode, name: string, budget: HtmlBudget): string | undefined {
  budget.charge("work", name.length);
  budget.charge("retainedBytes", name.length * 2);
  const expected = node.namespace === "html" ? asciiLower(name) : name;
  for (const a of node.attributes) {
    budget.charge("work", a.name.length + expected.length + 1);
    if (a.namespace === "none" && a.name === expected) return a.value;
  }
  return undefined;
}
function previous(node: HtmlNode, budget: HtmlBudget): HtmlNode | null {
  let n = node.previousSibling;
  while (n && n.kind !== "element") {
    budget.charge("work", 1);
    n = n.previousSibling;
  }
  return n;
}
function hasWord(value: string, word: string, budget: HtmlBudget): boolean {
  budget.charge("work", value.length + word.length);
  if (!word) return false;
  for (const c of word) if (cssSpace(c)) return false;
  let start = 0;
  for (let i = 0; i <= value.length; i++) {
    if (i === value.length || cssSpace(value[i]!)) {
      if (i - start === word.length && value.startsWith(word, start)) return true;
      start = i + 1;
    }
  }
  return false;
}
function matchesTest(node: HtmlNode, test: Test, budget: HtmlBudget): boolean {
  budget.charge("work", 1);
  if (test.kind === "type") {
    budget.charge("work", node.name.length + test.value.length);
    budget.charge("retainedBytes", test.value.length * 2);
    return (
      test.namespace !== "none" &&
      (test.value === "*" ||
        node.name === (node.namespace === "html" ? asciiLower(test.value) : test.value))
    );
  }
  if (test.kind === "id") {
    const value = attribute(node, "id", budget);
    if (value === undefined) return false;
    budget.charge("work", value.length + test.value.length);
    return value === test.value;
  }
  if (test.kind === "class")
    return hasWord(attribute(node, "class", budget) ?? "", test.value, budget);
  if (test.kind === "attribute") {
    let value = attribute(node, test.value, budget),
      expected = test.expected;
    if (value === undefined) return false;
    budget.charge("work", value.length + expected.length);
    if (test.insensitive) {
      budget.charge("retainedBytes", (value.length + expected.length) * 4);
      value = asciiLower(value);
      expected = asciiLower(expected);
    }
    switch (test.operator) {
      case "":
        return true;
      case "=":
        return value === expected;
      case "^=":
        return !!expected && value.startsWith(expected);
      case "$=":
        return !!expected && value.endsWith(expected);
      case "*=":
        return !!expected && value.includes(expected);
      case "|=":
        return value === expected || value.startsWith(expected + "-");
      case "~=":
        return hasWord(value, expected, budget);
      default:
        return false;
    }
  }
  if (test.kind !== "pseudo") return false;
  const p = test.value;
  if (p === "not") return !matchesProgram(node, test.negated!, budget);
  if (p === "root" || p === "scope") return node.parent?.kind === "document";
  if (p === "any-link" || p === "link")
    return (
      node.namespace === "html" &&
      ["a", "area", "link"].includes(node.name) &&
      attribute(node, "href", budget) !== undefined
    );
  if (p === "empty") {
    for (const child of node.children) {
      budget.charge("work", 1);
      if (child.kind === "element" || (child.kind === "text" && child.data.length)) return false;
    }
    return true;
  }
  if (
    [
      "visited",
      "active",
      "focus",
      "hover",
      "enabled",
      "disabled",
      "checked",
      "indeterminate"
    ].includes(p)
  )
    return false;
  let index = 0,
    count = 0;
  for (const child of node.parent?.children ?? []) {
    budget.charge("work", 1);
    if (
      child.kind !== "element" ||
      (p.includes("of-type") && (child.name !== node.name || child.namespace !== node.namespace))
    )
      continue;
    count++;
    if (child === node) index = count;
  }
  if (!index) return false;
  if (p.startsWith("first-")) return index === 1;
  if (p.startsWith("last-")) return index === count;
  if (p.startsWith("only-")) return count === 1;
  if (p.includes("last")) index = count - index + 1;
  const delta = index - test.b;
  return test.a === 0 ? delta === 0 : delta / test.a >= 0 && delta % test.a === 0;
}
function matchesProgram(node: HtmlNode, program: Program, budget: HtmlBudget): boolean {
  const match = (n: HtmlNode, parts: Part[], at: number, depth: number): boolean => {
    budget.bound("depth", depth);
    budget.charge("work", 1);
    if (n.kind !== "element" || !parts[at]!.tests.every((t) => matchesTest(n, t, budget)))
      return false;
    if (!at) return true;
    const relation = parts[at]!.relation;
    if (relation === ">") return !!n.parent && match(n.parent, parts, at - 1, depth + 1);
    if (relation === "+") {
      const prev = previous(n, budget);
      return !!prev && match(prev, parts, at - 1, depth + 1);
    }
    if (relation === "~") {
      for (let prev = previous(n, budget); prev; prev = previous(prev, budget))
        if (match(prev, parts, at - 1, depth + 1)) return true;
      return false;
    }
    for (let parent = n.parent; parent; parent = parent.parent) {
      budget.charge("work", 1);
      if (match(parent, parts, at - 1, depth + 1)) return true;
    }
    return false;
  };
  return program.some((parts) => match(node, parts, parts.length - 1, 0));
}
/** Compile once; matching and traversal remain live under detach mutations. */
export function selectHtml(
  root: HtmlNode,
  selector: string,
  options: HtmlOptions
): Generator<HtmlNode, void> {
  const budget = new HtmlBudget(options);
  const program = new Parser(selector, budget).list();
  return (function* () {
    for (const node of inclusiveHtmlDescendants(root, options)) {
      budget.charge("work", 1);
      if (node.kind === "element" && matchesProgram(node, program, budget)) yield node;
    }
  })();
}
