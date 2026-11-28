import { PublicDiagnostic } from "safe-bash-contracts/diagnostics";
import type { CommandContext } from "safe-bash-contracts";
import { output } from "safe-bash-io-engine/internal";
import { sources } from "./shared.js";

const symbols = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ.-:+=^!/*?&<>()[]{}@%$#";

export async function z85(context: CommandContext, files: readonly string[], decode: boolean, ignore: boolean, wrap: number, maxInputBytes: number): Promise<void> {
  let value = 0;
  let used = 0;
  let column = 0;
  const buffer = new Uint8Array(16384);
  let length = 0;
  const emit = (byte: number): void => {
    buffer[length++] = byte;
    if (!decode && wrap && ++column === wrap) { buffer[length++] = 10; column = 0; }
  };
  for await (const chunk of sources(context, files, maxInputBytes)) {
    for (const byte of chunk) {
      if (decode) {
        if (byte === 10 || byte === 13) continue;
        const digit = symbols.indexOf(String.fromCharCode(byte));
        if (digit < 0) {
          if (ignore) continue;
          if (length) await output(context, buffer.slice(0, length));
          throw new PublicDiagnostic("invalid input");
        }
        value = value * 85 + digit;
      } else value = value * 256 + byte;
      if (++used === (decode ? 5 : 4)) {
        if (decode) {
          if (value > 0xffffffff) {
            if (length) await output(context, buffer.slice(0, length));
            throw new PublicDiagnostic("invalid input");
          }
          for (let shift = 24; shift >= 0; shift -= 8) emit((value >>> shift) & 255);
        } else {
          for (let divisor = 85 ** 4; divisor >= 1; divisor /= 85) {
            emit(symbols.charCodeAt(Math.floor(value / divisor)));
            value %= divisor;
          }
        }
        value = 0;
        used = 0;
      }
      if (length >= 16000) { await output(context, buffer.slice(0, length)); length = 0; }
    }
    if (length) { await output(context, buffer.slice(0, length)); length = 0; }
  }
  if (used) throw new PublicDiagnostic(decode ? "invalid input" : "invalid input (length must be multiple of 4 characters)");
  if (!decode && wrap && column) await output(context, new Uint8Array([10]));
}
