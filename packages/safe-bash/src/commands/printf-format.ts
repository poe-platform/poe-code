import { yieldTurn } from "../contracts/yield.js";
import { decoder, UsageError } from "./internal.js";

interface PrintfDirective {
  readonly end: number;
  readonly flags: string;
  readonly width: number | "*";
  readonly precision: number | "*" | undefined;
  readonly specifier: string;
}

// Bound work per directive, including repeated flags and leading zeroes.
const maxDirectiveLength = 16 * 1024;

export async function parsePrintfDirective(format: string | Uint8Array, start: number, signal: AbortSignal): Promise<PrintfDirective> {
  signal.throwIfAborted();
  let offset = start + 1;
  const character = (): string => {
    if (offset - start >= maxDirectiveLength) throw new UsageError("format directive length limit exceeded");
    return typeof format === "string" ? format.charAt(offset) : offset < format.length ? String.fromCharCode(format[offset]!) : "";
  };
  let flags = "";
  let current = character();
  while (current && "-+ #0".includes(current)) {
    if (!flags.includes(current)) flags += current;
    offset++;
    if ((offset - start) % 1024 === 0) await yieldTurn(signal);
    current = character();
  }
  const field = async (): Promise<number | "*"> => {
    if (character() === "*") { offset++; return "*"; }
    let result = 0;
    for (let digit = character(); digit >= "0" && digit <= "9"; digit = character()) {
      result = result * 10 + Number(digit);
      offset++;
      if ((offset - start) % 1024 === 0) await yieldTurn(signal);
    }
    return result;
  };
  const width = await field();
  let precision: number | "*" | undefined;
  if (character() === ".") { offset++; precision = await field(); }
  const length = character();
  if (length && "hlLjzt".includes(length)) {
    offset++;
    if ((length === "h" || length === "l") && character() === length) offset++;
  }
  const specifier = character();
  if (!specifier || !"sbqcdiouxXfFeEgGaA".includes(specifier)) {
    const end = start + 64;
    const preview = typeof format === "string" ? format.slice(start, end) : decoder.decode(format.subarray(start, end));
    throw new UsageError(`invalid format near '${preview}${format.length > end ? "..." : ""}'`);
  }
  return { end: offset + 1, flags, width, precision, specifier };
}
