import { CompactPdfNumber } from "@poe-code/pdf-ast";

/** Number(string) grammar, retaining only bounded decimal/radix state. */
class GeometryNumber {
  private readonly decimal = new CompactPdfNumber();
  private state: "start" | "sign" | "zero" | "int" | "dot" | "fraction" | "exp" | "expSign" | "expDigits" | "special" | "radix" | "bad" = "start";
  private negative = false;
  private signed = false;
  private trailing = false;
  private special = "";
  private radix = 0;
  private integer = 0n;
  private overflow = false;
  private radixDigits = false;
  present = false;
  substantive = false;
  append(character: string): void {
    this.present = true;
    if (!character.trim()) { if (this.state !== "start") this.trailing = true; return; }
    this.substantive = true;
    if (this.trailing || this.state === "bad") { this.state = "bad"; return; }
    if (this.state === "special") { this.special += character; if (!"Infinity".startsWith(this.special)) this.state = "bad"; return; }
    if (this.state === "radix") {
      const code = character.toLowerCase().charCodeAt(0), digit = code >= 48 && code <= 57 ? code - 48 : code >= 97 && code <= 102 ? code - 87 : -1;
      if (digit < 0 || digit >= this.radix) { this.state = "bad"; return; }
      this.radixDigits = true;
      if (!this.overflow) { this.integer = this.integer * BigInt(this.radix) + BigInt(digit); this.overflow = this.integer >= (1n << 1024n); }
      return;
    }
    const digit = character >= "0" && character <= "9";
    if (this.state === "start" && (character === "+" || character === "-")) {
      this.signed = true; this.negative = character === "-"; this.state = "sign";
    } else if ((this.state === "start" || this.state === "sign") && character === "I") {
      this.special = "I"; this.state = "special"; return;
    } else if ((this.state === "start" || this.state === "sign") && digit) this.state = character === "0" ? "zero" : "int";
    else if ((this.state === "start" || this.state === "sign") && character === ".") this.state = "dot";
    else if (this.state === "zero" && !this.signed && ["x", "b", "o"].includes(character.toLowerCase())) {
      this.radix = character.toLowerCase() === "x" ? 16 : character.toLowerCase() === "b" ? 2 : 8; this.state = "radix"; return;
    } else if ((this.state === "zero" || this.state === "int") && digit) this.state = "int";
    else if ((this.state === "zero" || this.state === "int") && character === ".") this.state = "fraction";
    else if ((this.state === "dot" || this.state === "fraction") && digit) this.state = "fraction";
    else if ((this.state === "zero" || this.state === "int" || this.state === "fraction") && (character === "e" || character === "E")) this.state = "exp";
    else if (this.state === "exp" && (character === "+" || character === "-")) this.state = "expSign";
    else if ((this.state === "exp" || this.state === "expSign" || this.state === "expDigits") && digit) this.state = "expDigits";
    else { this.state = "bad"; return; }
    this.decimal.append(character.charCodeAt(0));
  }
  value(): number {
    if (this.state === "start") return 0;
    if (this.state === "special") return this.special === "Infinity" ? (this.negative ? -Infinity : Infinity) : NaN;
    if (this.state === "radix") return this.radixDigits ? (this.overflow ? Infinity : Number(this.integer)) : NaN;
    if (["zero", "int", "fraction", "expDigits"].includes(this.state)) return Number(this.decimal.spelling);
    return NaN;
  }
}

/** Equivalent to trim().split(" ").filter(Boolean).map(Number), retaining the
 * first four values and validity of every token rather than an unbounded list. */
export async function parsePdftkGeometryChunks(chunks: AsyncIterable<string>, signal: AbortSignal): Promise<{ values: number[]; count: number; finite: boolean }> {
  const values: number[] = []; let count = 0, finite = true, work = 0, leading = true, pendingZeroes = 0, token = new GeometryNumber();
  const record = (value: number) => { if (values.length < 4) values.push(value); count = Math.min(5, count + 1); finite &&= Number.isFinite(value); };
  const finish = () => {
    if (token.present) {
      if (!token.substantive) pendingZeroes = Math.min(5, pendingZeroes + 1);
      else { while (pendingZeroes) { record(0); pendingZeroes--; } record(token.value()); }
    }
    token = new GeometryNumber();
  };
  for await (const chunk of chunks) {
    signal.throwIfAborted();
    for (const character of chunk) {
      if (++work % 4096 === 0) { await new Promise<void>(resolve => setTimeout(resolve, 0)); signal.throwIfAborted(); }
      if (leading && !character.trim()) continue;
      leading = false;
      if (character === " ") finish(); else token.append(character);
    }
  }
  signal.throwIfAborted(); finish(); return { values, count, finite };
}
