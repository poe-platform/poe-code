/** glibc SHIFT_JIS is JIS X 0201/0208, not WHATWG's Windows-31J.
 * Keep one pending lead byte; g_convert accepts a truncated final character.
 */
export function shiftJisDecoder(): (bytes: Uint8Array) => string {
  const decoder = new TextDecoder("shift_jis", { fatal: true });
  const pair = new Uint8Array(2);
  let lead: number | undefined;
  return bytes => {
    let text = "";
    for (const byte of bytes) {
      if (lead !== undefined) {
        const code = lead * 256 + byte;
        if (byte < 0x40 || code > 0x84be && code < 0x889f || code > 0x88fc && code < 0x8940 ||
          code > 0x9ffc && code < 0xe040 || code > 0xeaa4) throw new TypeError("Invalid Shift-JIS");
        pair[0] = lead; pair[1] = byte; lead = undefined;
        // The remaining assigned JIS pairs match WHATWG except these six.
        switch (code) {
          case 0x8160: text += "〜"; break;
          case 0x8161: text += "‖"; break;
          case 0x817c: text += "−"; break;
          case 0x8191: text += "¢"; break;
          case 0x8192: text += "£"; break;
          case 0x81ca: text += "¬"; break;
          default: text += decoder.decode(pair);
        }
      } else if (byte < 0x80) {
        text += byte === 0x5c ? "¥" : byte === 0x7e ? "‾" : String.fromCharCode(byte);
      } else if (byte >= 0xa1 && byte <= 0xdf) {
        text += String.fromCharCode(byte + 0xfec0);
      } else if (byte >= 0x81 && byte <= 0xea && byte !== 0xa0) {
        lead = byte;
      } else throw new TypeError("Invalid Shift-JIS");
    }
    return text;
  };
}
