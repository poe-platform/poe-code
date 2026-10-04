import type { PagedStorage } from "@poe-code/safe-fs/storage";
import { yieldTurn } from "safe-bash-contracts/yield";
import type { SofficeSnapshot } from "./retained-input.js";

/** Unicode default lowercase with final-sigma context retained across chunks. */
export async function retainLower(storage: PagedStorage, source: AsyncIterable<Uint8Array>, signal: AbortSignal): Promise<SofficeSnapshot> {
  const position = storage.allocate(0), decoder = new TextDecoder("utf-8", { ignoreBOM: true }), encoder = new TextEncoder();
  let size = 0, buffer = "", cased = false, sigma = -1, work = 0;
  const flush = async () => { if (buffer) { const bytes = encoder.encode(buffer); await storage.append(bytes); size += bytes.length; buffer = ""; } };
  const finalize = async () => { await storage.write(sigma, encoder.encode("ς")); sigma = -1; };
  const consume = async (text: string) => {
    for (const char of text) {
      // Native context probes distinguish cased, case-ignorable, and other
      // characters using the same Unicode version as String.toLowerCase.
      const active = ("." + char + "Σ").toLowerCase().endsWith("ς");
      const ignorable = !active && ("A" + char + "Σ").toLowerCase().endsWith("ς");
      if (!ignorable && sigma >= 0) { if (!active) await finalize(); else sigma = -1; }
      if (char === "Σ" && cased) { await flush(); sigma = position + size; buffer = "σ"; await flush(); }
      else buffer += char.toLowerCase();
      if (!ignorable) cased = active;
      if (buffer.length >= 4096) await flush();
    }
  };
  for await (const bytes of source) {
    signal.throwIfAborted(); await consume(decoder.decode(bytes, { stream: true }));
    work += bytes.length; if (work >= 16384) { work = 0; await yieldTurn(signal); }
  }
  await consume(decoder.decode()); if (sigma >= 0) await finalize(); await flush();
  return { position, size };
}
