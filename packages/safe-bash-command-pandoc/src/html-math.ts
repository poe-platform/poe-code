import type {AdapterContext} from "./types.js";

type Expression = {kind: string; text?: string; children?: Expression[]; sub?: Expression; sup?: Expression; style?: string};
type Token = {text: string; markup: boolean};
const greek: Record<string, string> = {
  alpha: "α", beta: "β", gamma: "γ", delta: "δ", epsilon: "ϵ", varepsilon: "ε", zeta: "ζ", eta: "η", theta: "θ", vartheta: "ϑ",
  iota: "ι", kappa: "κ", lambda: "λ", mu: "μ", nu: "ν", xi: "ξ", pi: "π", varpi: "ϖ", rho: "ρ", varrho: "ϱ",
  sigma: "σ", varsigma: "ς", tau: "τ", upsilon: "υ", phi: "ϕ", varphi: "φ", chi: "χ", psi: "ψ", omega: "ω",
  Gamma: "Γ", Delta: "Δ", Theta: "Θ", Lambda: "Λ", Xi: "Ξ", Pi: "Π", Sigma: "Σ", Upsilon: "Υ", Phi: "Φ", Psi: "Ψ", Omega: "Ω"
};
const symbols: Record<string, string> = {times: "×", cdot: "⋅", pm: "±", mp: "∓", div: "÷", le: "≤", leq: "≤", ge: "≥", geq: "≥", ne: "≠", neq: "≠", approx: "≈", equiv: "≡", in: "∈", notin: "∉", to: "→", rightarrow: "→", leftarrow: "←", infty: "∞", partial: "∂", nabla: "∇", ldots: "…", cdots: "⋯"};
const styles: Record<string, string> = {mathrm: "", mathbf: "strong", mathit: "em", mathtt: "code", mathsf: ""};
const operators = new Set(["sin", "cos", "tan", "cot", "sec", "csc", "sinh", "cosh", "tanh", "log", "ln", "exp", "lim", "max", "min", "det", "gcd"]);
const letter = (char: string) => char.length > 0 && char.toLowerCase() !== char.toUpperCase();
const digit = (char: string) => char >= "0" && char <= "9";
const unsupported = Symbol("unsupported math");

/** Pandoc's default HTML can represent simple TeX with inline elements. More
 * complex or unrecognized formulas keep their source rather than lose meaning. */
export function* htmlMath(source: string, inline: boolean, context: AdapterContext): Generator<Token> {
  let position = 0;
  const node = (kind: string, text?: string): Expression => {
    context.charge("references", 1); context.charge("retainedBytes", 64 + (text?.length ?? 0) * 2);
    return text === undefined ? {kind} : {kind, text};
  };
  const skip = () => {
    while (position < source.length) {
      context.checkpoint();
      const ch = source[position]!;
      if (" \r\n\t".includes(ch)) position++;
      else if (ch === "%") {while (position < source.length && source[position] !== "\n") {context.checkpoint(); position++;}}
      else break;
    }
  };
  const symbol = (text: string) => node("+−*×⋅±∓÷".includes(text) ? "bin" : "=<>≤≥≠≈≡∈∉→←".includes(text) ? "rel" : ",;".includes(text) ? "pun" : "symbol", text);
  function atom(depth: number): Expression {
    context.checkpoint(); context.bound("depth", depth);
    if (depth > 256) throw unsupported;
    skip();
    const ch = source[position++];
    if (ch === undefined) throw unsupported;
    if (ch === "{") {
      const result = node("group"); result.children = sequence(depth + 1);
      if (source[position++] !== "}") throw unsupported;
      return result;
    }
    if (ch === "\\") {
      const start = position;
      while (letter(source[position] ?? "")) {context.checkpoint(); position++;}
      if (position === start) {
        const escaped = source[position++];
        if (escaped === undefined) throw unsupported;
        const spaces: Record<string, string> = {",": "\u2006", ":": "\u2005", ";": "\u2004", "!": "", " ": "\u00a0"};
        if (Object.hasOwn(spaces, escaped)) return node("space", spaces[escaped]!);
        if ("{}_$%&#|".includes(escaped)) return symbol(escaped);
        throw unsupported;
      }
      const command = source.slice(start, position); skip();
      if (command === "left") {
        const opening = source[position++];
        if (!opening || !"([|.".includes(opening)) throw unsupported;
        const result = node("group"); result.children = [node("symbol", opening === "." ? "" : opening), ...sequence(depth + 1, true)];
        if (!source.startsWith("\\right", position)) throw unsupported;
        position += 6; skip(); const closing = source[position++];
        if (!closing || !")]|.".includes(closing)) throw unsupported;
        result.children.push(node("symbol", closing === "." ? "" : closing)); return result;
      }
      if (Object.hasOwn(greek, command)) return node("identifier", greek[command]!);
      if (Object.hasOwn(symbols, command)) return symbol(symbols[command]!);
      if (operators.has(command)) return node("operator", command);
      if (command === "quad" || command === "qquad") return node("space", "\u200a" + "\u2001".repeat(command === "quad" ? 1 : 2));
      if (Object.hasOwn(styles, command)) {
        const result = node("group"); result.style = styles[command]!; result.children = [atom(depth + 1)]; return result;
      }
      if (command === "text" || command === "operatorname") {
        if (source[position++] !== "{") throw unsupported;
        let text = "";
        while (position < source.length && source[position] !== "}") {
          context.checkpoint(); let c = source[position++]!;
          if (c === "{") throw unsupported;
          if (c === "\\") {c = source[position++] ?? ""; if (!c || !"{}_$%&# ".includes(c)) throw unsupported;}
          context.charge("retainedBytes", c.length * 2); text += c;
        }
        if (source[position++] !== "}") throw unsupported;
        return node(command === "text" ? "text" : "operator", text);
      }
      throw unsupported;
    }
    if (letter(ch)) return node("identifier", ch);
    if (digit(ch) || ch === ".") {
      const start = position - 1;
      while (digit(source[position] ?? "") || source[position] === ".") {context.checkpoint(); position++;}
      return node("number", source.slice(start, position));
    }
    if (ch === "~") return node("space", "\u00a0");
    if ("+-*=<>(),;:/!?[]|".includes(ch)) return "([".includes(ch) ? node("open", ch) : symbol(ch === "-" ? "−" : ch);
    throw unsupported;
  }
  function sequence(depth: number, delimited = false): Expression[] {
    const result: Expression[] = []; skip();
    while (position < source.length && source[position] !== "}") {
      if (delimited && source.startsWith("\\right", position)) break;
      const value = atom(depth); skip();
      if (value.kind === "bin" && (!result.length || ["bin", "rel", "pun", "open"].includes(result[result.length - 1]!.kind))) value.kind = "symbol";
      while (source[position] === "_" || source[position] === "^") {
        const key = source[position++] === "_" ? "sub" : "sup";
        if (value[key]) throw unsupported;
        value[key] = atom(depth + 1); skip();
      }
      context.charge("references", 1); result.push(value);
    }
    return result;
  }
  let expressions: Expression[];
  try {
    expressions = sequence(1);
    if (position !== source.length) throw unsupported;
  } catch (error) {
    if (error !== unsupported) throw error;
    context.report({code: "W_PRESENTATION_LOSS", operation: context.operation ?? "write", format: "html5", message: "Could not convert TeX math, rendering as TeX"});
    yield {text: inline ? "$" : "$$", markup: false}; yield {text: source, markup: false}; yield {text: inline ? "$" : "$$", markup: false};
    return;
  }
  function* render(values: Expression[], style?: string): Generator<Token> {
    for (const [index, value] of values.entries()) {
      context.checkpoint();
      const next = values[index + 1], spaced = next && next.kind !== "space" && next.kind !== "pun" && !value.sub && !value.sup;
      const space = spaced ? value.kind === "bin" ? "\u2005" : value.kind === "rel" ? "\u2004" : "" : "";
      if (space) yield {text: space, markup: false};
      if (value.children) yield* render(value.children, value.style ?? style);
      else {
        const tag = value.kind === "text" || value.kind === "space" ? "" : style ?? (value.kind === "identifier" ? "em" : "");
        if (tag) yield {text: `<${tag}>`, markup: true};
        yield {text: value.text ?? "", markup: false};
        if (tag) yield {text: `</${tag}>`, markup: true};
      }
      for (const key of ["sub", "sup"] as const) if (value[key]) {
        yield {text: `<${key}>`, markup: true}; yield* render([value[key]], style); yield {text: `</${key}>`, markup: true};
      }
      if (space) yield {text: space, markup: false};
      if (value.kind === "operator" || (spaced && value.kind === "pun")) yield {text: "\u2006", markup: false};
    }
  }
  yield* render(expressions);
}
