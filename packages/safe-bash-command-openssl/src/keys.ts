import { concatBytes } from "@noble/hashes/utils.js";
import { PublicDiagnostic } from "safe-bash-contracts/diagnostics";
import { Arguments, der, hex, Io, pem, text, unbase64, unhex } from "./io.js";

export function sequence(...items: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const body = concatBytes(...items);
  const length: number[] = [];
  for (let n = body.length; n > 0; n = Math.floor(n / 256)) length.unshift(n & 255);
  return new Uint8Array(concatBytes(new Uint8Array([0x30, ...(body.length < 128 ? [body.length] : [0x80 | length.length, ...length])]), body));
}

function octets(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const wrapped = sequence(bytes);
  wrapped[0] = 4;
  return wrapped;
}

const curves: Record<string, { name: string; oid: string }> = {
  prime256v1: { name: "P-256", oid: "06082a8648ce3d030107" },
  "P-256": { name: "P-256", oid: "06082a8648ce3d030107" },
  secp384r1: { name: "P-384", oid: "06052b81040022" },
  "P-384": { name: "P-384", oid: "06052b81040022" },
  secp521r1: { name: "P-521", oid: "06052b81040023" },
  "P-521": { name: "P-521", oid: "06052b81040023" },
};
const rsaAlgorithm = unhex("300d06092a864886f70d0101010500");

function derFields(bytes: Uint8Array): Uint8Array[] {
  let offset = 1;
  const length = (): number => {
    const first = bytes[offset++];
    if (first === undefined) throw new PublicDiagnostic("invalid DER length");
    if (first < 128) return first;
    const count = first & 127;
    if (!count || count > 4 || bytes[offset] === 0) throw new PublicDiagnostic("invalid DER length");
    let n = 0;
    for (let i = 0; i < count; i++) {
      const byte = bytes[offset++];
      if (byte === undefined) throw new PublicDiagnostic("truncated DER");
      n = n * 256 + byte;
    }
    if (n < 128) throw new PublicDiagnostic("noncanonical DER length");
    return n;
  };
  if (bytes[0] !== 48) throw new PublicDiagnostic("expected DER sequence");
  const total = length();
  if (total !== bytes.length - offset) throw new PublicDiagnostic("invalid DER sequence");
  const fields: Uint8Array[] = [];
  while (offset < bytes.length) {
    const start = offset++;
    const n = length();
    offset += n;
    if (offset > bytes.length) throw new PublicDiagnostic("truncated DER field");
    fields.push(bytes.slice(start, offset));
    if (fields.length > 16) throw new PublicDiagnostic("too many DER key fields");
  }
  return fields;
}

export async function importKey(input: Uint8Array, format = "PEM", publicKey = false, hash = "SHA-256"): Promise<CryptoKey> {
  let bytes = der(input, format);
  let label = format === "PEM" ? text.decode(input).split("\n")[0]! : "";
  if (format === "DER") {
    const fields = derFields(bytes);
    if (fields[0]?.[0] === 2 && fields[1]?.[0] === 2) label = publicKey ? "RSA PUBLIC KEY" : "RSA PRIVATE KEY";
    else if (fields[0]?.[0] === 2 && fields[1]?.[0] === 4) label = "EC PRIVATE KEY";
  }
  if (label.includes("RSA PRIVATE KEY")) bytes = sequence(unhex("020100"), rsaAlgorithm, octets(bytes));
  if (label.includes("RSA PUBLIC KEY")) {
    const bitString = sequence(new Uint8Array([0]), bytes);
    bitString[0] = 3;
    bytes = sequence(rsaAlgorithm, bitString);
  }
  const algorithms: AlgorithmIdentifier[] = [
    { name: "RSASSA-PKCS1-v1_5", hash } as RsaHashedImportParams,
    { name: "Ed25519" },
    ...["P-256", "P-384", "P-521"].map(namedCurve => ({ name: "ECDSA", namedCurve } as EcKeyImportParams)),
  ];
  for (const algorithm of algorithms) {
    try {
      let encoded = bytes;
      if (label.includes("EC PRIVATE KEY")) {
        const curve = Object.values(curves).find(c => c.name === (algorithm as EcKeyImportParams).namedCurve);
        if (!curve) continue;
        encoded = sequence(unhex("020100"), sequence(unhex("06072a8648ce3d0201"), unhex(curve.oid)), octets(bytes));
      }
      return await crypto.subtle.importKey(publicKey ? "spki" : "pkcs8", encoded, algorithm, true, [publicKey ? "verify" : "sign"]);
    } catch { /* Try the other supported, explicitly named key algorithms. */ }
  }
  throw new PublicDiagnostic("could not read a supported key");
}

export async function publicPart(privateKey: CryptoKey): Promise<CryptoKey> {
  const jwk = await crypto.subtle.exportKey("jwk", privateKey);
  for (const name of ["d", "p", "q", "dp", "dq", "qi"] as const) delete jwk[name];
  jwk.key_ops = ["verify"];
  return crypto.subtle.importKey("jwk", jwk, privateKey.algorithm, true, ["verify"]);
}

export async function generate(algorithm: string, bits: number, curve: string, maxBits: number): Promise<CryptoKeyPair> {
  if (algorithm === "RSA") {
    if (!Number.isSafeInteger(bits) || bits < 512 || bits > maxBits || bits % 8) throw new PublicDiagnostic(`RSA size must be a multiple of 8 from 512 to ${maxBits}`);
    return crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: bits, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
  }
  if (algorithm === "EC") {
    const selected = curves[curve];
    if (!selected) throw new PublicDiagnostic(`unsupported curve: ${curve}`);
    return crypto.subtle.generateKey({ name: "ECDSA", namedCurve: selected.name }, true, ["sign", "verify"]);
  }
  if (algorithm === "ED25519") return crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]) as Promise<CryptoKeyPair>;
  throw new PublicDiagnostic(`unsupported key algorithm: ${algorithm}`);
}

export function signingAlgorithm(key: CryptoKey, hash = "SHA-256"): Algorithm | EcdsaParams {
  return key.algorithm.name === "ECDSA" ? { name: "ECDSA", hash } : key.algorithm;
}

// Web Crypto represents ECDSA signatures as r||s; OpenSSL uses ASN.1 integers.
export function ecdsaDer(raw: Uint8Array): Uint8Array<ArrayBuffer> {
  const integer = (value: Uint8Array): Uint8Array => {
    let first = 0;
    while (first + 1 < value.length && value[first] === 0) first++;
    const body = value.slice(first);
    const encoded = sequence(...(body[0]! & 128 ? [new Uint8Array([0]), body] : [body]));
    encoded[0] = 2;
    return encoded;
  };
  return sequence(integer(raw.slice(0, raw.length / 2)), integer(raw.slice(raw.length / 2)));
}

export function ecdsaRaw(encoded: Uint8Array, size: number): Uint8Array<ArrayBuffer> {
  let offset = 0;
  const length = (): number => {
    const first = encoded[offset++]!;
    if (first < 128) return first;
    const count = first & 127;
    if (!count || count > 2 || encoded[offset] === 0) throw new PublicDiagnostic("invalid signature");
    let n = 0;
    for (let i = 0; i < count; i++) n = n * 256 + encoded[offset++]!;
    if (!Number.isSafeInteger(n) || n < 128) throw new PublicDiagnostic("invalid signature");
    return n;
  };
  if (encoded[offset++] !== 48) throw new PublicDiagnostic("invalid signature");
  const total = length();
  if (total !== encoded.length - offset) throw new PublicDiagnostic("invalid signature");
  const result = new Uint8Array(size * 2);
  for (let i = 0; i < 2; i++) {
    if (encoded[offset++] !== 2) throw new PublicDiagnostic("invalid signature");
    const n = length();
    let value = encoded.slice(offset, offset + n);
    offset += n;
    if (!n || !value.length || value[0]! & 128 || value.length > 1 && value[0] === 0 && !(value[1]! & 128)) throw new PublicDiagnostic("invalid signature integer");
    if (value[0] === 0) value = value.slice(1);
    if (value.length > size || offset > encoded.length) throw new PublicDiagnostic("invalid signature");
    result.set(value, (i + 1) * size - value.length);
  }
  if (offset !== encoded.length) throw new PublicDiagnostic("invalid signature");
  return result;
}

export async function keys(sub: string, args: readonly string[], io: Io, maxBits: number): Promise<void> {
  const a = new Arguments(args, "-pubout -pubin -noout -text -modulus -check -genkey -noenc -nodes", "-in -out -inform -outform -algorithm -pkeyopt -name");
  const generating = ["genrsa", "genpkey", "ecparam"].includes(sub);
  let key: CryptoKey;
  if (generating) {
    let bits = Number(a.positional[0] ?? 2048);
    let curve = a.get("-name", "prime256v1");
    for (const option of a.values.get("-pkeyopt") ?? []) {
      if (option.startsWith("rsa_keygen_bits:")) bits = Number(option.slice(16));
      else if (option.startsWith("ec_paramgen_curve:")) curve = option.slice(18);
      else throw new PublicDiagnostic(`unsupported key option: ${option}`);
    }
    if (sub === "ecparam" && !a.has("-genkey")) {
      const selected = curves[curve];
      if (!selected) throw new PublicDiagnostic(`unsupported curve: ${curve}`);
      if (a.has("-text")) await io.write(`ASN1 OID: ${curve}\n`);
      if (!a.has("-noout")) await io.write(a.get("-outform", "PEM") === "DER" ? unhex(selected.oid) : pem("EC PARAMETERS", unhex(selected.oid)), a.get("-out"));
      return;
    }
    const pair = await generate(a.get("-algorithm", sub === "ecparam" ? "EC" : "RSA").toUpperCase(), bits, curve, maxBits);
    key = pair.privateKey;
  } else {
    if (a.positional.length) throw new PublicDiagnostic("unexpected key argument");
    key = await importKey(await io.read(a.get("-in")), a.get("-inform", "PEM"), a.has("-pubin"));
  }
  if (sub === "rsa" && key.algorithm.name !== "RSASSA-PKCS1-v1_5") throw new PublicDiagnostic("not an RSA key");
  if (sub === "ec" && key.algorithm.name !== "ECDSA") throw new PublicDiagnostic("not an EC key");
  if (a.has("-pubout") && key.type === "private") key = await publicPart(key);
  const jwk = await crypto.subtle.exportKey("jwk", key);
  const lines: string[] = [];
  if (a.has("-check")) lines.push("Key is valid");
  if (a.has("-text")) {
    const bits = (key.algorithm as RsaKeyAlgorithm).modulusLength ?? (key.algorithm as EcKeyAlgorithm).namedCurve ?? "Ed25519";
    lines.push(`${key.type === "private" ? "Private" : "Public"}-Key: (${bits}${typeof bits === "number" ? " bit" : ""})`);
    for (const [label, field] of [["modulus", "n"], ["publicExponent", "e"], ["privateExponent", "d"], ["prime1", "p"], ["prime2", "q"], ["exponent1", "dp"], ["exponent2", "dq"], ["coefficient", "qi"], ["x", "x"], ["y", "y"]] as const) {
      if (jwk[field]) lines.push(`${label}: ${hex(unbase64(jwk[field]!))}`);
    }
  }
  if (a.has("-modulus")) {
    if (!jwk.n) throw new PublicDiagnostic("modulus is only available for RSA keys");
    lines.push(`Modulus=${hex(unbase64(jwk.n)).toUpperCase()}`);
  }
  let output: Uint8Array | string = lines.length ? `${lines.join("\n")}\n` : "";
  if (!a.has("-noout") || sub === "ecparam" && a.has("-genkey")) {
    const encoded = new Uint8Array(await crypto.subtle.exportKey(key.type === "public" ? "spki" : "pkcs8", key));
    const format = a.get("-outform", "PEM");
    if (format !== "PEM" && format !== "DER") throw new PublicDiagnostic("format must be PEM or DER");
    if (format === "DER") {
      if (output) await io.write(output);
      output = encoded;
    } else output += pem(key.type === "public" ? "PUBLIC KEY" : "PRIVATE KEY", encoded);
  }
  if (output.length) await io.write(output, a.get("-out"));
}
