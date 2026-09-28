import type { CommandDefinition } from "../../../contracts/index.js";
import { command } from "safe-bash-checksum-engine";
import { createMd5sumCommand } from "../../md5sum/index.js";
import { createSha1sumCommand } from "../../sha1sum/index.js";
import { createSha256sumCommand } from "../../sha256sum/index.js";
import { resolveInputLimit, type ByteInputOptions } from "../input-budget.js";
export function createChecksumCommands(options: ByteInputOptions = {}): readonly CommandDefinition[] {
 const maximum = resolveInputLimit(options);
 return [command("sha512sum", "sha512", maximum), command("sha384sum", "sha384", maximum), createSha256sumCommand(options), command("sha224sum", "sha224", maximum), createSha1sumCommand(options), createMd5sumCommand(options), command("cksum", "crc", maximum)];
}

export function evalSyncChecksum(name: string, inBytes: Uint8Array, opArgs: readonly string[]): string | undefined {
  if (inBytes.byteLength > 16384) return undefined;
  if (name === "cksum") {
    if (opArgs.length > 1 || (opArgs.length === 1 && opArgs[0] !== "-")) return undefined;
    let crc = 0;
    for (let i = 0; i < inBytes.byteLength; i++) {
      crc = (crc << 8) ^ crcTable[((crc >>> 24) ^ inBytes[i]!) & 255]!;
    }
    for (let rem = BigInt(inBytes.byteLength); rem > 0n; rem >>= 8n) {
      crc = (crc << 8) ^ crcTable[((crc >>> 24) ^ Number(rem & 255n)) & 255]!;
    }
    return `${(~crc) >>> 0} ${inBytes.byteLength}\n`;
  }
  const alg = name === "md5sum" ? "md5" : name === "sha1sum" ? "sha1" : name === "sha224sum" ? "sha224" : name === "sha256sum" ? "sha256" : name === "sha384sum" ? "sha384" : name === "sha512sum" ? "sha512" : undefined;
  if (!alg) return undefined;
  let binary = false;
  let tag = false;
  let ended = false;
  const operands: string[] = [];
  for (let i = 0; i < opArgs.length; i++) {
    const a = opArgs[i]!;
    if (!ended && a === "--") { ended = true; continue; }
    if (!ended && (a === "-b" || a === "--binary")) { binary = true; continue; }
    if (!ended && (a === "-t" || a === "--text")) { binary = false; continue; }
    if (!ended && a === "--tag") { tag = true; continue; }
    if (!ended && a.startsWith("-") && a !== "-") return undefined;
    operands.push(a);
  }
  if (operands.length > 1 || (operands.length === 1 && operands[0] !== "-")) return undefined;
  const hex = bytesToHex(hashes[alg](inBytes));
  if (tag) return `${alg.toUpperCase()} (-) = ${hex}\n`;
  return `${hex} ${binary ? "*" : " "}-\n`;
}
