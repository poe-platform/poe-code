import { sha256 } from "@noble/hashes/sha2.js";
import { concatBytes } from "@noble/hashes/utils.js";
import { PublicDiagnostic } from "safe-bash-contracts/diagnostics";
import { Arguments, base64, Io, text, unbase64, unhex, utf8 } from "./io.js";

export async function encrypt(args: readonly string[], io: Io, maxIterations: number, maxPasswordBytes: number): Promise<void> {
  const a = new Arguments(args, "-aes-128-cbc -aes-256-cbc -aes-256-ctr -d -e -a -base64 -A -salt -nosalt -pbkdf2", "-k -pass -K -iv -S -iter -in -out");
  if (a.positional.length) throw new PublicDiagnostic("unexpected enc argument");
  const ciphers = ["-aes-128-cbc", "-aes-256-cbc", "-aes-256-ctr"].filter(c => a.has(c));
  if (ciphers.length !== 1) throw new PublicDiagnostic("select one supported AES cipher");
  const keyLength = ciphers[0] === "-aes-128-cbc" ? 16 : 32;
  const cipher = ciphers[0] === "-aes-256-ctr" ? "AES-CTR" : "AES-CBC";
  const decrypt = a.has("-d");
  const encoded = a.has("-a") || a.has("-base64");
  const iterations = a.integer("-iter", 10000, maxIterations);
  let password: string | undefined;
  if (a.has("-pass")) password = await io.password(a.get("-pass"));
  else if (a.has("-k")) password = a.get("-k");
  if (password !== undefined && utf8.encode(password).length > maxPasswordBytes) throw new PublicDiagnostic("password exceeds maximum password size");
  let input = await io.read(a.get("-in"));
  if (decrypt && encoded) input = unbase64(text.decode(input));
  const salted = !a.has("-nosalt") && !a.has("-K");
  let salt = new Uint8Array();
  if (salted) {
    if (a.has("-S")) {
      salt = unhex(a.get("-S"));
      if (salt.length !== 8) throw new PublicDiagnostic("salt must contain 8 bytes");
    } else if (decrypt) {
      if (input.length < 16 || text.decode(input.subarray(0, 8)) !== "Salted__") throw new PublicDiagnostic("bad magic number in encrypted input");
      salt = input.slice(8, 16);
      input = input.slice(16);
    } else salt = globalThis.crypto.getRandomValues(new Uint8Array(8));
  }
  let key: Uint8Array<ArrayBuffer>;
  let iv: Uint8Array<ArrayBuffer>;
  if (a.has("-K")) {
    key = unhex(a.get("-K"));
    iv = unhex(a.get("-iv"));
  } else {
    if (password === undefined) throw new PublicDiagnostic("password required: use -k or -pass");
    let derived: Uint8Array<ArrayBuffer>;
    if (a.has("-pbkdf2") || a.has("-iter")) {
      const base = await crypto.subtle.importKey("raw", utf8.encode(password), "PBKDF2", false, ["deriveBits"]);
      derived = new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, base, (keyLength + 16) * 8));
    } else {
      // OpenSSL 1.1+ EVP_BytesToKey defaults to SHA-256.
      const blocks: Uint8Array[] = [];
      let previous: Uint8Array = new Uint8Array();
      for (let size = 0; size < keyLength + 16; size += 32) {
        previous = sha256(concatBytes(previous, utf8.encode(password), salt));
        blocks.push(previous);
      }
      derived = new Uint8Array(concatBytes(...blocks));
    }
    key = derived.slice(0, keyLength);
    iv = a.has("-iv") ? unhex(a.get("-iv")) : derived.slice(keyLength, keyLength + 16);
  }
  if (key.length !== keyLength || iv.length !== 16) throw new PublicDiagnostic(`key must contain ${keyLength} bytes and IV 16 bytes`);
  io.context.signal.throwIfAborted();
  const operation = decrypt ? "decrypt" : "encrypt";
  const imported = await crypto.subtle.importKey("raw", key, cipher, false, [operation]);
  const algorithm = cipher === "AES-CTR" ? { name: cipher, counter: iv, length: 128 } : { name: cipher, iv };
  let result: Uint8Array = new Uint8Array(await crypto.subtle[operation](algorithm, imported, input));
  if (!decrypt && salted && !a.has("-S")) result = concatBytes(utf8.encode("Salted__"), salt, result);
  await io.write(!decrypt && encoded ? base64(result, !a.has("-A")) + (a.has("-A") ? "" : "\n") : result, a.get("-out"));
}
