import { Budget, XanError } from "./budget.js";
import type { RecordRow } from "./csv.js";
import type { InputScope } from "./io.js";

export async function condition(expression: string | undefined, headers: RecordRow | undefined, noHeaders: boolean, budget: Budget, scope: InputScope): Promise<((row: RecordRow) => Promise<boolean>) | undefined> {
  if (expression === undefined) return undefined;
  budget.bound('maxSelectorBytes', await budget.textSize(expression));
  let split = -1;
  let operator = '';
  for (let offset = 0; offset < expression.length; offset++) {
    budget.work();
    if (['=', '!', '<', '>'].includes(expression[offset]!)) {
      split = offset;
      operator = expression[offset]!;
      if (expression[offset + 1] === '=') operator += '=';
      break;
    }
  }
  if (split < 0 || !['==', '!=', '<', '<=', '>', '>='].includes(operator)) throw new XanError('unsupported condition: expected COLUMN comparison LITERAL');
  const name = expression.slice(0, split).trim();
  const literal = expression.slice(split + operator.length).trim();
  if (noHeaders) throw new XanError('named conditions require headers');
  const nameBytes = await budget.encode(name);
  let position = -1;
  try {
    for (let index = 0; index < (headers?.cells.length ?? 0); index++) {
      const bytes = headers!.cells[index]!.decoded.view();
      if (bytes.length !== nameBytes.length) continue;
      let same = true;
      for (let offset = 0; offset < bytes.length; offset++) { budget.work(); if (bytes[offset] !== nameBytes[offset]) same = false; }
      if (same) { position = index; break; }
    }
  } finally { budget.release(nameBytes.length); }
  if (position < 0) throw new XanError(`unknown condition column: ${name}`);
  let text: string;
  let numeric = false;
  if (literal.startsWith('"')) {
    try { const value: unknown = JSON.parse(literal); if (typeof value !== 'string') throw new Error(); text = value; }
    catch { throw new XanError('invalid condition string literal'); }
  } else if (literal.startsWith("'") && literal.endsWith("'") && literal.length >= 2) text = literal.slice(1, -1);
  else {
    if (!literal || !Number.isFinite(Number(literal))) throw new XanError('unsupported condition literal');
    text = literal; numeric = true;
  }
  const right = await budget.encode(text);
  scope.own(() => budget.release(right.length));
  return async row => {
    const left = row.cells[position]!.decoded.view();
    let order = 0;
    if (numeric) {
      budget.hold(left.length * 2);
      try {
        let value = '';
        for (let offset = 0; offset < left.length; offset++) { budget.work(); value += String.fromCharCode(left[offset]!); if ((offset & 1023) === 0) { const c = budget.checkpoint(); if (c) await c; } }
        const number = Number(value);
        if (!value.trim() || !Number.isFinite(number)) throw new XanError('condition requires a numeric cell');
        order = number < Number(text) ? -1 : number > Number(text) ? 1 : 0;
      } finally { budget.release(left.length * 2); }
    } else {
      for (let offset = 0; offset < Math.min(left.length, right.length); offset++) {
        budget.work();
        if (left[offset] !== right[offset]) { order = left[offset]! < right[offset]! ? -1 : 1; break; }
        if ((offset & 1023) === 0) { const c = budget.checkpoint(); if (c) await c; }
      }
      if (!order) order = left.length < right.length ? -1 : left.length > right.length ? 1 : 0;
    }
    return operator === '==' ? order === 0 : operator === '!=' ? order !== 0 : operator === '<' ? order < 0 : operator === '<=' ? order <= 0 : operator === '>' ? order > 0 : order >= 0;
  };
}
