import { PublicDiagnostic } from "../../diagnostics.js";
import { EreLedger } from "./ere/limits.js";

function invalidUtf8(): never {
  throw new PublicDiagnostic("bounded regex unsupported: literal patterns and subjects require valid non-NUL UTF-8 bytes");
}

export async function validateUtf8(input: Uint8Array | string, ledger: EreLedger, signal?: AbortSignal): Promise<void> {
  for (let index = 0; index < input.length;) {
    const first = typeof input === "string" ? input.charCodeAt(index) : input[index]!;
    const width = first < 0x80 ? 1 : first >= 0xc2 && first <= 0xdf ? 2
      : first >= 0xe0 && first <= 0xef ? 3 : first >= 0xf0 && first <= 0xf4 ? 4 : 0;
    ledger.charge("work", Math.max(width, 1), signal);
    if (first === 0 || width === 0 || width > input.length - index) invalidUtf8();
    for (let continuation = 1; continuation < width; continuation++) {
      const byte = typeof input === "string" ? input.charCodeAt(index + continuation) : input[index + continuation]!;
      if (byte < 0x80 || byte > 0xbf || continuation === 1 && (
        first === 0xe0 && byte < 0xa0 || first === 0xed && byte > 0x9f
        || first === 0xf0 && byte < 0x90 || first === 0xf4 && byte > 0x8f
      )) invalidUtf8();
    }
    index += width;
    await ledger.checkpoint(signal);
  }
}

