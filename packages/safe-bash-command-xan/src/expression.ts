import { Budget, XanError } from "./budget.js";
import { cellText, decimalNumber } from "./cells.js";
import type { RecordRow } from "./csv.js";

type Value = string | number;
type Evaluate = (row: RecordRow) => Value;
export interface Expression { name: string; evaluate: Evaluate }

/** Parse a bounded arithmetic projection without executing host JavaScript. */
export async function expressions(text: string, header: RecordRow | undefined, noHeaders: boolean, budget: Budget): Promise<Expression[]> {
  budget.bound("maxSelectorBytes", await budget.textSize(text));
  budget.hold(text.length * 4);
  let offset = 0;
  const space = (): void => { while (" \t\r\n".includes(text[offset] ?? "\0")) { offset++; budget.work(); } };
  const identifier = (): string => {
    const start = offset;
    while (offset < text.length) {
      const c = text.charCodeAt(offset);
      if (!(c >= 65 && c <= 90 || c >= 97 && c <= 122 || c === 95 || offset > start && c >= 48 && c <= 57)) break;
      offset++; budget.work();
    }
    return text.slice(start, offset);
  };
  const numeric = (value: Value): number => {
    const number = typeof value === "number" ? value : decimalNumber(value, budget);
    if (number === undefined || !Number.isFinite(number)) throw new XanError("expression requires a finite number");
    return number;
  };
  const parse = (minimum: number, depth: number): Evaluate => {
    budget.bound("maxSelectorDepth", depth);
    if (depth > 128) throw new XanError("expression nesting is too deep");
    budget.add("maxSelectorNodes", 1); budget.hold(64); space();
    let left: Evaluate;
    const char = text[offset];
    if (char === "+" || char === "-") {
      offset++; const inner = parse(3, depth + 1);
      left = row => (char === "-" ? -1 : 1) * numeric(inner(row));
    } else if (char === "(") {
      offset++; left = parse(0, depth + 1); space();
      if (text[offset++] !== ")") throw new XanError("expected closing parenthesis");
    } else if (char === "'" || char === '"') {
      offset++; let value = "";
      while (offset < text.length && text[offset] !== char) {
        budget.work(); value += text[offset++];
      }
      if (text[offset++] !== char) throw new XanError("unclosed expression string");
      left = () => value;
    } else if (char !== undefined && (char >= "0" && char <= "9" || char === ".")) {
      const start = offset;
      while (offset < text.length && "0123456789.eE".includes(text[offset]!)) {
        const previous = text[offset++]; budget.work();
        if ((previous === "e" || previous === "E") && (text[offset] === "+" || text[offset] === "-")) offset++;
      }
      const value = decimalNumber(text.slice(start, offset), budget);
      if (value === undefined) throw new XanError("invalid expression number");
      left = () => value;
    } else {
      const name = identifier();
      if (!name) throw new XanError("expected expression");
      space();
      if (text[offset] === "(") {
        offset++;
        const inner = parse(0, depth + 1);
        space();
        if (text[offset++] !== ")") throw new XanError("expected closing parenthesis");
        const fnName = name.toLowerCase();
        if (fnName === "upper") left = row => String(inner(row)).toUpperCase();
        else if (fnName === "lower") left = row => String(inner(row)).toLowerCase();
        else if (fnName === "trim") left = row => String(inner(row)).trim();
        else if (fnName === "len") left = row => String(inner(row)).length;
        else throw new XanError(`unknown expression column: ${name}`);
      } else {
        let column = -1;
        if (!noHeaders) for (let i = 0; i < (header?.width ?? 0); i++) {
          budget.work();
          if (cellText(header!.cells[i]!.decoded.view(), budget) === name) { column = i; break; }
        }
        if (column < 0) throw new XanError(`unknown expression column: ${name}`);
        left = row => cellText(row.cells[column]!.decoded.view(), budget);
      }
    }
    let chainDepth = depth;
    while (true) {
      space();
      const operator = text[offset] ?? "";
      const precedence = operator === "+" || operator === "-" ? 1 : operator === "*" || operator === "/" || operator === "%" ? 2 : -1;
      if (precedence < minimum) break;
      budget.bound("maxSelectorDepth", ++chainDepth);
      if (chainDepth > 128) throw new XanError("expression nesting is too deep");
      offset++;
      const right = parse(precedence + 1, depth + 1), previous = left;
      left = row => {
        budget.work();
        const a = numeric(previous(row)), b = numeric(right(row));
        const value = operator === "+" ? a + b : operator === "-" ? a - b : operator === "*" ? a * b : operator === "/" ? a / b : a % b;
        if (!Number.isFinite(value)) throw new XanError("non-finite arithmetic result");
        return value;
      };
    }
    return left;
  };
  const result: Expression[] = [];
  for (;;) {
    space(); const start = offset;
    const evaluate = parse(0, 1);
    let name = text.slice(start, offset).trim();
    if (text.slice(offset, offset + 2).toLowerCase() === "as" && " \t\r\n".includes(text[offset + 2] ?? "\0")) {
      offset += 2; space(); name = identifier();
      if (!name) throw new XanError("expected expression alias");
      space();
    }
    budget.bound("maxSelectedColumns", result.length + 1);
    budget.hold(64); result.push({ name, evaluate });
    const checkpoint = budget.checkpoint(); if (checkpoint) await checkpoint;
    if (offset === text.length) break;
    if (text[offset++] !== ",") throw new XanError("unexpected expression syntax");
  }
  return result;
}
