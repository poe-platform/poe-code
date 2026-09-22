import { SsconvertError } from "../../contracts.js";
import type { CellValue } from "../../workbook.js";
import { boundedText, textArg } from "./common.js";
import type { FunctionHost, Value } from "./types.js";

type Flags = { insensitive: boolean; multiline: boolean; dotall: boolean; extended: boolean };
type Node = { kind: "char"; test: (byte: number) => boolean }
  | { kind: "anchor"; test: (source: string, position: number) => boolean }
  | { kind: "sequence"; nodes: Node[] }
  | { kind: "alternative"; nodes: Node[] }
  | { kind: "repeat"; node: Node; min: number; max: number; lazy: boolean }
  | { kind: "capture"; node: Node; index: number }
  | { kind: "atomic"; node: Node }
  | { kind: "reference"; indices: number[]; insensitive: boolean }
  | { kind: "behind"; node: Node; negative: boolean; min: number; max: number }
  | { kind: "assert"; node: Node; negative: boolean };
const unsupported = (feature = "pattern syntax or diagnostic"): never => { throw new SsconvertError("unsupported-feature", `Unsupported ssconvert feature: PERL_SED ${feature}`); };
const word = (byte: number) => byte >= 48 && byte <= 57 || byte >= 65 && byte <= 90 || byte >= 97 && byte <= 122 || byte === 95;
const fold = (byte: number) => byte >= 65 && byte <= 90 ? byte + 32 : byte;

/** A byte grammar and step-accounted ordered matcher. No guest pattern is
 * compiled by JavaScript or passed to a native runtime. */
function compile(pattern: string, host: FunctionHost): Node {
  let at = 0, depth = 0, nodes = 0, captures = 0;
  const references: number[] = [];
  const names = new Map<string, number[]>(), namedReferences: { name: string; indices: number[] }[] = [];
  const flags: Flags = { insensitive: false, multiline: false, dotall: false, extended: false };
  const node = <T extends Node>(value: T): T => {
    host.tick();
    if (++nodes > (host.context.limits.workbookNodes ?? host.context.limits.inputBytes))
      throw new SsconvertError("resource-limit", "ssconvert PERL_SED pattern node limit exceeded");
    return value;
  };
  const literal = (byte: number, mode: Flags) => node({ kind: "char", test: (input: number) => mode.insensitive ? fold(input) === fold(byte) : input === byte } as const);
  const identifier = (closing: string) => {
    let name = "";
    while (at < pattern.length && pattern[at] !== closing) {
      host.tick(); const byte = pattern.charCodeAt(at++);
      if (!word(byte) || !name && byte >= 48 && byte <= 57) return unsupported();
      name += String.fromCharCode(byte);
    }
    if (!name || pattern[at++] !== closing) return unsupported();
    return name;
  };
  const namedReference = (name: string, mode: Flags) => {
    const indices: number[] = []; namedReferences.push({ name, indices });
    return node({ kind: "reference", indices, insensitive: mode.insensitive } as const);
  };
  const ignore = (mode: Flags) => {
    if (!mode.extended) return;
    while (at < pattern.length) {
      host.tick();
      const byte = pattern.charCodeAt(at);
      if (" \t\r\n\f".includes(pattern[at]!)) at++;
      else if (byte === 35) { while (at < pattern.length && pattern[at] !== "\n") { host.tick(); at++; } }
      else break;
    }
  };
  function escaped(mode: Flags, inClass = false): Node {
    host.tick();
    const char = pattern[at++]; if (char === undefined) return unsupported();
    if (!inClass && char === "k") {
      const opening = pattern[at++], closing = opening === "<" ? ">" : opening === "{" ? "}" : opening === "'" ? "'" : undefined;
      if (closing === undefined) return unsupported();
      return namedReference(identifier(closing), mode);
    }
    if (!inClass && (char >= "1" && char <= "9" || char === "g")) {
      let index: number;
      if (char === "g") {
        if (pattern[at++] !== "{") return unsupported();
        if (pattern[at] !== "-" && !(pattern[at]! >= "0" && pattern[at]! <= "9")) return namedReference(identifier("}"), mode);
        const relative = pattern[at] === "-"; if (relative) at++;
        const number = integer();
        if (!number || pattern[at++] !== "}") return unsupported();
        index = relative ? captures - number + 1 : number;
      } else {
        index = Number(char);
        if (pattern[at] !== undefined && pattern[at]! >= "0" && pattern[at]! <= "9") return unsupported();
      }
      if (index < 1) return unsupported();
      references.push(index);
      return node({ kind: "reference", indices: [index], insensitive: mode.insensitive });
    }
    const common = "nrtfae", values = [10, 13, 9, 12, 7, 27];
    const index = common.indexOf(char); if (index >= 0) return literal(values[index]!, mode);
    if (char === "b" && inClass) return literal(8, mode);
    if ("dDsSwW".includes(char)) {
      const kind = char.toLowerCase(), inverse = char !== kind;
      return node({ kind: "char", test: (byte: number) => {
        const matched = kind === "d" ? byte >= 48 && byte <= 57 : kind === "w" ? word(byte) : byte === 32 || byte >= 9 && byte <= 13;
        return inverse ? !matched : matched;
      } });
    }
    if (!inClass && "bBAzZ".includes(char)) return node({ kind: "anchor", test: (source: string, position: number) => {
      if (char === "A") return position === 0;
      if (char === "z") return position === source.length;
      if (char === "Z") return position === source.length || position === source.length - 1 && source[position] === "\n";
      const boundary = word(source.charCodeAt(position - 1)) !== word(source.charCodeAt(position));
      return char === "b" ? boundary : !boundary;
    } });
    if (char === "x") {
      let digits = "";
      if (pattern[at] === "{") {
        at++;
        while (at < pattern.length && pattern[at] !== "}") { host.tick(); digits += pattern[at++]; }
        if (pattern[at++] !== "}") return unsupported();
      } else { digits = pattern.slice(at, at + 2); at += 2; }
      if (!digits || [...digits].some(value => !"0123456789abcdefABCDEF".includes(value))) return unsupported();
      const byte = Number.parseInt(digits, 16); if (byte > 255) return unsupported(); return literal(byte, mode);
    }
    if (char === "c") {
      const next = pattern[at++]; if (next === undefined || next.charCodeAt(0) > 127) return unsupported();
      return literal(next.toUpperCase().charCodeAt(0) ^ 64, mode);
    }
    if (char >= "0" && char <= "9" || char >= "a" && char <= "z" || char >= "A" && char <= "Z") return unsupported();
    return literal(char.charCodeAt(0), mode);
  }
  function characterClass(mode: Flags): Node {
    const inverse = pattern[at] === "^"; if (inverse) at++;
    const tests: Node[] = []; let first = true;
    const take = (): Node => {
      if (pattern[at] === "[" && pattern[at + 1] === ":") {
        at += 2; const negated = pattern[at] === "^"; if (negated) at++;
        let name = "";
        while (at < pattern.length && pattern[at] !== ":") { host.tick(); name += pattern[at++]; }
        if (pattern[at++] !== ":" || pattern[at++] !== "]") return unsupported();
        if (!["alnum", "alpha", "ascii", "blank", "cntrl", "digit", "graph", "lower", "print", "punct", "space", "upper", "word", "xdigit"].includes(name)) return unsupported();
        return node({ kind: "char", test: (byte: number) => {
          const digit = byte >= 48 && byte <= 57, lower = byte >= 97 && byte <= 122, upper = byte >= 65 && byte <= 90;
          const letter = lower || upper;
          const predicates: Record<string, boolean> = {
            alnum: letter || digit, alpha: letter, ascii: byte <= 127,
            blank: byte === 9 || byte === 32, cntrl: byte < 32 || byte === 127,
            digit, graph: byte >= 33 && byte <= 126,
            lower: lower || mode.insensitive && upper, print: byte >= 32 && byte <= 126,
            punct: byte >= 33 && byte <= 126 && !letter && !digit,
            space: byte === 32 || byte >= 9 && byte <= 13,
            upper: upper || mode.insensitive && lower, word: word(byte),
            xdigit: digit || byte >= 65 && byte <= 70 || byte >= 97 && byte <= 102
          };
          return negated ? !predicates[name] : predicates[name]!;
        } });
      }
      if (pattern[at] === "[" && (pattern[at + 1] === "." || pattern[at + 1] === "=")) return unsupported();
      return pattern[at] === "\\" ? (at++, escaped(mode, true)) : literal(pattern.charCodeAt(at++), mode);
    };
    while (at < pattern.length && (first || pattern[at] !== "]")) {
      host.tick(); first = false;
      const start = at, left = take();
      if (pattern[at] === "-" && pattern[at + 1] !== "]" && at + 1 < pattern.length) {
        at++; const end = at, right = take();
        if (at - end !== 1 || end - start !== 2 || left.kind !== "char" || right.kind !== "char") return unsupported();
        const low = pattern.charCodeAt(start), high = pattern.charCodeAt(end); if (low > high) return unsupported();
        tests.push(node({ kind: "char", test: (byte: number) => byte >= low && byte <= high || mode.insensitive && fold(byte) >= fold(low) && fold(byte) <= fold(high) }));
      } else tests.push(left);
    }
    if (!tests.length || pattern[at++] !== "]") return unsupported();
    return node({ kind: "char", test: (byte: number) => {
      const matched = tests.some(test => { host.tick(); return test.kind === "char" && test.test(byte); }); return inverse ? !matched : matched;
    } });
  }
  function group(mode: Flags): Node {
    if (++depth > 64) throw new SsconvertError("resource-limit", "ssconvert PERL_SED pattern depth limit exceeded");
    let assertion: boolean | undefined;
    let behind = false;
    let atomic = false;
    let capture = pattern[at] === "?" ? undefined : ++captures;
    if (pattern[at] === "?") {
      at++;
      if (pattern[at] === ":") at++;
      else if (pattern[at] === ">") { at++; atomic = true; }
      else if (pattern[at] === "=" || pattern[at] === "!") assertion = pattern[at++] === "!";
      else if (pattern[at] === "<" && (pattern[at + 1] === "=" || pattern[at + 1] === "!")) {
        at++; assertion = pattern[at++] === "!"; behind = true;
      }
      else if (pattern[at] === "<" || pattern[at] === "'" || pattern[at] === "P" && pattern[at + 1] === "<") {
        if (pattern[at] === "P") at++;
        const closing = pattern[at++] === "<" ? ">" : "'", name = identifier(closing);
        capture = ++captures;
        const indices = names.get(name) ?? []; indices.push(capture); names.set(name, indices);
      }
      else if (pattern[at] === "P" && pattern[at + 1] === "=") {
        at += 2; const name = identifier(")"); depth--;
        return namedReference(name, mode);
      }
      else {
        let disabled = false, found = false;
        while (at < pattern.length && "imsxad-".includes(pattern[at]!)) {
          host.tick(); const flag = pattern[at++];
          if (flag === "-") { if (disabled) return unsupported(); disabled = true; continue; }
          found = true;
          if (flag === "i") mode.insensitive = !disabled;
          if (flag === "m") mode.multiline = !disabled;
          if (flag === "s") mode.dotall = !disabled;
          if (flag === "x") mode.extended = !disabled;
        }
        if (!found) return unsupported();
        if (pattern[at] === ")") { at++; depth--; return node({ kind: "sequence", nodes: [] }); }
        if (pattern[at++] !== ":") return unsupported();
      }
    }
    const inner = alternative(mode); if (pattern[at++] !== ")") return unsupported(); depth--;
    if (atomic) return node({ kind: "atomic", node: inner });
    if (assertion !== undefined) return behind
      ? node({ kind: "behind", node: inner, negative: assertion, ...widthRange(inner) })
      : node({ kind: "assert", node: inner, negative: assertion });
    return capture === undefined ? inner : node({ kind: "capture", node: inner, index: capture });
  }
  function widthRange(value: Node): { min: number; max: number } {
    host.tick(); let min: number, max: number;
    if (value.kind === "char") min = max = 1;
    else if (value.kind === "anchor" || value.kind === "assert" || value.kind === "behind") min = max = 0;
    else if (value.kind === "reference") return unsupported();
    else if (value.kind === "capture" || value.kind === "atomic") return widthRange(value.node);
    else if (value.kind === "repeat") {
      const width = widthRange(value.node);
      min = width.min * value.min; max = width.max * value.max;
    } else if (value.kind === "sequence") {
      min = max = 0;
      for (const child of value.nodes) { const width = widthRange(child); min += width.min; max += width.max; }
    } else {
      min = Infinity; max = 0;
      for (const child of value.nodes) { const width = widthRange(child); min = Math.min(min, width.min); max = Math.max(max, width.max); }
    }
    if (!Number.isFinite(max) || max > 255) return unsupported();
    return { min, max };
  }
  function integer(): number {
    let value = 0, count = 0;
    while (at < pattern.length && pattern[at]! >= "0" && pattern[at]! <= "9") {
      host.tick(); count++; value = value * 10 + pattern.charCodeAt(at++) - 48;
      if (!Number.isSafeInteger(value)) throw new SsconvertError("resource-limit", "ssconvert PERL_SED repetition limit exceeded");
    }
    if (!count) return unsupported(); return value;
  }
  function sequence(mode: Flags): Node {
    const result: Node[] = [];
    while (at < pattern.length) {
      ignore(mode); if (at === pattern.length || pattern[at] === "|" || pattern[at] === ")") break;
      host.tick(); const char = pattern[at++]; let value: Node;
      if (char === "\\") value = escaped({ ...mode });
      else if (char === "[") value = characterClass({ ...mode });
      else if (char === "(") {
        // Bare flag groups change the enclosing scope; scoped groups inherit a copy.
        let end = at + 1;
        if (pattern[at] === "?") while (end < pattern.length && "imsxad-".includes(pattern[end]!)) { host.tick(); end++; }
        const bare = pattern[at] === "?" && end > at + 1 && pattern[end] === ")";
        value = group(bare ? mode : { ...mode });
      } else if (char === ".") { const dotall = mode.dotall; value = node({ kind: "char", test: (byte: number) => dotall || byte !== 10 }); }
      else if (char === "^" || char === "$") {
        const multiline = mode.multiline;
        value = node({ kind: "anchor", test: (source: string, position: number) => char === "^"
          ? position === 0 || multiline && source[position - 1] === "\n"
          : position === source.length || source[position] === "\n" && (multiline || position === source.length - 1) });
      } else if (char === "*" || char === "+" || char === "?" || char === "{") return unsupported();
      else value = literal(char!.charCodeAt(0), { ...mode });
      ignore(mode);
      let min: number | undefined, max = Infinity;
      if (pattern[at] === "*") { at++; min = 0; }
      else if (pattern[at] === "+") { at++; min = 1; }
      else if (pattern[at] === "?") { at++; min = 0; max = 1; }
      else if (pattern[at] === "{") {
        at++; min = integer(); max = min;
        if (pattern[at] === ",") { at++; max = pattern[at] === "}" ? Infinity : integer(); }
        if (pattern[at++] !== "}" || max < min) return unsupported();
      }
      if (min !== undefined) {
        const lazy = pattern[at] === "?"; if (lazy) at++;
        const possessive = !lazy && pattern[at] === "+"; if (possessive) at++;
        value = node({ kind: "repeat", node: value, min, max, lazy });
        if (possessive) value = node({ kind: "atomic", node: value });
      }
      result.push(value);
    }
    return node({ kind: "sequence", nodes: result });
  }
  function alternative(mode: Flags): Node {
    const result = [sequence(mode)];
    while (pattern[at] === "|") { at++; result.push(sequence(mode)); }
    return result.length === 1 ? result[0]! : node({ kind: "alternative", nodes: result });
  }
  const result = alternative(flags); if (at !== pattern.length) return unsupported();
  for (const index of references) { host.tick(); if (index > captures) return unsupported(); }
  for (const reference of namedReferences) {
    host.tick(); const indices = names.get(reference.name); if (indices === undefined) return unsupported();
    for (const index of indices) { host.tick(); reference.indices.push(index); }
  }
  return result;
}

type MatchState = { position: number; captures: readonly (readonly [number, number] | undefined)[] };

function* match(node: Node, source: string, state: MatchState, host: FunctionHost): Generator<MatchState> {
  host.tick(); const position = state.position;
  if (node.kind === "char") { if (position < source.length && node.test(source.charCodeAt(position))) yield { ...state, position: position + 1 }; }
  else if (node.kind === "anchor") { if (node.test(source, position)) yield state; }
  else if (node.kind === "reference") {
    let captured: readonly [number, number] | undefined;
    for (const index of node.indices) { host.tick(); captured = state.captures[index]; if (captured !== undefined) break; }
    if (captured === undefined) return;
    const length = captured[1] - captured[0]; if (length > source.length - position) return;
    for (let offset = 0; offset < length; offset++) {
      host.tick(); const left = source.charCodeAt(captured[0] + offset), right = source.charCodeAt(position + offset);
      if (node.insensitive ? fold(left) !== fold(right) : left !== right) return;
    }
    yield { ...state, position: position + length };
  } else if (node.kind === "capture") {
    for (const result of match(node.node, source, state, host)) {
      const captures: (readonly [number, number] | undefined)[] = [];
      for (const capture of result.captures) { host.tick(); captures.push(capture); }
      captures[node.index] = [position, result.position];
      yield { ...result, captures };
    }
  } else if (node.kind === "atomic") {
    const inner = match(node.node, source, state, host), result = inner.next(); inner.return(undefined);
    if (!result.done) yield result.value;
  } else if (node.kind === "assert") {
    const inner = match(node.node, source, state, host), result = inner.next(); inner.return(undefined);
    if (result.done) { if (node.negative) yield state; }
    else if (!node.negative) yield { ...result.value, position };
  } else if (node.kind === "behind") {
    let result: MatchState | undefined;
    for (let width = Math.min(position, node.max); width >= node.min; width--) {
      host.tick();
      // The qualified Perl 5.34 experimental profile tries longest starts
      // first without constraining the inner match's end to this position.
      // Captures can therefore extend into the forward source.
      const inner = match(node.node, source, { ...state, position: position - width }, host);
      const first = inner.next(); inner.return(undefined);
      if (!first.done) { result = first.value; break; }
    }
    if (result === undefined) { if (node.negative) yield state; }
    else if (!node.negative) yield { ...result, position };
  } else if (node.kind === "alternative") { for (const child of node.nodes) yield* match(child, source, state, host); }
  else if (node.kind === "sequence") {
    const stack: { index: number; iterator: Generator<MatchState> }[] = [];
    if (!node.nodes.length) { yield state; return; }
    stack.push({ index: 0, iterator: match(node.nodes[0]!, source, state, host) });
    while (stack.length) {
      host.tick(); const top = stack[stack.length - 1]!, step = top.iterator.next();
      if (step.done) stack.pop();
      else if (top.index === node.nodes.length - 1) yield step.value;
      else stack.push({ index: top.index + 1, iterator: match(node.nodes[top.index + 1]!, source, step.value, host) });
    }
  } else {
    if (node.min === 0) {
      const nested: Node[] = [node.node], cleared = new Set<number>();
      while (nested.length) {
        host.tick(); const child = nested.pop()!;
        if (child.kind === "capture") cleared.add(child.index);
        if (child.kind === "capture" || child.kind === "atomic" || child.kind === "repeat" || child.kind === "assert" || child.kind === "behind") nested.push(child.node);
        else if (child.kind === "sequence" || child.kind === "alternative") for (const descendant of child.nodes) { host.tick(); nested.push(descendant); }
      }
      if (cleared.size) {
        const captures: (readonly [number, number] | undefined)[] = [];
        for (let index = 0; index < state.captures.length; index++) { host.tick(); captures.push(cleared.has(index) ? undefined : state.captures[index]); }
        state = { ...state, captures };
      }
    }
    type Frame = { state: MatchState; count: number; iterator?: Generator<MatchState>; emitted: boolean; stopped: boolean };
    const stack: Frame[] = [{ state, count: 0, emitted: false, stopped: false }];
    while (stack.length) {
      host.tick(); const top = stack[stack.length - 1]!;
      if (node.lazy && !top.emitted) { top.emitted = true; if (top.count >= node.min) yield top.state; }
      if (!top.stopped && top.count < node.max) {
        top.iterator ??= match(node.node, source, top.state, host);
        const step = top.iterator.next();
        if (!step.done) {
          if (stack.length >= host.context.limits.inputBytes) throw new SsconvertError("resource-limit", "ssconvert PERL_SED match state limit exceeded");
          stack.push({ state: step.value, count: top.count + 1, emitted: false,
            stopped: step.value.position === top.state.position && top.count + 1 >= node.min });
          continue;
        }
      }
      stack.pop(); if (!node.lazy && top.count >= node.min) yield top.state;
    }
  }
}

export function perlSed(args: readonly (Value | undefined)[], host: FunctionHost): CellValue {
  const inputs = args.map((_value, index) => textArg(args, index, host).split("\0", 1)[0]!);
  let inputSize = 0;
  for (const text of inputs) for (const char of text) {
    host.tick(); const code = char.codePointAt(0)!;
    if (code >= 0xd800 && code <= 0xdfff) return unsupported();
    inputSize += code < 128 ? 1 : code < 2048 ? 2 : code < 65536 ? 3 : 4;
    if (inputSize > host.context.limits.inputBytes) throw new SsconvertError("resource-limit", "ssconvert PERL_SED input byte limit exceeded");
  }
  const raw = inputs.map(text => {
    const bytes = new TextEncoder().encode(text), output: string[] = [];
    for (const byte of bytes) { host.tick(); output.push(String.fromCharCode(byte)); }
    return output.join("");
  });
  const source = raw[0]!, pattern = compile(raw[1]!, host), replacement = raw[2]!, output: string[] = [];
  let position = 0, published = 0, emptyAt = -1, outputSize = 0;
  const emit = (text: string) => {
    if (text.length > host.context.limits.outputBytes - outputSize) throw new SsconvertError("resource-limit", "ssconvert calculation text limit exceeded");
    outputSize += text.length; output.push(text);
  };
  while (position <= source.length) {
    host.tick(); const iterator = match(pattern, source, { position, captures: [] }, host); let end: number | undefined;
    for (const candidate of iterator) {
      if (candidate.position === position && position === emptyAt) continue;
      end = candidate.position; break;
    }
    if (end === undefined) { position++; continue; }
    emit(source.slice(published, position)); emit(replacement); published = end;
    emptyAt = end === position ? position : -1; position = end;
  }
  emit(source.slice(published));
  const bytes = Uint8Array.from(output.join(""), char => char.charCodeAt(0));
  const zero = bytes.indexOf(0), visible = zero < 0 ? bytes : bytes.subarray(0, zero);
  try { return boundedText(new TextDecoder("UTF-8", { fatal: true }).decode(visible), host); }
  catch (error) { if (error instanceof SsconvertError) throw error; return unsupported("byte result representation"); }
}
