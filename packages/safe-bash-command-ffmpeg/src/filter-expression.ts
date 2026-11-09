export function parseFilterExpression(expression: string, filter: string, variables: Record<string, number>, sampleValue?: (channel: number) => number): number {
  let offset = 0;
  const source = expression.trim();
  function parse(minPrecedence = 0, depth = 0): number {
    if (depth > 64) throw new Error(`${filter}: expression is too deeply nested`);
    while (source[offset] === " ") offset++;
    let value: number;
    let sign = 1;
    if (source[offset] === "+" || source[offset] === "-") {
      sign = source[offset++] === "-" ? -1 : 1;
      while (source[offset] === " ") offset++;
    }
    const first = source[offset];
    if (first === "+" || first === "-") {
      offset++;
      value = parse(3, depth + 1) * (first === "-" ? -1 : 1);
    } else if (first === "(") {
      offset++;
      value = parse(0, depth + 1);
      if (source[offset++] !== ")") throw new Error(`${filter}: invalid expression`);
    } else if (first && ((first >= "a" && first <= "z") || (first >= "A" && first <= "Z") || first === "_")) {
      const start = offset++;
      while (offset < source.length) {
        const c = source[offset]!;
        if ((c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || (c >= "0" && c <= "9") || c === "_") offset++;
        else break;
      }
      const name = source.slice(start, offset);
      while (source[offset] === " ") offset++;
      if (source[offset] === "(") {
        offset++;
        const args = [parse(0, depth + 1)];
        while (source[offset] === ",") {
          offset++;
          args.push(parse(0, depth + 1));
        }
        if (source[offset++] !== ")" || args.some(arg => !Number.isFinite(arg) && filter !== "volume" && !((filter === "select" || filter === "crop" || filter === "pad" || filter === "scale" || filter === "drawbox") && Number.isNaN(arg)))) {
          throw new Error(`${filter}: invalid expression`);
        }
        if (name === "val" && args.length === 1 && sampleValue) value = sampleValue(args[0]!);
        else if (filter === "rotate" && args.length === 1 && (name === "rotw" || name === "roth")) {
          const sin = Math.abs(Math.sin(args[0]!));
          const cos = Math.abs(Math.cos(args[0]!));
          value = name === "rotw" ? variables.iw! * cos + variables.ih! * sin : variables.iw! * sin + variables.ih! * cos;
        }
        else if (name === "isnan" && args.length === 1) value = Number(Number.isNaN(args[0]));
        else if (name === "not" && args.length === 1) value = Number(args[0] === 0);
        else if (name === "eq" && args.length === 2) value = Number(args[0] === args[1]);
        else if (name === "gte" && args.length === 2) value = Number(args[0]! >= args[1]!);
        else if (name === "lte" && args.length === 2) value = Number(args[0]! <= args[1]!);
        else if (name === "lt" && args.length === 2) value = Number(args[0]! < args[1]!);
        else if (name === "if" && args.length === 3) value = args[0] !== 0 ? args[1]! : args[2]!;
        else if (name === "gt" && args.length === 2) value = Number(args[0]! > args[1]!);
        else if (name === "mod" && args.length === 2) value = args[0]! - Math.floor(args[0]! / args[1]!) * args[1]!;
        else if (name === "min" && args.length === 2) value = Math.min(args[0]!, args[1]!);
        else if (name === "max" && args.length === 2) value = Math.max(args[0]!, args[1]!);
        else if (name === "clip" && args.length === 3) value = args[1]! > args[2]! ? NaN : Math.max(args[1]!, Math.min(args[2]!, args[0]!));
        else if (name === "lerp" && args.length === 3) value = args[0]! + (args[1]! - args[0]!) * args[2]!;
        else if (name === "between" && args.length === 3) value = Number(args[0]! >= args[1]! && args[0]! <= args[2]!);
        else throw new Error(`${filter}: invalid or unsupported expression`);
      } else {
        if (!Object.hasOwn(variables, name)) throw new Error(`${filter}: invalid or unsupported expression`);
        value = variables[name]!;
      }
    } else {
      const start = offset;
      while (offset < source.length) {
        const c = source[offset]!;
        if ((c >= "0" && c <= "9") || c === ".") offset++;
        else break;
      }
      if (start === offset) throw new Error(`${filter}: invalid or unsupported expression`);
      if (source[offset] === "e" || source[offset] === "E") {
        let end = offset + 1;
        if (source[end] === "+" || source[end] === "-") end++;
        const digits = end;
        while (source[end] && source[end]! >= "0" && source[end]! <= "9") end++;
        if (end > digits) offset = end;
      }
      value = sign * Number(source.slice(start, offset));
      sign = 1;
      if (Number.isNaN(value)) throw new Error(`${filter}: invalid or unsupported expression`);
      // The dB suffix belongs to the signed numeric literal, not the expression.
      if (source.startsWith("dB", offset)) {
        value = 10 ** (value / 20);
        offset += 2;
      } else {
        const exponents: Record<string, number> = { y: -24, z: -21, a: -18, f: -15, p: -12, n: -9, u: -6, m: -3, c: -2, d: -1, h: 2, k: 3, K: 3, M: 6, G: 9, T: 12, P: 15, E: 18, Z: 21, Y: 24 };
        const exponent = exponents[source[offset]!];
        if (exponent !== undefined) {
          offset++;
          if (source[offset] === "i") {
            value *= 2 ** (exponent / 0.3);
            offset++;
          } else value *= 10 ** exponent;
        }
        if (source[offset] === "B") {
          value *= 8;
          offset++;
        }
      }
    }
    value *= sign;
    for (;;) {
      while (source[offset] === " ") offset++;
      const operator = source[offset];
      const precedence = operator === "+" || operator === "-" ? 1 : operator === "*" || operator === "/" ? 2 : 0;
      if (precedence === 0 || precedence < minPrecedence) break;
      offset++;
      const right = parse(precedence + 1, depth + 1);
      if (operator === "+") value += right;
      else if (operator === "-") value -= right;
      else if (operator === "*") value *= right;
      else value /= right;
    }
    return value;
  }
  const angle = parse();
  if (offset !== source.length || (!Number.isFinite(angle) && filter !== "volume" && !((filter === "select" || filter === "crop" || filter === "pad" || filter === "scale" || filter === "drawbox") && Number.isNaN(angle)))) throw new Error(`${filter}: invalid or unsupported expression`);
  return angle;
}
