import {PandocError} from "./errors.js";
import type {LuaInteger,StoredLuaValue} from "./lua-storage.js";

export type LuaNumber=number | LuaInteger;
export const binaryOpcodes: Readonly<Record<string,number>>={"+":13,"-":14,"*":15,"%":16,"^":17,"/":18,"//":19,"&":20,"|":21,"~":22,"<<":23,">>":24};

export const integer = (value: number): LuaInteger => ({kind: "integer", value: value | 0});
export const isInteger = (value: StoredLuaValue): value is LuaInteger => typeof value === "object" && value.kind === "integer";
function fail(message: string): never {throw new PandocError("E_AST", "convert", message);}
export function numeric(value: StoredLuaValue): number {
  if (typeof value === "number") return value;
  if (isInteger(value)) return value.value;
  return fail("Expected Lua number");
}
export function integral(value: StoredLuaValue): number {
  const number = numeric(value);
  if ((number | 0) !== number) fail("Number has no integer representation");
  return number;
}
function shift(value: number, amount: number): number {
  if (amount >= 32 || amount <= -32) return 0;
  return amount < 0 ? value >>> -amount : value << amount;
}
export function arithmetic(op: number, left: StoredLuaValue, right: StoredLuaValue): LuaNumber {
  const a = numeric(left), b = numeric(right), integers = isInteger(left) && isInteger(right);
  let result: number;
  switch (op) {
    case 25: return isInteger(left) ? integer(-a) : -a;
    case 26: return integer(~integral(left));
    case 13: result = a + b; break;
    case 14: result = a - b; break;
    case 15: result = integers ? Math.imul(a, b) : a * b; break;
    case 16:
      if (integers && b === 0) fail("Attempt to perform n%0");
      result = a % b;
      if (result !== 0 && (result < 0) !== (b < 0)) result += b;
      break;
    case 17: return a ** b;
    case 18: return a / b;
    case 19:
      if (integers && b === 0) fail("Attempt to divide by zero");
      result = Math.floor(a / b); break;
    case 20: return integer(integral(left) & integral(right));
    case 21: return integer(integral(left) | integral(right));
    case 22: return integer(integral(left) ^ integral(right));
    case 23: return integer(shift(integral(left), integral(right)));
    case 24: return integer(shift(integral(left), -integral(right)));
    default: return fail("Invalid arithmetic instruction");
  }
  return integers ? integer(result) : result;
}
