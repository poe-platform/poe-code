import { isMainThread } from "node:worker_threads";
import { ExprMatchError, type ExprMatchDescriptor, type ExprMatchLimits, type ExprMatchResult } from "../regex-execution/protocol.js";

type CharacterSet = { negate: boolean; ranges: [number, number][]; classes: string[] };
type Atom = { kind: "literal"; value: number } | { kind: "dot" } | { kind: "set"; set: CharacterSet }
  | { kind: "start" | "end" } | { kind: "backref"; group: number };
type Tree = Atom | { kind: "sequence"; children: Tree[] } | { kind: "alternative"; children: Tree[] }
  | { kind: "group"; group: number; child: Tree }
  | { kind: "repeat"; child: Tree; minimum: number; maximum: number };
type Instruction = Atom | { kind: "split"; first: number; second: number }
  | { kind: "jump"; target: number } | { kind: "save"; slot: number } | { kind: "accept" };

class Work {
  steps = 0;
  private nodes = 0;
  private allocated = 0;
  private states = 0;
  constructor(readonly limits: ExprMatchLimits) {}
  charge(amount = 1): void {
    if (amount > this.limits.maxSteps - this.steps) throw new ExprMatchError("limit", "regex work limit exceeded");
    this.steps += amount;
  }
  allocate(amount: number): void {
    this.charge(amount);
    if (amount > this.limits.maxAllocatedUnits - this.allocated) throw new ExprMatchError("limit", "regex allocation limit exceeded");
    this.allocated += amount;
  }
  node(): void {
    this.allocate(8);
    if (++this.nodes > this.limits.maxNodes) throw new ExprMatchError("limit", "regex nodes limit exceeded");
  }
  state(): void {
    this.charge();
    if (++this.states > this.limits.maxStates) throw new ExprMatchError("limit", "regex states limit exceeded");
  }
}

function syntax(message: string): never { throw new ExprMatchError("syntax", message); }
function unsupported(message: string): never { throw new ExprMatchError("unsupported", `unsupported BRE: ${message}`); }
const classes = ["alnum", "alpha", "blank", "cntrl", "digit", "graph", "lower", "print", "punct", "space", "upper", "xdigit"];

class Parser {
  private position = 0;
  groups = 0;
  private readonly closed = new Set<number>();
  constructor(private readonly tokens: readonly string[], private readonly work: Work) {}
  private at(value: string): boolean { return this.tokens[this.position] === value; }
  private escaped(value: string): boolean { return this.at("\\") && this.tokens[this.position + 1] === value; }
  private tree<TreeNode extends Tree>(node: TreeNode): TreeNode { this.work.node(); return node; }
  parse(depth = 0): Tree {
    if (depth > this.work.limits.maxDepth) throw new ExprMatchError("limit", "regex depth limit exceeded");
    const branches: Tree[] = [];
    do {
      if (branches.length) this.position += 2;
      const children: Tree[] = [];
      while (this.position < this.tokens.length && !this.escaped("|") && !this.escaped(")")) {
        this.work.charge();
        let child = this.atom(depth, children.length === 0);
        if (this.at("*") || this.escaped("+") || this.escaped("?") || this.escaped("{")) {
          const repetition = this.repetition();
          if (child.kind === "start" || child.kind === "end") unsupported("repeated anchor");
          child = this.tree({ kind: "repeat", child, ...repetition });
          if (this.at("*") || this.escaped("+") || this.escaped("?") || this.escaped("{")) unsupported("stacked repetition operators");
        }
        children.push(child);
      }
      branches.push(this.tree({ kind: "sequence", children }));
    } while (this.escaped("|"));
    if (depth === 0 && this.position !== this.tokens.length) syntax("Unmatched ) or \\)");
    return branches.length === 1 ? branches[0]! : this.tree({ kind: "alternative", children: branches });
  }
  private atom(depth: number, initial: boolean): Tree {
    const token = this.tokens[this.position++]!;
    if (token === "[") return this.tree({ kind: "set", set: this.bracket() });
    if (token === ".") return this.tree({ kind: "dot" });
    if (token === "^" && initial) return this.tree({ kind: "start" });
    if (token === "$" && (this.position === this.tokens.length || this.escaped("|") || this.escaped(")"))) return this.tree({ kind: "end" });
    if (token !== "\\") return this.tree({ kind: "literal", value: token.codePointAt(0)! });
    const escaped = this.tokens[this.position++];
    if (escaped === undefined) syntax("Trailing backslash");
    if (escaped === "(") {
      const group = ++this.groups;
      if (group > 32) throw new ExprMatchError("limit", "regex capture groups limit exceeded");
      const child = this.parse(depth + 1);
      if (!this.escaped(")")) syntax("Unmatched ( or \\(");
      this.position += 2;
      this.closed.add(group);
      return this.tree({ kind: "group", group, child });
    }
    if (escaped >= "1" && escaped <= "9") {
      const group = Number(escaped);
      if (!this.closed.has(group)) syntax("Invalid back reference");
      return this.tree({ kind: "backref", group });
    }
    if (escaped === "{" || escaped === "+" || escaped === "?") unsupported("leading escaped repetition operator");
    if (escaped === "`" || escaped === "'" || escaped === "<" || escaped === ">"
      || escaped >= "a" && escaped <= "z" || escaped >= "A" && escaped <= "Z" || escaped === "0") unsupported("alphabetic, word or buffer escape");
    return this.tree({ kind: "literal", value: escaped.codePointAt(0)! });
  }
  private repetition(): { minimum: number; maximum: number } {
    if (this.at("*")) { this.position++; return { minimum: 0, maximum: Infinity }; }
    if (this.escaped("+")) { this.position += 2; return { minimum: 1, maximum: Infinity }; }
    if (this.escaped("?")) { this.position += 2; return { minimum: 0, maximum: 1 }; }
    this.position += 2;
    const number = (): number | undefined => {
      let value = 0, count = 0;
      while (this.tokens[this.position]! >= "0" && this.tokens[this.position]! <= "9") {
        this.work.charge();
        value = value * 10 + Number(this.tokens[this.position++]);
        if (++count > 5 || value > 32767) syntax("Regular expression too big");
      }
      return count ? value : undefined;
    };
    const minimum = number();
    if (minimum === undefined) syntax("Invalid content of \\{\\}");
    let maximum: number = minimum;
    if (this.at(",")) { this.position++; maximum = number() ?? Infinity; }
    if (!this.escaped("}")) syntax("Unmatched \\{");
    this.position += 2;
    if (maximum < minimum) syntax("Invalid content of \\{\\}");
    return { minimum, maximum };
  }
  private bracket(): CharacterSet {
    if (this.position === this.tokens.length) syntax("Invalid regular expression");
    const set: CharacterSet = { negate: this.at("^"), ranges: [], classes: [] };
    if (set.negate) this.position++;
    let first = true;
    while (this.position < this.tokens.length) {
      this.work.allocate(4);
      if (this.at("]") && !first) { this.position++; return set; }
      first = false;
      if (this.at("[") && [":", ".", "="].includes(this.tokens[this.position + 1]!)) {
        const marker = this.tokens[this.position + 1]!;
        if (marker !== ":") unsupported("collating symbols and equivalence classes");
        this.position += 2;
        let name = "";
        while (this.position < this.tokens.length && !this.at(":")) {
          this.work.charge();
          if (name.length >= 16) syntax("Invalid character class name");
          name += this.tokens[this.position++];
        }
        if (!this.at(":") || this.tokens[this.position + 1] !== "]" || !classes.includes(name)) syntax("Invalid character class name");
        this.position += 2;
        set.classes.push(name);
        if (this.at("-") && this.tokens[this.position + 1] !== "]") unsupported("character class range endpoint");
        continue;
      }
      const start = this.tokens[this.position++]!.codePointAt(0)!;
      if (this.at("-") && this.tokens[this.position + 1] !== "]" && this.position + 1 < this.tokens.length) {
        this.position++;
        if (this.at("[") && [":", ".", "="].includes(this.tokens[this.position + 1]!)) unsupported("character class range endpoint");
        const end = this.tokens[this.position++]!.codePointAt(0)!;
        if (start > 127 || end > 127) unsupported("non-ASCII range endpoints");
        set.ranges.push([start, end]);
      } else set.ranges.push([start, start]);
    }
    syntax("Unmatched [, [^, [:, [., or [=");
  }
}

function validateCaptureRepetition(tree: Tree, work: Work): void {
  const references = new Set<number>(), ambiguous = new Set<number>();
  const cached = new Map<Tree, boolean>();
  const nullable = (node: Tree): boolean => {
    work.charge();
    const prior = cached.get(node);
    if (prior !== undefined) return prior;
    const result = node.kind === "start" || node.kind === "end" || node.kind === "backref"
      || node.kind === "group" && nullable(node.child)
      || node.kind === "repeat" && (node.minimum === 0 || nullable(node.child))
      || node.kind === "sequence" && node.children.every(nullable)
      || node.kind === "alternative" && node.children.some(nullable);
    work.allocate(2); cached.set(node, result);
    return result;
  };
  const visit = (node: Tree, repeatedNullable: boolean): void => {
    work.charge();
    if (node.kind === "backref") { work.allocate(1); references.add(node.group); }
    else if (node.kind === "group") {
      if (repeatedNullable) { work.allocate(1); ambiguous.add(node.group); }
      visit(node.child, repeatedNullable);
    } else if (node.kind === "repeat") visit(node.child, repeatedNullable || node.maximum > 1 && nullable(node.child));
    else if (node.kind === "sequence" || node.kind === "alternative") for (const child of node.children) visit(child, repeatedNullable);
  };
  visit(tree, false);
  for (const group of references) if (ambiguous.has(group)) unsupported("backreference to a capture in nullable repetition");
}

function compile(tree: Tree, work: Work): Instruction[] {
  validateCaptureRepetition(tree, work);
  const instructions: Instruction[] = [];
  const emit = (instruction: Instruction): number => { work.node(); instructions.push(instruction); return instructions.length - 1; };
  const build = (node: Tree): void => {
    work.charge();
    if (node.kind === "sequence") { for (const child of node.children) build(child); }
    else if (node.kind === "alternative") {
      const ends: { kind: "jump"; target: number }[] = [];
      for (let index = 0; index < node.children.length - 1; index++) {
        const branch: Instruction & { kind: "split" } = { kind: "split", first: instructions.length + 1, second: 0 };
        emit(branch);
        build(node.children[index]!);
        const end: Instruction & { kind: "jump" } = { kind: "jump", target: 0 };
        emit(end); ends.push(end);
        branch.second = instructions.length;
      }
      build(node.children.at(-1)!);
      for (const end of ends) end.target = instructions.length;
    } else if (node.kind === "group") {
      emit({ kind: "save", slot: (node.group - 1) * 2 });
      build(node.child);
      emit({ kind: "save", slot: (node.group - 1) * 2 + 1 });
    } else if (node.kind === "repeat") {
      for (let count = 0; count < node.minimum; count++) build(node.child);
      if (node.maximum === Infinity) {
        const start = instructions.length;
        const branch: Instruction & { kind: "split" } = { kind: "split", first: start + 1, second: 0 };
        emit(branch); build(node.child); emit({ kind: "jump", target: start });
        branch.second = instructions.length;
      } else {
        for (let count = node.minimum; count < node.maximum; count++) {
          const branch: Instruction & { kind: "split" } = { kind: "split", first: instructions.length + 1, second: 0 };
          emit(branch); build(node.child); branch.second = instructions.length;
        }
      }
    } else emit(node);
  };
  build(tree); emit({ kind: "accept" });
  return instructions;
}

function member(value: number, name: string): boolean {
  const lower = value >= 97 && value <= 122, upper = value >= 65 && value <= 90;
  const digit = value >= 48 && value <= 57, alpha = lower || upper;
  const graph = value >= 33 && value <= 126;
  switch (name) {
    case "alnum": return alpha || digit;
    case "alpha": return alpha;
    case "blank": return value === 32 || value === 9;
    case "cntrl": return value < 32 || value === 127;
    case "digit": return digit;
    case "graph": return graph;
    case "lower": return lower;
    case "print": return value >= 32 && value <= 126;
    case "punct": return graph && !alpha && !digit;
    case "space": return value === 32 || value >= 9 && value <= 13;
    case "upper": return upper;
    case "xdigit": return digit || value >= 65 && value <= 70 || value >= 97 && value <= 102;
    default: return false;
  }
}

function symbols(bytes: Uint8Array, unicode: boolean, work: Work): { values: number[]; boundaries: number[] } {
  work.allocate(bytes.length * 3 + 1);
  const values: number[] = [], boundaries: number[] = [0];
  if (!unicode) {
    for (let offset = 0; offset < bytes.length; offset++) { values.push(bytes[offset]!); boundaries.push(offset + 1); }
  } else {
    let text: string;
    try { text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes); }
    catch { unsupported("invalid UTF-8 in scalar profile"); }
    let offset = 0;
    for (const character of text) {
      const value = character.codePointAt(0)!;
      values.push(value);
      offset += value < 0x80 ? 1 : value < 0x800 ? 2 : value < 0x10000 ? 3 : 4;
      boundaries.push(offset);
    }
  }
  return { values, boundaries };
}

export function matchExpr(descriptor: ExprMatchDescriptor, subject: Uint8Array): ExprMatchResult {
  if (isMainThread) throw new Error("expr BRE compilation/execution requires the regex worker");
  const work = new Work(descriptor.limits);
  const pattern = symbols(descriptor.pattern, descriptor.profile === "utf8-scalar", work);
  work.allocate(pattern.values.length * 2);
  const parser = new Parser(pattern.values.map(value => String.fromCodePoint(value)), work);
  const instructions = compile(parser.parse(), work);
  const input = symbols(subject, descriptor.profile === "utf8-scalar", work);
  if (descriptor.profile === "utf8-scalar" && input.values.some(value => value > 127)
    && instructions.some(instruction => instruction.kind === "set" && instruction.set.classes.length)) unsupported("non-ASCII subject with locale character classes");
  interface State { program: number; position: number; captures: number[]; visited: number[] }
  work.allocate(parser.groups * 2 + 4);
  const stack: State[] = [{ program: 0, position: 0, captures: new Array<number>(parser.groups * 2).fill(-1), visited: [] }];
  work.state();
  let best: State | undefined;
  while (stack.length) {
    const state = stack.pop()!;
    while (true) {
      work.charge(state.visited.length + 1);
      if (state.visited.includes(state.program)) break;
      work.allocate(1); state.visited.push(state.program);
      const instruction = instructions[state.program]!;
      state.program++;
      if (instruction.kind === "accept") {
        if (!best || state.position > best.position) best = state;
        break;
      }
      if (instruction.kind === "split") {
        work.state(); work.allocate(state.captures.length + state.visited.length + 4);
        stack.push({ program: instruction.second, position: state.position, captures: [...state.captures], visited: [...state.visited] });
        state.program = instruction.first;
      } else if (instruction.kind === "jump") state.program = instruction.target;
      else if (instruction.kind === "save") state.captures[instruction.slot] = state.position;
      else if (instruction.kind === "start") { if (state.position !== 0) break; }
      else if (instruction.kind === "end") { if (state.position !== input.values.length) break; }
      else if (instruction.kind === "backref") {
        const start = state.captures[(instruction.group - 1) * 2]!, end = state.captures[(instruction.group - 1) * 2 + 1]!;
        if (start < 0 || end < start || end - start > input.values.length - state.position) break;
        work.charge(end - start);
        let equal = true;
        for (let offset = 0; offset < end - start; offset++) if (input.values[start + offset] !== input.values[state.position + offset]) { equal = false; break; }
        if (!equal) break;
        state.position += end - start;
        if (end > start) { work.allocate(1); state.visited = []; }
      } else {
        const value = input.values[state.position];
        if (value === undefined) break;
        if (instruction.kind === "literal" && value !== instruction.value) break;
        if (instruction.kind === "set") {
          work.charge(instruction.set.ranges.length + instruction.set.classes.length);
          const included = instruction.set.ranges.some(([start, end]) => value >= start && value <= end)
            || instruction.set.classes.some(name => member(value, name));
          if (included === instruction.set.negate) break;
        }
        work.allocate(1); state.position++; state.visited = [];
      }
    }
  }
  const captureStart = best?.captures[0] ?? -1, captureEnd = best?.captures[1] ?? -1;
  return {
    offsetUnit: "byte", matched: best !== undefined, hasCapture: parser.groups > 0,
    overall: best ? { start: 0, end: input.boundaries[best.position]! } : null,
    capture: captureStart < 0 || captureEnd < captureStart ? null : { start: input.boundaries[captureStart]!, end: input.boundaries[captureEnd]! },
    steps: work.steps,
  };
}
