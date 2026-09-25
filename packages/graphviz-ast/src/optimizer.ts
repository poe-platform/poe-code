interface Element {
  name: string;
  attributes: Record<string, string>;
  children: (Element | string)[];
}
export interface OptimizeSvgOptions {
  precision?: number;
}
const space = (c: string) => c === " " || c === "\n" || c === "\t" || c === "\r";
const digit = (c: string) => c >= "0" && c <= "9";
const numericAttributes = new Set([
  "x",
  "y",
  "x1",
  "y1",
  "x2",
  "y2",
  "cx",
  "cy",
  "r",
  "rx",
  "ry",
  "width",
  "height",
  "stroke-width",
  "stroke-opacity",
  "fill-opacity",
  "opacity",
  "font-size",
  "offset"
]);
/** Small XML parser preserving text and attribute entities verbatim. No DTD expansion. */
function parseXml(source: string): Element {
  const roots: Element[] = [];
  const stack: Element[] = [];
  let i = 0;
  const fail = (): never => {
    throw new SyntaxError(`Malformed SVG at offset ${i}`);
  };
  const ws = () => {
    while (i < source.length && space(source[i]!)) i++;
  };
  const name = () => {
    const start = i;
    while (i < source.length && !space(source[i]!) && !"/=<>\"'".includes(source[i]!)) i++;
    if (i === start) fail();
    return source.slice(start, i);
  };
  while (i < source.length) {
    if (source[i] !== "<") {
      const start = i;
      while (i < source.length && source[i] !== "<") i++;
      if (stack.length) stack.at(-1)!.children.push(source.slice(start, i));
      else if (source.slice(start, i).trim()) fail();
      continue;
    }
    if (source.startsWith("<!--", i)) {
      const end = source.indexOf("-->", i + 4);
      if (end < 0) fail();
      i = end + 3;
      continue;
    }
    if (source.startsWith("<?", i)) {
      const end = source.indexOf("?>", i + 2);
      if (end < 0) fail();
      i = end + 2;
      continue;
    }
    if (source.startsWith("<![CDATA[", i)) {
      const end = source.indexOf("]]>", i + 9);
      if (end < 0 || !stack.length) fail();
      stack.at(-1)!.children.push(source.slice(i, end + 3));
      i = end + 3;
      continue;
    }
    if (source.startsWith("<!DOCTYPE", i)) {
      let quote = "";
      let brackets = 0;
      i += 9;
      while (i < source.length) {
        const c = source[i++]!;
        if (quote) {
          if (c === quote) quote = "";
        } else if (c === '"' || c === "'") quote = c;
        else if (c === "[") brackets++;
        else if (c === "]") brackets--;
        else if (c === ">" && !brackets) break;
      }
      continue;
    }
    i++;
    if (source[i] === "/") {
      i++;
      const closing = name();
      ws();
      if (source[i++] !== ">" || stack.pop()?.name !== closing) fail();
      continue;
    }
    const element: Element = { name: name(), attributes: {}, children: [] };
    ws();
    while (i < source.length && source[i] !== ">" && source[i] !== "/") {
      const key = name();
      ws();
      if (source[i++] !== "=") fail();
      ws();
      const quote = source[i++];
      if (quote !== '"' && quote !== "'") fail();
      const start = i;
      while (i < source.length && source[i] !== quote) {
        if (source[i] === "<") fail();
        i++;
      }
      if (i === source.length || Object.hasOwn(element.attributes, key)) fail();
      element.attributes[key] = source.slice(start, i).split('"').join("&quot;");
      i++;
      ws();
    }
    if (stack.length) stack.at(-1)!.children.push(element);
    else roots.push(element);
    if (source[i] === "/") {
      i++;
      if (source[i++] !== ">") fail();
    } else {
      if (source[i++] !== ">") fail();
      stack.push(element);
      if (stack.length > 256) throw new RangeError("SVG nesting exceeds 256");
    }
  }
  if (stack.length || roots.length !== 1 || roots[0]!.name !== "svg") fail();
  return roots[0]!;
}
interface NumberToken {
  value: number;
  end: number;
}
function readNumber(source: string, start: number): NumberToken | undefined {
  let i = start;
  if (source[i] === "-" || source[i] === "+") i++;
  let digits = 0;
  while (i < source.length && digit(source[i]!)) {
    digits++;
    i++;
  }
  if (source[i] === ".") {
    i++;
    while (i < source.length && digit(source[i]!)) {
      digits++;
      i++;
    }
  }
  if (!digits) return undefined;
  if (source[i] === "e" || source[i] === "E") {
    const before = i++;
    if (source[i] === "+" || source[i] === "-") i++;
    const exp = i;
    while (i < source.length && digit(source[i]!)) i++;
    if (i === exp) i = before;
  }
  const value = Number(source.slice(start, i));
  return Number.isFinite(value) ? { value, end: i } : undefined;
}
function roundList(source: string, format: (n: number) => string): string {
  let result = "";
  for (let i = 0; i < source.length; ) {
    const number = readNumber(source, i);
    if (number) {
      result += format(number.value);
      i = number.end;
    } else result += source[i++]!;
  }
  return result;
}
function compactPath(source: string, format: (n: number) => string): string {
  const arities: Record<string, number> = {
    M: 2,
    L: 2,
    H: 1,
    V: 1,
    C: 6,
    S: 4,
    Q: 4,
    T: 2,
    A: 7,
    Z: 0
  };
  let i = 0;
  let command = "";
  let result = "";
  let x = 0;
  let y = 0;
  let sx = 0;
  let sy = 0;
  while (i < source.length) {
    while (space(source[i] ?? "") || source[i] === ",") i++;
    if (i >= source.length) break;
    if (Object.hasOwn(arities, source[i]!.toUpperCase())) {
      command = source[i++]!;
      if (command.toUpperCase() === "Z") {
        result += "Z";
        x = sx;
        y = sy;
        command = "";
        continue;
      }
    }
    if (!command) return source;
    const count = arities[command.toUpperCase()]!;
    const values: number[] = [];
    for (let j = 0; j < count; j++) {
      while (space(source[i] ?? "") || source[i] === ",") i++;
      const number = readNumber(source, i);
      if (!number) return source;
      values.push(number.value);
      i = number.end;
    }
    const upper = command.toUpperCase();
    const relative = command !== upper;
    let emitted = command;
    if (upper === "M" || upper === "L" || upper === "T") {
      const nx = values[0]! + (relative ? x : 0);
      const ny = values[1]! + (relative ? y : 0);
      if (upper === "L" && format(ny) === format(y)) {
        emitted = "H";
        values.splice(0, values.length, nx);
      } else if (upper === "L" && format(nx) === format(x)) {
        emitted = "V";
        values.splice(0, values.length, ny);
      }
      x = nx;
      y = ny;
      if (upper === "M") {
        sx = x;
        sy = y;
      }
    } else if (upper === "H") x = values[0]! + (relative ? x : 0);
    else if (upper === "V") y = values[0]! + (relative ? y : 0);
    else {
      x = values.at(-2)! + (relative ? x : 0);
      y = values.at(-1)! + (relative ? y : 0);
    }
    result += emitted + values.map(format).join(" ");
    if (upper === "M") command = relative ? "l" : "L";
  }
  return result;
}

export function optimizeSvg(source: string, options: OptimizeSvgOptions = {}): string {
  const precision = options.precision ?? 3;
  if (!Number.isInteger(precision) || precision < 0 || precision > 15)
    throw new RangeError("precision must be an integer from 0 to 15");
  const format = (n: number) => String(Number(n.toFixed(precision)));
  const root = parseXml(source);
  const visit = (element: Element): (Element | string)[] => {
    if (element.name === "metadata") return [];
    for (const [key, value] of Object.entries(element.attributes)) {
      if (key === "d") element.attributes[key] = compactPath(value, format);
      else if (key === "viewBox" || key === "points" || key === "transform")
        element.attributes[key] = roundList(value, format);
      else if (numericAttributes.has(key)) {
        const n = readNumber(value, 0);
        if (n) element.attributes[key] = format(n.value) + value.slice(n.end);
      }
    }
    element.children = element.children.flatMap((child) =>
      typeof child === "string" ? [child] : visit(child)
    );
    if (element.name === "g" && !Object.keys(element.attributes).length) return element.children;
    return [element];
  };
  visit(root);
  if (!root.attributes.viewBox) {
    const w = readNumber(root.attributes.width ?? "", 0);
    const h = readNumber(root.attributes.height ?? "", 0);
    const units = (value: string, end: number) =>
      value.slice(end) === "" || value.slice(end) === "px";
    if (
      w &&
      h &&
      w.value > 0 &&
      h.value > 0 &&
      units(root.attributes.width!, w.end) &&
      units(root.attributes.height!, h.end)
    )
      root.attributes.viewBox = `0 0 ${format(w.value)} ${format(h.value)}`;
  } else {
    const values = root.attributes.viewBox
      .split(",")
      .join(" ")
      .split("\t")
      .join(" ")
      .split("\r")
      .join(" ")
      .split("\n")
      .join(" ")
      .split(" ")
      .filter(Boolean);
    if (values.length === 4 && values.every((v) => Number.isFinite(Number(v))))
      root.attributes.viewBox = values.map((v) => format(Number(v))).join(" ");
  }
  const serialize = (element: Element): string => {
    const attributes = Object.entries(element.attributes)
      .map(([key, value]) => ` ${key}="${value}"`)
      .join("");
    return element.children.length
      ? `<${element.name}${attributes}>${element.children.map((child) => (typeof child === "string" ? child : serialize(child))).join("")}</${element.name}>`
      : `<${element.name}${attributes}/>`;
  };
  return serialize(root);
}
