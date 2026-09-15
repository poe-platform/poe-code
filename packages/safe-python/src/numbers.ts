import type { PythonSource, SourcePosition } from "./source.js";

export type NumberToken = {
  readonly text: string;
  readonly start: SourcePosition;
  readonly end: SourcePosition;
} & (
  | { readonly kind: "integer"; readonly value: bigint }
  | { readonly kind: "float" | "imaginary"; readonly value: number }
);

const adjacentKeywords = ["and", "else", "for", "if", "in", "is", "not", "or"];

/** Reads an unsigned Python number; unary signs belong to the expression parser. */
export function readNumber(
  source: PythonSource,
  onWarning?: (message: string, position: SourcePosition) => void
): NumberToken {
  try {
  source.meter?.checkpoint(1,256);
  const start = source.position;
  let base = 10;
  let literalName = "decimal";
  let kind: "integer" | "float" | "imaginary" = "integer";
  const invalid = (): never => {
    source.meter?.checkpoint(0,96);
    throw source.error(`invalid ${literalName} literal`, start);
  };
  const digits = (required: boolean): void => {
    if (!isDigit(source.peek(), base)) {
      if (required) invalid();
      return;
    }
    while (isDigit(source.peek(), base)) {
      source.advance();
      if (source.peek() === "_") {
        source.advance();
        if (!isDigit(source.peek(), base)) invalid();
      }
    }
  };

  const prefix = source.peek(1).toLowerCase();
  if (source.peek() === "0" && (prefix === "b" || prefix === "o" || prefix === "x")) {
    base = prefix === "b" ? 2 : prefix === "o" ? 8 : 16;
    literalName = prefix === "b" ? "binary" : prefix === "o" ? "octal" : "hexadecimal";
    source.advance();
    source.advance();
    if (source.peek() === "_") source.advance();
    digits(true);
  } else {
    const leadingPoint = source.peek() === ".";
    if (!leadingPoint) digits(true);
    if (source.peek() === ".") {
      kind = "float";
      source.advance();
      digits(leadingPoint);
    }
    // `1else` is a deprecated token boundary, not an exponent.
    if ((source.peek() === "e" || source.peek() === "E") && !keywordAt(source)) {
      kind = "float";
      source.advance();
      if (source.peek() === "+" || source.peek() === "-") source.advance();
      digits(true);
    }
    if (source.peek() === "j" || source.peek() === "J") {
      kind = "imaginary";
      literalName = "imaginary";
      source.advance();
    }
  }

  if (isAsciiNameCharacter(source.peek())) {
    if (!keywordAt(source)) invalid();
    source.meter?.checkpoint(0,96);
    onWarning?.(`invalid ${literalName} literal`, start);
  }
  const end = source.position;
  source.meter?.checkpoint(1+end.offset-start.offset,64+4*(end.offset-start.offset));
  const text = source.text.slice(start.offset, end.offset);
  const normalized = text.replaceAll("_","");
  if (kind === "integer") {
    if (base === 10 && normalized[0] === "0") {
      for (const character of normalized) {
        source.meter?.checkpoint();
        if (character !== "0") {
          throw source.error("leading zeros in decimal integer literals are not permitted; use an 0o prefix for octal integers", start);
        }
      }
    }
    source.meter?.checkpoint(1+normalized.length,32+Math.ceil(normalized.length/2));
    return { kind, value: BigInt(normalized), text, start, end };
  }
  source.meter?.checkpoint(1+normalized.length,kind==="imaginary"?32+2*normalized.length:0);
  return {
    kind, value: Number(kind === "imaginary" ? normalized.slice(0, -1) : normalized),
    text, start, end
  };
  } finally {source.meter?.checkpoint();}
}

function isDigit(character: string, base: number): boolean {
  const code = character.charCodeAt(0);
  if (code >= 48 && code <= 57) return code - 48 < base;
  return base === 16 && ((code >= 65 && code <= 70) || (code >= 97 && code <= 102));
}

function isAsciiNameCharacter(character: string): boolean {
  return character === "_" || (character >= "0" && character <= "9") ||
    (character >= "a" && character <= "z") || (character >= "A" && character <= "Z");
}

function keywordAt(source: PythonSource): boolean {
  for(let keywordIndex=0;keywordIndex<adjacentKeywords.length;keywordIndex++){
    const keyword=adjacentKeywords[keywordIndex];let matches=true;
    for (let index = 0; index < keyword.length; index++) {
      if (source.peek(index) !== keyword[index]) {matches=false;break;}
    }
    if(!matches)continue;
    const next = source.peek(keyword.length);
    // Non-ASCII name continuations must never turn a longer name into a keyword.
    if(!isAsciiNameCharacter(next) && (next.codePointAt(0) ?? 0) < 128)return true;
  }
  return false;
}
