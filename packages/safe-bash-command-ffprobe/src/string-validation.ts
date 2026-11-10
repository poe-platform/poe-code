/** Keep malformed bytes as unpaired low surrogates until the writer chooses a policy. */
export class ProbeTextDecoder {
  private pending = new Uint8Array(0);
  private first = true;
  constructor(private readonly ignoreBOM = false) {}
  decode(input: Uint8Array = new Uint8Array(0), options: { stream?: boolean } = {}): string {
    const bytes = new Uint8Array(this.pending.length + input.length);
    bytes.set(this.pending); bytes.set(input, this.pending.length); this.pending = new Uint8Array(0);
    let text = "";
    for (let at = 0; at < bytes.length;) {
      const first = bytes[at]!;
      const width = first < 128 ? 1 : first >= 0xc2 && first <= 0xdf ? 2
        : first >= 0xe0 && first <= 0xef ? 3 : first >= 0xf0 && first <= 0xf4 ? 4 : 0;
      let valid = width > 0;
      for (let i = 1; valid && i < width && at + i < bytes.length; i++) {
        const byte = bytes[at + i]!;
        valid = byte >= 0x80 && byte <= 0xbf && !(i === 1 && (
          first === 0xe0 && byte < 0xa0 || first === 0xed && byte >= 0xa0 ||
          first === 0xf0 && byte < 0x90 || first === 0xf4 && byte >= 0x90));
      }
      if (valid && at + width > bytes.length) {
        if (options.stream) { this.pending = bytes.slice(at); break; }
        valid = false;
      }
      let code = valid ? width === 1 ? first : first & (0x7f >> width) : 0xdc00 + first;
      if (valid) for (let i = 1; i < width; i++) code = code * 64 + (bytes[at + i]! & 63);
      if (!this.first || this.ignoreBOM || code !== 0xfeff) text += String.fromCodePoint(code);
      this.first = false; at += valid ? width : 1;
    }
    return text;
  }
}

export function encodeProbeText(text: string): Uint8Array {
  const bytes = new Uint8Array(text.length * 3), encoder = new TextEncoder();
  let at = 0, start = 0, offset = 0;
  for (const character of text) {
    const code = character.codePointAt(0)!;
    if (code >= 0xdc80 && code <= 0xdcff) {
      at += encoder.encodeInto(text.slice(start, offset), bytes.subarray(at)).written;
      bytes[at++] = code - 0xdc00; start = offset + 1;
    }
    offset += character.length;
  }
  at += encoder.encodeInto(text.slice(start), bytes.subarray(at)).written;
  return bytes.subarray(0, at);
}

/** JSON escaping must leave surrogate-escaped bytes for the output encoder. */
export function probeJsonString(text: string): string {
  let output = '"', start = 0, offset = 0;
  for (const character of text) {
    const code = character.codePointAt(0)!;
    if (code >= 0xdc80 && code <= 0xdcff) {
      output += JSON.stringify(text.slice(start, offset)).slice(1, -1) + character;
      start = offset + 1;
    }
    offset += character.length;
  }
  return output + JSON.stringify(text.slice(start)).slice(1, -1) + '"';
}

export function stringValidationOption(key: string, value: string): boolean {
  if (key === "sv" || key === "string_validation") {
    if (!["fail", "replace", "ignore"].includes(value)) throw new Error(`Invalid string validation mode ${value}`);
    return true;
  }
  return key === "svr" || key === "string_validation_replacement";
}

type Text = string | (() => Iterable<string> | AsyncIterable<string>);
export class StringValidation {
  readonly mode: string;
  readonly requested: boolean;
  readonly replacement: string;
  failed = false;
  constructor(writer: string) {
    const settings = new Map<string, string>();
    const start = Math.min(...[writer.indexOf("="), writer.indexOf(":")].filter(at => at >= 0));
    for (const option of Number.isFinite(start) ? writer.slice(start + 1).split(":") : []) {
      const equal = option.indexOf("="), key = option.slice(0, equal), value = option.slice(equal + 1);
      if (stringValidationOption(key, value)) settings.set(key === "sv" ? "string_validation" : key === "svr" ? "string_validation_replacement" : key, value);
    }
    this.requested = settings.size > 0;
    this.mode = settings.get("string_validation") ?? "replace";
    this.replacement = settings.get("string_validation_replacement") ?? "�";
  }
  async accepts(...values: Text[]): Promise<boolean> {
    if (this.mode !== "fail") return true;
    for (const value of values) for await (const part of typeof value === "string" ? [value] : value()) {
      for (const character of part) {
        const code = character.codePointAt(0)!;
        if (code >= 0xdc80 && code <= 0xdcff) { this.failed = true; return false; }
      }
    }
    return true;
  }
  replace(text: string): string {
    if (this.mode !== "replace") return text;
    let output = "";
    for (const character of text) {
      const code = character.codePointAt(0)!;
      output += code >= 0xdc80 && code <= 0xdcff ? this.replacement : character;
    }
    return output;
  }
  async *text(value: Text): AsyncGenerator<string> {
    for await (const part of typeof value === "string" ? [value] : value()) yield this.replace(part);
  }
}
