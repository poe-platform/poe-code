export function parseFilterExpression(expression: string, filter: string, variables: Record<string, number>, sampleValue?: (channel: number) => number, registers?: Float64Array, randomStates?: BigUint64Array[], print?: (value: number, level: number) => void): number {
  let offset = 0;
  // FFmpeg removes ASCII whitespace before tokenizing, including inside tokens.
  let source = "";
  for (const character of expression) {
    if (character !== " " && !(character >= "\t" && character <= "\r")) source += character;
  }
  function parse(minPrecedence = 0, depth = 0, evaluate = true): number {
    if (depth > 64) throw new Error(`${filter}: expression is too deeply nested`);
    let value: number;
    let sign = 1;
    if (source[offset] === "+" || source[offset] === "-") {
      sign = source[offset++] === "-" ? -1 : 1;
    }
    const first = source[offset];
    if (first === "+" || first === "-") {
      offset++;
      if (source[offset] === "+" || source[offset] === "-") throw new Error(`${filter}: invalid expression`);
      value = parse(3, depth + 1, evaluate) * (first === "-" ? -1 : 1);
    } else if (first === "(") {
      offset++;
      value = parse(0, depth + 1, evaluate);
      if (source[offset++] !== ")") throw new Error(`${filter}: invalid expression`);
    } else if (first && ((first >= "a" && first <= "z") || (first >= "A" && first <= "Z") || first === "_")) {
      const start = offset++;
      while (offset < source.length) {
        const c = source[offset]!;
        if ((c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || (c >= "0" && c <= "9") || c === "_") offset++;
        else break;
      }
      const name = source.slice(start, offset);
      if (source[offset] === "(") {
        // Numeric AVOption constants shadow min/max functions, unlike timeline expressions.
        if (((filter === "aloop" && Object.hasOwn(variables, name)) || filter === "atrim" || filter === "tremolo" || filter === "stereowiden" || filter === "format_version") && (name === "min" || name === "max")) {
          throw new Error(`${filter}: invalid expression`);
        }
        offset++;
        const coefficientStart = offset;
        const args = [parse(0, depth + 1, evaluate && name !== "taylor")];
        while (source[offset] === ",") {
          offset++;
          // Validate both branches, but only evaluate the selected branch.
          const selected = name === "if" ? args[0] !== 0 : args[0] === 0;
          const evaluateArgument = evaluate && (!(name === "if" || name === "ifnot")
            || (args.length === 1 ? selected : !selected));
          args.push(parse(0, depth + 1, evaluateArgument));
        }
        if (source[offset++] !== ")" || args.some(arg => !Number.isFinite(arg) && !((filter === "astats" || filter === "chorus" || filter === "fps: frame rate" || filter === "tremolo" || filter === "crop" || filter === "silenceremove" || filter === "silencedetect" || filter === "afade: silence" || filter === "afade: unity" || filter === "format_version") && Math.abs(arg) === Infinity) && filter !== "asendcmd" && filter !== "asetpts" && filter !== "volume" && filter !== "atrim" && filter !== "aeval" && filter !== "tblend" && filter !== "aselect" && filter !== "ametadata expr" && filter !== "asetnsamples enable" && filter !== "tmix enable" && filter !== "deband enable" && filter !== "unsharp enable" && filter !== "colorcontrast enable" && filter !== "framestep enable" && filter !== "thumbnail enable" && filter !== "metadata enable" && filter !== "negate enable" && filter !== "hflip enable" && filter !== "vflip enable" && filter !== "aemphasis enable" && filter !== "adelay enable" && filter !== "compensationdelay enable" && filter !== "afade enable" && filter !== "stereotools enable" && filter !== "silenceremove enable" && filter !== "vibrato enable" && filter !== "tremolo enable" && filter !== "acrusher enable" && filter !== "highpass enable" && filter !== "lowpass enable" && filter !== "drawbox enable" && filter !== "gradfun enable" && !((filter === "setpts" || filter === "select" || filter === "crop" || filter === "pad" || filter === "scale" || filter === "drawbox" || filter === "drawbox enable") && Number.isNaN(arg)))) {
          throw new Error(`${filter}: invalid expression`);
        }
        if (name === "val" && args.length === 1 && sampleValue) value = evaluate ? sampleValue(args[0]!) : 0;
        else if (registers && ((name === "st" && args.length === 2) || (name === "ld" && args.length === 1))) {
          const index = Math.max(0, Math.min(9, Math.trunc(args[0]!) || 0));
          if (name === "st" && evaluate) {
            registers[index] = args[1]!;
            if (randomStates) delete randomStates[index];
          }
          value = name === "st" ? args[1]! : registers[index]!;
        }
        else if (name === "taylor" && (args.length === 2 || args.length === 3) && registers) {
          value = 0;
          if (evaluate) {
            const end = offset;
            const index = Math.max(0, Math.min(9, Math.trunc(args[2] ?? 0) || 0));
            const saved = registers[index]!;
            let factor = 1;
            try {
              // FFmpeg reevaluates the coefficient with ld(index) set to each order.
              for (let order = 0; order < 1000; order++) {
                registers[index] = order;
                offset = coefficientStart;
                const coefficient = parse(0, depth + 1);
                const previous = value;
                value += factor * coefficient;
                if (previous === value && coefficient !== 0) break;
                factor *= args[1]! / (order + 1);
              }
            } finally {
              registers[index] = saved;
              offset = end;
            }
          }
        }
        else if (((name === "random" && args.length === 1) || (name === "randomi" && args.length === 3)) && registers && randomStates) {
          value = 0;
          if (evaluate) {
            const index = Math.max(0, Math.min(9, Math.trunc(args[0]!) || 0));
            let state = randomStates[index];
            if (!state) {
              const seed = BigInt(Math.trunc(registers[index]!) || 0);
              state = randomStates[index] = new BigUint64Array([seed, seed, seed, 1n]);
              // FFmpeg 7 initializes SFC64 with twelve discarded draws.
              for (let i = 0; i < 12; i++) nextRandom(state);
            }
            const random = Number(nextRandom(state));
            registers[index] = random;
            value = name === "randomi" ? args[1]! + (args[2]! - args[1]!) * random / 2 ** 64 : random / 2 ** 64;
          }
        }
        else if (filter === "rotate" && args.length === 1 && (name === "rotw" || name === "roth")) {
          const sin = Math.abs(Math.sin(args[0]!));
          const cos = Math.abs(Math.cos(args[0]!));
          value = name === "rotw" ? variables.iw! * cos + variables.ih! * sin : variables.iw! * sin + variables.ih! * cos;
        }
        else if (name === "print" && (args.length === 1 || args.length === 2) && filter === "atrim") {
          value = args[0]!;
          if (evaluate) print?.(value, Math.trunc(args[1] ?? 32));
        }
        else if (name === "abs" && args.length === 1) value = Math.abs(args[0]!);
        else if (name === "sgn" && args.length === 1) value = Number(args[0]! > 0) - Number(args[0]! < 0);
        else if (name === "sqrt" && args.length === 1) value = Math.sqrt(args[0]!);
        else if (name === "log" && args.length === 1) value = Math.log(args[0]!);
        else if (name === "hypot" && args.length === 2) value = Math.hypot(args[0]!, args[1]!);
        else if (name === "exp" && args.length === 1) value = Math.exp(args[0]!);
        else if (name === "gauss" && args.length === 1) value = Math.exp(-args[0]! * args[0]! / 2) / Math.sqrt(2 * Math.PI);
        else if (name === "sin" && args.length === 1) value = Math.sin(args[0]!);
        else if (name === "cos" && args.length === 1) value = Math.cos(args[0]!);
        else if (name === "tan" && args.length === 1) value = Math.tan(args[0]!);
        else if (name === "asin" && args.length === 1) value = Math.asin(args[0]!);
        else if (name === "acos" && args.length === 1) value = Math.acos(args[0]!);
        else if (name === "atan" && args.length === 1) value = Math.atan(args[0]!);
        else if (name === "atan2" && args.length === 2) value = Math.atan2(args[0]!, args[1]!);
        else if (name === "sinh" && args.length === 1) value = Math.sinh(args[0]!);
        else if (name === "cosh" && args.length === 1) value = Math.cosh(args[0]!);
        else if (name === "tanh" && args.length === 1) value = Math.tanh(args[0]!);
        else if (name === "squish" && args.length === 1) value = 1 / (1 + Math.exp(4 * args[0]!));
        else if (name === "isnan" && args.length === 1) value = Number(Number.isNaN(args[0]));
        else if (name === "isinf" && args.length === 1) value = Number(args[0] === Infinity || args[0] === -Infinity);
        else if (name === "not" && args.length === 1) value = Number(args[0] === 0);
        else if (name === "floor" && args.length === 1) value = Math.floor(args[0]!);
        else if (name === "ceil" && args.length === 1) value = Math.ceil(args[0]!);
        else if (name === "trunc" && args.length === 1) value = Math.trunc(args[0]!);
        // FFmpeg rounds halfway values away from zero, including negative values.
        else if (name === "round" && args.length === 1) value = args[0]! < 0 ? -Math.round(-args[0]!) : Math.round(args[0]!);
        else if (name === "eq" && args.length === 2) value = Number(args[0] === args[1]);
        else if (name === "gte" && args.length === 2) value = Number(args[0]! >= args[1]!);
        else if (name === "lte" && args.length === 2) value = Number(args[0]! <= args[1]!);
        else if (name === "lt" && args.length === 2) value = Number(args[0]! < args[1]!);
        else if (name === "if" && (args.length === 2 || args.length === 3)) value = args[0] !== 0 ? args[1]! : (args[2] ?? 0);
        else if (name === "ifnot" && (args.length === 2 || args.length === 3)) value = args[0] === 0 ? args[1]! : (args[2] ?? 0);
        else if (name === "gt" && args.length === 2) value = Number(args[0]! > args[1]!);
        else if (name === "pow" && args.length === 2) value = Math.pow(args[0]!, args[1]!);
        else if ((name === "bitand" || name === "bitor") && args.length === 2) {
          value = NaN;
          if (args.every(Number.isFinite)) {
            // Number bitwise operators truncate to 32 bits; FFmpeg uses int64 operands.
            const left = BigInt(Math.trunc(args[0]!));
            const right = BigInt(Math.trunc(args[1]!));
            value = Number(name === "bitand" ? left & right : left | right);
          }
        }
        else if (name === "mod" && args.length === 2) value = args[0]! - Math.floor(args[0]! / args[1]!) * args[1]!;
        else if (name === "gcd" && args.length === 2) {
          value = Math.abs(Math.trunc(args[0]!));
          let divisor = Math.abs(Math.trunc(args[1]!));
          if (!Number.isFinite(value) || !Number.isFinite(divisor)) value = NaN;
          else while (divisor !== 0) {
            const remainder = value % divisor;
            value = divisor;
            divisor = remainder;
          }
        }
        // FFmpeg's ordered comparisons select the second operand for NaN.
        else if (name === "min" && args.length === 2) value = args[0]! < args[1]! ? args[0]! : args[1]!;
        else if (name === "max" && args.length === 2) value = args[0]! > args[1]! ? args[0]! : args[1]!;
        else if (name === "clip" && args.length === 3) value = args[1]! > args[2]! ? NaN : Math.max(args[1]!, Math.min(args[2]!, args[0]!));
        else if (name === "lerp" && args.length === 3) value = args[0]! + (args[1]! - args[0]!) * args[2]!;
        else if (name === "between" && args.length === 3) value = Number(args[0]! >= args[1]! && args[0]! <= args[2]!);
        else throw new Error(`${filter}: invalid or unsupported expression`);
      } else if ((filter === "crop" || filter === "drawbox enable" || filter === "colorcontrast enable" || filter === "afade enable" || filter === "acrusher enable") && name.toLowerCase() === "nan") {
        value = NaN;
      } else if ((filter === "astats" || filter === "tremolo" || filter === "silenceremove" || filter === "drawbox enable" || filter === "afade enable" || filter === "acrusher enable") && (name.toLowerCase() === "inf" || name.toLowerCase() === "infinity")) {
        value = Infinity;
      } else {
        if (!Object.hasOwn(variables, name)) throw new Error(`${filter}: invalid or unsupported expression`);
        value = variables[name]!;
      }
    } else {
      const start = offset;
      const hexadecimal = source[offset] === "0" && (source[offset + 1] === "x" || source[offset + 1] === "X");
      if (hexadecimal) offset += 2;
      const digitsStart = offset;
      while (offset < source.length) {
        const c = source[offset]!;
        if ((c >= "0" && c <= "9") || (hexadecimal
          ? (c >= "a" && c <= "f") || (c >= "A" && c <= "F")
          : c === ".")) offset++;
        else break;
      }
      if (digitsStart === offset) throw new Error(`${filter}: invalid or unsupported expression`);
      if (!hexadecimal && (source[offset] === "e" || source[offset] === "E")) {
        let end = offset + 1;
        if (source[end] === "+" || source[end] === "-") end++;
        const digits = end;
        while (source[end] && source[end]! >= "0" && source[end]! <= "9") end++;
        if (end > digits) offset = end;
      }
      value = Number(source.slice(start, offset));
      if (Number.isNaN(value)) throw new Error(`${filter}: invalid or unsupported expression`);
      // The dB suffix belongs to the signed numeric literal, not the expression.
      if (source.startsWith("dB", offset)) {
        value = 10 ** (sign * value / 20);
        sign = 1;
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
    // FFmpeg groups powers left to right, before the leading sign.
    while (minPrecedence <= 3) {
      if (source[offset] !== "^") break;
      offset++;
      value = Math.pow(value, parse(4, depth + 1, evaluate));
    }
    value *= sign;
    for (;;) {
      const operator = source[offset];
      const precedence = operator === ";" ? 0 : operator === "+" || operator === "-" ? 1 : operator === "*" || operator === "/" ? 2 : -1;
      if (precedence < minPrecedence) break;
      offset++;
      const right = parse(precedence + 1, depth + 1, evaluate);
      if (operator === ";") value = right;
      else if (operator === "+") value += right;
      else if (operator === "-") value -= right;
      else if (operator === "*") value *= right;
      else value /= right;
    }
    // Discard skipped results before their parent validates function arguments.
    return evaluate ? value : 0;
  }
  // Parse the complete expression before emitting any print() side effects.
  if (print) {
    parse(0, 0, false);
    if (offset !== source.length) throw new Error(`${filter}: invalid or unsupported expression`);
    offset = 0;
  }
  const angle = parse();
  if (offset !== source.length || (!Number.isFinite(angle) && !((filter === "astats" || filter === "chorus" || filter === "fps: frame rate" || filter === "tremolo" || filter === "crop" || filter === "silenceremove" || filter === "silencedetect" || filter === "afade: silence" || filter === "afade: unity" || filter === "format_version") && Math.abs(angle) === Infinity) && filter !== "asendcmd" && filter !== "asetpts" && filter !== "volume" && filter !== "atrim" && filter !== "aeval" && filter !== "tblend" && filter !== "aselect" && filter !== "ametadata expr" && filter !== "asetnsamples enable" && filter !== "tmix enable" && filter !== "deband enable" && filter !== "unsharp enable" && filter !== "colorcontrast enable" && filter !== "framestep enable" && filter !== "thumbnail enable" && filter !== "metadata enable" && filter !== "negate enable" && filter !== "hflip enable" && filter !== "vflip enable" && filter !== "aemphasis enable" && filter !== "adelay enable" && filter !== "compensationdelay enable" && filter !== "afade enable" && filter !== "stereotools enable" && filter !== "silenceremove enable" && filter !== "vibrato enable" && filter !== "tremolo enable" && filter !== "acrusher enable" && filter !== "highpass enable" && filter !== "lowpass enable" && filter !== "drawbox enable" && filter !== "gradfun enable" && !((filter === "select" || filter === "crop" || filter === "pad" || filter === "scale" || filter === "drawbox" || filter === "drawbox enable") && Number.isNaN(angle)))) throw new Error(`${filter}: invalid or unsupported expression`);
  return angle;
}

function nextRandom(state: BigUint64Array): bigint {
  const a = state[0]!, b = state[1]!, c = state[2]!, counter = state[3]!;
  const next = BigInt.asUintN(64, a + b + counter);
  state[0] = b ^ (b >> 11n);
  state[1] = c * 9n;
  state[2] = ((c << 24n) | (c >> 40n)) + next;
  state[3] = counter + 1n;
  return next;
}
