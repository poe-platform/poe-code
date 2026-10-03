const ASCII7_COMPAT_MAP: Readonly<Record<string, string>> = {
  "\uFB00": "ff",
  "\uFB01": "fi",
  "\uFB02": "fl",
  "\uFB03": "ffi",
  "\uFB04": "ffl",
  "\u2018": "'",
  "\u2019": "'",
  "\u201C": "\"",
  "\u201D": "\"",
  "\u2013": "-",
  "\u2014": "--",
  "\u2026": "...",
  "\u00A0": " "
};

export function encodeUcs2(text: string): Uint8Array {
  const bytes = new Uint8Array(2 + text.length * 2);
  const view = new DataView(bytes.buffer);
  view.setUint16(0, 0xfeff);
  for (let i = 0; i < text.length; i++) view.setUint16(2 + i * 2, text.charCodeAt(i));
  return bytes;
}

export function applyPopplerOutputEncoding(text: string, encoding: string): string {
  if (!encoding || encoding === "UTF-8" || encoding === "UCS-2") return text;
  if (encoding === "ASCII7") {
    let out = "";
    const normalized = text.normalize("NFKD");
    for (let i = 0; i < normalized.length; i++) {
      const ch = normalized[i]!;
      const mapped = ASCII7_COMPAT_MAP[ch];
      if (mapped !== undefined) {
        out += mapped;
        continue;
      }
      const code = ch.charCodeAt(0);
      if (code >= 0x0300 && code <= 0x036f) continue;
      if (code <= 0x7f) out += ch;
    }
    return out;
  }
  if (encoding === "Latin1") {
    let out = "";
    for (let i = 0; i < text.length; i++) {
      const ch = text[i]!;
      const mapped = ASCII7_COMPAT_MAP[ch];
      if (mapped !== undefined) {
        out += mapped;
        continue;
      }
      const code = ch.charCodeAt(0);
      if (code <= 0xff) out += ch;
    }
    return out;
  }
  return text;
}

export async function* encodePopplerChunks(input: AsyncIterable<Uint8Array>, encoding: string, eol: "unix" | "dos" | "mac"): AsyncGenerator<Uint8Array, void, void> {
  const decoder = new TextDecoder(), encoder = new TextEncoder();
  const ending = eol === "dos" ? "\r\n" : eol === "mac" ? "\r" : "\n";
  if (encoding === "UCS-2") yield new Uint8Array([0xfe, 0xff]);
  function convert(text: string): Uint8Array {
    const value = applyPopplerOutputEncoding(ending === "\n" ? text : text.replaceAll("\n", ending), encoding);
    return encoding === "Latin1" ? Uint8Array.from(value, character => character.charCodeAt(0))
      : encoding === "UCS-2" ? encodeUcs2(value).subarray(2) : encoder.encode(value);
  }
  for await (const chunk of input) {
    const bytes = convert(decoder.decode(chunk, { stream: true })); if (bytes.length) yield bytes;
  }
  const final = convert(decoder.decode()); if (final.length) yield final;
}
