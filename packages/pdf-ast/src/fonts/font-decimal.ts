/** parseFloat's prefix grammar, without retaining an arbitrarily long decimal.
 * Binary64 rounding boundaries terminate within 800 significant decimal digits;
 * a sticky tail preserves the side of a boundary after that exact prefix. */
export class FontDecimal {
  private phase:
    | "start"
    | "integer"
    | "fraction"
    | "exponent"
    | "exponentDigits"
    | "infinity"
    | "done" = "start";
  private negative = false;
  private literal = 0;
  private exponentNegative = false;
  private exponent = 0;
  private exponentDigits = 0;
  private digits = 0;
  private significant = 0;
  private fraction = 0;
  private prefix = "";
  private sticky = false;
  constructor(private readonly exponentLimit: number) {}
  accept(char: string): void {
    if (this.phase === "done") return;
    if (this.phase === "infinity") {
      if (char === "Infinity"[this.literal]) {
        this.literal++;
        if (this.literal === 8) this.phase = "done";
      } else this.phase = "done";
      return;
    }
    if (this.phase === "start") {
      if (
        char === " " ||
        char === "\t" ||
        char === "\r" ||
        char === "\n" ||
        char === "\v" ||
        char === "\f" ||
        char === "\u00a0"
      )
        return;
      this.phase = "integer";
      if (char === "-" || char === "+") {
        this.negative = char === "-";
        return;
      }
    }
    if (this.phase === "exponent") {
      this.phase = "exponentDigits";
      if (char === "-" || char === "+") {
        this.exponentNegative = char === "-";
        return;
      }
    }
    if (char === "I" && this.phase === "integer" && !this.digits) {
      this.phase = "infinity";
      this.literal = 1;
      return;
    }
    const digit = char.charCodeAt(0) - 48;
    if (digit >= 0 && digit <= 9) {
      if (this.phase === "exponentDigits") {
        this.exponentDigits++;
        this.exponent = Math.min(this.exponentLimit, this.exponent * 10 + digit);
      } else {
        this.digits++;
        if (this.phase === "fraction") this.fraction++;
        if (this.significant || digit !== 0) {
          this.significant++;
          if (this.prefix.length < 800) this.prefix += char;
          else if (digit !== 0) this.sticky = true;
        }
      }
    } else if (char === "." && this.phase === "integer") this.phase = "fraction";
    else if (
      (char === "E" || char === "e") &&
      this.digits &&
      (this.phase === "integer" || this.phase === "fraction")
    )
      this.phase = "exponent";
    else this.phase = "done";
  }
  value(): number {
    if (this.literal === 8) return this.negative ? -Infinity : Infinity;
    if (!this.digits) return NaN;
    if (!this.significant) return this.negative ? -0 : 0;
    const prefix = this.prefix + (this.sticky ? "1" : "");
    const exponent =
      (this.exponentDigits ? this.exponent * (this.exponentNegative ? -1 : 1) : 0) -
      this.fraction +
      this.significant -
      prefix.length;
    return Number(`${this.negative ? "-" : ""}${prefix}e${exponent}`);
  }
}
