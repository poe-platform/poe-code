import "reflect-metadata/lite";
import {
  BasicConstraintsExtension, ExtendedKeyUsage, ExtendedKeyUsageExtension, KeyUsageFlags,
  KeyUsagesExtension, Pkcs10CertificateRequest, Pkcs10CertificateRequestGenerator,
  SubjectAlternativeNameExtension, SubjectKeyIdentifierExtension, X509Certificate,
  X509CertificateGenerator, type Extension, type GeneralNameType, type JsonName,
} from "@peculiar/x509";
import { PublicDiagnostic } from "safe-bash-contracts/diagnostics";
import { Arguments, der, Io, pem } from "./io.js";
import { generate, importKey, publicPart, signingAlgorithm } from "./keys.js";

function subject(value: string): JsonName {
  if (!value.startsWith("/")) throw new PublicDiagnostic("subject must use /name=value notation");
  const fields: string[] = [];
  let field = "";
  let escaped = false;
  for (const c of value.slice(1)) {
    if (escaped) { field += c; escaped = false; }
    else if (c === "\\") escaped = true;
    else if (c === "/") { fields.push(field); field = ""; }
    else field += c;
  }
  if (escaped) throw new PublicDiagnostic("incomplete subject escape");
  fields.push(field);
  return fields.filter(Boolean).map(part => {
    const separator = part.indexOf("=");
    if (separator < 1) throw new PublicDiagnostic("invalid subject attribute");
    return { [part.slice(0, separator)]: [part.slice(separator + 1)] };
  });
}

const extensionIds: Record<string, string> = {
  subjectAltName: "2.5.29.17", basicConstraints: "2.5.29.19", keyUsage: "2.5.29.15",
  extendedKeyUsage: "2.5.29.37", subjectKeyIdentifier: "2.5.29.14", authorityKeyIdentifier: "2.5.29.35",
};

async function extensions(values: string[], publicKey: CryptoKey): Promise<Extension[]> {
  const result: Extension[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const separator = value.indexOf("=");
    const name = value.slice(0, separator).trim();
    if (separator < 0 || seen.has(name)) throw new PublicDiagnostic("invalid or duplicate extension");
    seen.add(name);
    const parts = value.slice(separator + 1).split(",").map(p => p.trim());
    const critical = parts[0] === "critical";
    if (critical) parts.shift();
    if (name === "subjectAltName") {
      const types: Record<string, GeneralNameType> = { DNS: "dns", IP: "ip", URI: "url", email: "email", RID: "id" };
      result.push(new SubjectAlternativeNameExtension(parts.map(part => {
        const colon = part.indexOf(":");
        const type = types[part.slice(0, colon)];
        if (!type || colon < 0) throw new PublicDiagnostic(`unsupported subject alternative name: ${part}`);
        return { type, value: part.slice(colon + 1) };
      }), critical));
    } else if (name === "basicConstraints") {
      if (!parts.some(p => p === "CA:TRUE" || p === "CA:FALSE")) throw new PublicDiagnostic("basicConstraints requires CA:TRUE or CA:FALSE");
      const path = parts.find(p => p.startsWith("pathlen:"));
      const pathLength = path === undefined ? undefined : Number(path.slice(8));
      if (pathLength !== undefined && (!Number.isSafeInteger(pathLength) || pathLength < 0)) throw new PublicDiagnostic("invalid path length");
      result.push(new BasicConstraintsExtension(parts.includes("CA:TRUE"), pathLength, critical));
    } else if (name === "keyUsage") {
      let flags = 0;
      for (const part of parts) {
        const flag = KeyUsageFlags[part as keyof typeof KeyUsageFlags];
        if (typeof flag !== "number") throw new PublicDiagnostic(`unsupported key usage: ${part}`);
        flags |= flag;
      }
      result.push(new KeyUsagesExtension(flags, critical));
    } else if (name === "extendedKeyUsage") {
      result.push(new ExtendedKeyUsageExtension(parts.map(part => {
        const oid = ExtendedKeyUsage[part as keyof typeof ExtendedKeyUsage];
        if (!oid) throw new PublicDiagnostic(`unsupported extended key usage: ${part}`);
        return oid;
      }), critical));
    } else if (name === "subjectKeyIdentifier" && parts[0] === "hash") {
      result.push(await SubjectKeyIdentifierExtension.create(publicKey, critical, crypto));
    } else throw new PublicDiagnostic(`unsupported extension: ${name}`);
  }
  return result;
}

function date(value: Date): string {
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${months[value.getUTCMonth()]} ${String(value.getUTCDate()).padStart(2, " ")} ${value.toISOString().slice(11, 19)} ${value.getUTCFullYear()} GMT`;
}

export async function certificates(sub: string, args: readonly string[], io: Io, maxBits: number): Promise<number> {
  const a = new Arguments(args, "-new -x509 -nodes -noenc -noout -text -subject -issuer -dates -startdate -enddate -serial -fingerprint -sha1 -sha256 -sha384 -sha512 -verify", "-key -keyout -newkey -days -subj -addext -in -out -inform -outform -ext -checkend");
  if (a.positional.length) throw new PublicDiagnostic("unexpected certificate argument");
  const hash = a.has("-sha512") ? "SHA-512" : a.has("-sha384") ? "SHA-384" : a.has("-sha1") ? "SHA-1" : "SHA-256";
  let object: X509Certificate | Pkcs10CertificateRequest;
  if (a.has("-new") || sub === "req" && (a.has("-x509") || a.has("-newkey"))) {
    let pair: CryptoKeyPair;
    if (a.has("-key")) {
      const privateKey = await importKey(await io.read(a.get("-key")), "PEM", false, hash);
      pair = { privateKey, publicKey: await publicPart(privateKey) };
    } else {
      const requested = a.get("-newkey", "rsa:2048").split(":");
      pair = await generate(requested[0]!.toUpperCase(), Number(requested[1] ?? 2048), requested[1] ?? "prime256v1", maxBits);
    }
    if (!a.has("-subj")) throw new PublicDiagnostic("-subj is required for noninteractive requests");
    const name = subject(a.get("-subj"));
    const requestedExtensions = await extensions(a.values.get("-addext") ?? [], pair.publicKey);
    const algorithm = signingAlgorithm(pair.privateKey, hash);
    if (sub === "x509" || a.has("-x509")) {
      const days = a.integer("-days", 30, 365000);
      const notBefore = new Date(Math.floor(Date.now() / 1000) * 1000);
      object = await X509CertificateGenerator.createSelfSigned({ name, keys: pair, notBefore, notAfter: new Date(notBefore.getTime() + days * 86400000), extensions: requestedExtensions, signingAlgorithm: algorithm }, crypto);
    } else object = await Pkcs10CertificateRequestGenerator.create({ name, keys: pair, extensions: requestedExtensions, signingAlgorithm: algorithm }, crypto);
    if (a.has("-keyout")) await io.write(pem("PRIVATE KEY", new Uint8Array(await crypto.subtle.exportKey("pkcs8", pair.privateKey))), a.get("-keyout"));
  } else {
    const input = der(await io.read(a.get("-in")), a.get("-inform", "PEM"));
    const parseOptions = { berOptions: { maxDepth: 32, maxNodes: 10000, maxContentLength: io.maxBytes } };
    object = sub === "req" ? new Pkcs10CertificateRequest(input, parseOptions) : new X509Certificate(input, parseOptions);
  }
  const lines: string[] = [];
  if (a.has("-verify") && object instanceof Pkcs10CertificateRequest) {
    if (!await object.verify(crypto)) throw new PublicDiagnostic("Certificate request self-signature verify failure");
    await io.context.stderr.write(new TextEncoder().encode("Certificate request self-signature verify OK\n"));
  }
  if (a.has("-text")) lines.push(object.toString("text"));
  const displayName = (name: typeof object.subjectName): string => name.toJSON().flatMap(part => Object.entries(part).flatMap(([key, values]) => values.map(value => `${key}=${value}`))).join(", ");
  if (a.has("-subject")) lines.push(`subject=${displayName(object.subjectName)}`);
  let exitCode = 0;
  if (object instanceof X509Certificate) {
    if (a.has("-issuer")) lines.push(`issuer=${displayName(object.issuerName)}`);
    if (a.has("-dates") || a.has("-startdate")) lines.push(`notBefore=${date(object.notBefore)}`);
    if (a.has("-dates") || a.has("-enddate")) lines.push(`notAfter=${date(object.notAfter)}`);
    if (a.has("-serial")) lines.push(`serial=${object.serialNumber.toUpperCase()}`);
    if (a.has("-fingerprint")) {
      const fpHash = ["-sha1", "-sha256", "-sha384", "-sha512"].some(flag => a.has(flag)) ? hash : "SHA-1";
      const digest = new Uint8Array(await object.getThumbprint(fpHash, crypto));
      const explicitHash = ["-sha1", "-sha256", "-sha384", "-sha512"].some(flag => a.has(flag));
      lines.push(`${explicitHash ? fpHash.toLowerCase().split("-").join("") : "SHA1"} Fingerprint=${Array.from(digest, b => b.toString(16).padStart(2, "0").toUpperCase()).join(":")}`);
    }
    if (a.has("-ext")) {
      for (const name of a.get("-ext").split(",")) {
        const extension = object.getExtension(extensionIds[name] ?? name);
        if (extension) lines.push(extension.toString("text"));
      }
    }
    if (a.has("-checkend")) {
      const seconds = Number(a.get("-checkend"));
      if (!Number.isSafeInteger(seconds) || seconds < 0) throw new PublicDiagnostic("invalid checkend interval");
      exitCode = object.notAfter.getTime() <= Date.now() + seconds * 1000 ? 1 : 0;
      lines.push(exitCode ? "Certificate will expire" : "Certificate will not expire");
    }
  }
  let output: string | Uint8Array = lines.length ? `${lines.join("\n")}\n` : "";
  if (!a.has("-noout") && !a.has("-checkend")) {
    const format = a.get("-outform", "PEM");
    if (format === "DER") {
      if (output) await io.write(output);
      output = new Uint8Array(object.rawData);
    } else if (format === "PEM") output += `${object.toString("pem")}\n`;
    else throw new PublicDiagnostic("format must be PEM or DER");
  }
  if (output.length) await io.write(output, a.get("-out"));
  return exitCode;
}
