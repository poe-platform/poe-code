import { md5 } from "@noble/hashes/legacy.js";
import { sha256, sha512 } from "@noble/hashes/sha2.js";
import { concatBytes } from "@noble/hashes/utils.js";
import { yieldTurn } from "safe-bash-contracts/yield";
import { PublicDiagnostic } from "safe-bash-contracts/diagnostics";

const alphabet = "./0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const encoder = new TextEncoder();

function repeat(bytes: Uint8Array, length: number): Uint8Array {
  return Uint8Array.from({ length }, (_, i) => bytes[i % bytes.length]!);
}

function encode(bytes: Uint8Array, groups: readonly (readonly number[])[]): string {
  let output = "";
  for (const [a, b, c, count = 4] of groups) {
    let word = ((bytes[a!] ?? 0) << 16) | ((bytes[b!] ?? 0) << 8) | (bytes[c!] ?? 0);
    for (let i = 0; i < count; i++, word >>>= 6) output += alphabet[word & 63];
  }
  return output;
}

/** The modular crypt formats used by OpenSSL passwd (not a raw password digest). */
export async function cryptPassword(password: string, saltInput: string, mode: string, signal: AbortSignal, maxIterations: number): Promise<string> {
  let rounds = mode === "1" || mode === "apr1" ? 1000 : 5000;
  let roundPrefix = "";
  if ((mode === "5" || mode === "6") && saltInput.startsWith("rounds=")) {
    const separator = saltInput.indexOf("$");
    const value = saltInput.slice(7, separator);
    if (separator < 0 || !value || Array.from(value).some(c => !"0123456789".includes(c))) throw new PublicDiagnostic("invalid crypt rounds");
    rounds = Math.max(1000, Number(value));
    roundPrefix = `rounds=${rounds}$`;
    saltInput = saltInput.slice(separator + 1);
  }
  if (!Number.isSafeInteger(rounds) || rounds > maxIterations) throw new PublicDiagnostic("password hash exceeds maximum iterations");
  const passwordBytes = encoder.encode(password);
  const salt = saltInput.split("$")[0]!.slice(0, mode === "1" || mode === "apr1" ? 8 : 16);
  const saltBytes = encoder.encode(salt);
  const magic = `$${mode}$`;
  const p = passwordBytes;
  if (mode === "1" || mode === "apr1") {
    const alternate = md5(concatBytes(p, saltBytes, p));
    const initial = [p, encoder.encode(magic), saltBytes, repeat(alternate, p.length)];
    for (let n = p.length; n > 0; n >>>= 1) initial.push(n & 1 ? new Uint8Array([0]) : p.slice(0, 1));
    let digest: Uint8Array = md5(concatBytes(...initial));
    for (let i = 0; i < 1000; i++) {
      digest = md5(concatBytes(i & 1 ? p : digest, ...(i % 3 ? [saltBytes] : []), ...(i % 7 ? [p] : []), i & 1 ? digest : p));
      if (i % 256 === 0) await yieldTurn(signal);
    }
    return `${magic}${salt}$${encode(digest, [[0,6,12],[1,7,13],[2,8,14],[3,9,15],[4,10,5],[-1,-1,11,2]])}`;
  }
  const hash = mode === "5" ? sha256 : sha512;
  const alternate = hash(concatBytes(p, saltBytes, p));
  const initial = [p, saltBytes, repeat(alternate, p.length)];
  for (let n = p.length; n > 0; n >>>= 1) initial.push(n & 1 ? alternate : p);
  let digest: Uint8Array = hash(concatBytes(...initial));
  const ph = hash.create();
  for (let i = 0; i < p.length; i++) ph.update(p);
  const sequenceP = repeat(ph.digest(), p.length);
  const sh = hash.create();
  for (let i = 0; i < 16 + digest[0]!; i++) sh.update(saltBytes);
  const sequenceS = repeat(sh.digest(), saltBytes.length);
  for (let i = 0; i < rounds; i++) {
    digest = hash(concatBytes(i & 1 ? sequenceP : digest, ...(i % 3 ? [sequenceS] : []), ...(i % 7 ? [sequenceP] : []), i & 1 ? digest : sequenceP));
    if (i % 256 === 0) await yieldTurn(signal);
  }
  const groups = mode === "5"
    ? [[0,10,20],[21,1,11],[12,22,2],[3,13,23],[24,4,14],[15,25,5],[6,16,26],[27,7,17],[18,28,8],[9,19,29],[-1,31,30,3]]
    : [[0,21,42],[22,43,1],[44,2,23],[3,24,45],[25,46,4],[47,5,26],[6,27,48],[28,49,7],[50,8,29],[9,30,51],[31,52,10],[53,11,32],[12,33,54],[34,55,13],[56,14,35],[15,36,57],[37,58,16],[59,17,38],[18,39,60],[40,61,19],[62,20,41],[-1,-1,63,2]];
  return `${magic}${roundPrefix}${salt}$${encode(digest, groups)}`;
}
