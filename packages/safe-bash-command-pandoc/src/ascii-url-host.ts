/** Bounded admission for ASCII domains and WHATWG IPv4 numbers. IDNA labels and
 * valid Unicode explicitly defer to the native host parser after bounded UTF-8
 * and forbidden-code-point validation. */
export class AsciiUrlHost {
  private native = false;
  private escape = "";
  private surrogate = "";
  private readonly decoder = new TextDecoder("utf-8", {fatal: true, ignoreBOM: true});
  private readonly encoder = new TextEncoder();
  private readonly bytes = new Uint8Array(1024);
  private used = 0;
  private invalid = false;
  private pipe = false;
  private size = 0;
  private first = "";
  private prefix = "";
  private length = 0;
  private zero = false;
  private radix = 10;
  private digits = true;
  private valid = true;
  private value = 0;
  private count = 0;
  private previousValid = true;
  private lastValid = false;
  private lastDigits = false;
  private lastValue = 0;
  private lastEmpty = true;

  get singleLetter(): string | undefined {
    return this.size === 1 && this.first >= "a" && this.first <= "z" ? this.first : undefined;
  }
  get windowsDrive(): string | undefined {
    return this.size === 2 && this.pipe && this.first >= "a" && this.first <= "z" ? this.first + "|" : undefined;
  }
  write(char: string): void {
    // File drive syntax is determined before percent decoding and IDNA mapping.
    if (!this.size) this.first = char.charCodeAt(0) < 128 ? char.toLowerCase() : "";
    this.size = Math.min(3, this.size + char.length);
    this.pipe = this.size === 2 && char === "|";
    if (this.invalid) return;
    if (this.surrogate) {
      if (char.length !== 1 || char.charCodeAt(0) < 0xdc00 || char.charCodeAt(0) > 0xdfff) {this.invalid = true; return;}
      char = this.surrogate + char; this.surrogate = "";
    }
    if (this.escape) {
      const hex = char.toLowerCase();
      if (hex.length !== 1 || !(hex >= "0" && hex <= "9" || hex >= "a" && hex <= "f")) {this.invalid = true; return;}
      this.escape += hex;
      if (this.escape.length < 3) return;
      this.byte(Number.parseInt(this.escape.slice(1), 16)); this.escape = "";
    } else if (char === "%") this.escape = "%";
    else if (char.charCodeAt(0) < 128) this.byte(char.charCodeAt(0));
    else if (char.length === 1 && char.charCodeAt(0) >= 0xd800 && char.charCodeAt(0) <= 0xdbff) this.surrogate = char;
    else for (const byte of this.encoder.encode(char)) this.byte(byte);
  }
  private byte(value: number): void {
    this.bytes[this.used++] = value;
    if (this.used === this.bytes.length) this.decode(true);
  }
  private decode(stream: boolean): void {
    try {
      for (const char of this.decoder.decode(this.bytes.subarray(0, this.used), {stream})) this.domain(char);
    } catch {this.invalid = true;}
    this.used = 0;
  }
  private domain(char: string): void {
    if (char.charCodeAt(0) <= 32 || char.charCodeAt(0) === 127 || "%#/:<>?@[\\]^|\ufffd".includes(char)) {this.invalid = true; return;}
    if (char.length !== 1 || char.charCodeAt(0) > 127) {this.native = true; return;}
    if (this.native) return;
    char = char.toLowerCase();
    if (char === ".") {this.label(); return;}
    const digit = char >= "0" && char <= "9";
    if (this.prefix.length < 4) this.prefix += char;
    if (this.prefix === "xn--") {this.native = true; return;}
    this.digits &&= digit;
    const length = this.length; this.length = Math.min(2, length + 1);
    if (!length) {
      this.zero = char === "0"; this.valid = digit; this.value = digit ? char.charCodeAt(0) - 48 : 0;
      return;
    }
    if (length === 1 && this.zero) {
      if (char === "x") {this.radix = 16; this.value = 0; return;}
      this.radix = 8;
    }
    const number = digit ? char.charCodeAt(0) - 48 : char >= "a" && char <= "f" ? char.charCodeAt(0) - 87 : 16;
    this.valid &&= number < this.radix;
    if (this.valid) this.value = Math.min(0x100000000, this.value * this.radix + number);
  }
  private label(): void {
    if (this.count) this.previousValid &&= this.lastValid && this.lastValue <= 255 && !this.lastEmpty;
    this.count = Math.min(5, this.count + 1);
    this.lastValid = this.valid && this.length > 0; this.lastDigits = this.digits && this.length > 0;
    this.lastValue = this.value; this.lastEmpty = !this.length;
    this.prefix = ""; this.length = 0; this.zero = false; this.radix = 10; this.digits = this.valid = true; this.value = 0;
  }
  /** Consume the final label, ignoring exactly one trailing dot. */
  finish(): boolean | undefined {
    this.decode(false);
    if (this.invalid || this.escape || this.surrogate) return false;
    if (this.native) return undefined;
    if (this.length) this.label();
    if (!this.lastDigits && !this.lastValid) return true;
    return this.count <= 4 && this.previousValid && this.lastValid && this.lastValue < 256 ** (5 - this.count);
  }
}
