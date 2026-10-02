import { md5, sha1 } from "@noble/hashes/legacy.js";
import { sha256, sha384, sha512 } from "@noble/hashes/sha2.js";
import { hmac } from "@noble/hashes/hmac.js";
import { concatBytes } from "@noble/hashes/utils.js";
import { commandRuntimeIdentity, getCommandArguments, writeText, type CommandContext, type CommandDefinition, type VirtualShellPlugin } from "safe-bash-contracts";
import { PublicDiagnostic } from "safe-bash-contracts/diagnostics";
import { yieldTurn } from "safe-bash-contracts/yield";
import { Arguments, base64, hex, Io, text, unbase64, utf8 } from "./io.js";
import { encrypt } from "./encryption.js";
import { ecdsaDer, ecdsaRaw, importKey, keys, publicPart, signingAlgorithm } from "./keys.js";
import { certificates } from "./certificates.js";
import { cryptPassword } from "./password.js";

export interface OpensslLimits {
  readonly maxBufferedBytes: number;
  readonly maxIterations: number;
  readonly maxKeyBits: number;
  readonly maxPasswordBytes: number;
}
export interface OpensslCommandsOptions {
  readonly replace?: boolean;
  readonly limits?: Partial<OpensslLimits>;
  readonly maxBufferedBytes?: number;
}
export type OpensslOptions = OpensslCommandsOptions;
export function settings(options: OpensslCommandsOptions = {}): OpensslLimits {
  const limits = {
    maxBufferedBytes: options.limits?.maxBufferedBytes ?? options.maxBufferedBytes ?? 16 * 1024 * 1024,
    maxIterations: options.limits?.maxIterations ?? 1000000,
    maxKeyBits: options.limits?.maxKeyBits ?? 4096,
    maxPasswordBytes: options.limits?.maxPasswordBytes ?? 1024,
  };
  for (const [name, value] of Object.entries(limits)) {
    if (name === "maxBufferedBytes" && value === Infinity) continue;
    if (!Number.isSafeInteger(value) || value < 1) throw new RangeError(`Invalid openssl limit: ${name}`);
  }
  return Object.freeze(limits);
}
const hashes = { md5, sha1, sha256, sha384, sha512 };
type HashName = keyof typeof hashes;
const hashFlags = "-md5 -sha1 -sha256 -sha384 -sha512";

async function signatureOperation(a: Arguments, io: Io, pkeyutl: boolean, hash: string): Promise<number> {
  const sign = a.has("-sign");
  const keyFile = pkeyutl ? a.get("-inkey") : a.get("-sign") || a.get("-verify") || a.get("-prverify");
  const signatureFile = a.get(pkeyutl ? "-sigfile" : "-signature");
  if (!keyFile || (!sign && !signatureFile)) throw new PublicDiagnostic("sign/verify requires a key and verification requires a signature");
  let key = await importKey(await io.read(keyFile), "PEM", pkeyutl ? a.has("-pubin") : a.has("-verify"), hash);
  const input = await io.read(pkeyutl ? a.get("-in") : a.positional[0]);
  if (sign) {
    let signature = new Uint8Array(await crypto.subtle.sign(signingAlgorithm(key, hash), key, input));
    if (key.algorithm.name === "ECDSA") signature = ecdsaDer(signature);
    await io.write(a.has("-hex") ? `${hex(signature)}\n` : signature, a.get("-out"));
    return 0;
  }
  if (key.type === "private") key = await publicPart(key);
  let signature = await io.read(signatureFile);
  if (key.algorithm.name === "ECDSA") {
    const curve = (key.algorithm as EcKeyAlgorithm).namedCurve;
    signature = ecdsaRaw(signature, curve === "P-521" ? 66 : curve === "P-384" ? 48 : 32);
  }
  const valid = await crypto.subtle.verify(signingAlgorithm(key, hash), key, signature, input);
  if (pkeyutl && !valid) await writeText(io.context.stderr, "Signature Verification Failure\n");
  else await io.write(pkeyutl ? "Signature Verified Successfully\n" : valid ? "Verified OK\n" : "Verification Failure\n", a.get("-out"));
  return valid ? 0 : 1;
}

async function digest(sub: string, args: readonly string[], io: Io): Promise<number> {
  const a = new Arguments(args, `${hashFlags} -binary -hex -r`, "-hmac -sign -verify -prverify -signature -out");
  let name: HashName = Object.hasOwn(hashes, sub) ? sub as HashName : "sha256";
  for (const option of a.values.keys()) if (Object.hasOwn(hashes, option.slice(1))) name = option.slice(1) as HashName;
  if (a.has("-sign") || a.has("-verify") || a.has("-prverify")) {
    if (a.positional.length > 1 || a.has("-sign") && (a.has("-verify") || a.has("-prverify"))) throw new PublicDiagnostic("sign/verify requires one input and one operation");
    return signatureOperation(a, io, false, name === "md5" ? "MD5" : `SHA-${name.slice(3)}`);
  }
  if (a.has("-signature")) throw new PublicDiagnostic("-signature requires -verify");
  const output: Uint8Array[] = [];
  let size = 0;
  for (const file of a.positional.length ? a.positional : [undefined]) {
    const input = await io.read(file);
    const result = a.has("-hmac") ? hmac(hashes[name], utf8.encode(a.get("-hmac")), input) : hashes[name](input);
    const label = name.startsWith("sha") && name !== "sha1" ? `SHA2-${name.slice(3)}` : name.toUpperCase();
    const rendered = a.has("-binary") && !a.has("-hex") ? result : utf8.encode(a.has("-r") ? `${hex(result)} *${file ?? "stdin"}\n` : `${file && a.has("-hmac") ? "HMAC-" : ""}${label}(${file ?? "stdin"})= ${hex(result)}\n`);
    size += rendered.length;
    if (size > io.maxBytes) throw new PublicDiagnostic("digest output exceeds buffered limit");
    output.push(rendered);
    await yieldTurn(io.context.signal);
  }
  await io.write(concatBytes(...output), a.get("-out"));
  return 0;
}

async function execute(context: CommandContext, limits: OpensslLimits): Promise<number> {
  context.signal.throwIfAborted();
  const [sub = "help", ...args] = getCommandArguments(context).args;
  const io = new Io(context, Math.min(limits.maxBufferedBytes, (context as { limits?: { maxInputBytes?: number } }).limits?.maxInputBytes ?? Infinity));
  if (["help", "--help", "-h"].includes(sub)) {
    await io.write("Usage: openssl <subcommand> [options]\nSubcommands: version, dgst, md5, sha1, sha256, sha384, sha512, rand, base64, enc, genpkey, genrsa, rsa, ecparam, ec, pkey, pkeyutl, req, x509, passwd\n");
  } else if (["version", "--version", "-v"].includes(sub)) {
    const a = new Arguments(args, "-a -v -b -o -f -p -d", "");
    if (a.positional.length) throw new PublicDiagnostic("unexpected version argument");
    const values = { "-v": "OpenSSL compatible safe-bash toolkit (Web Crypto)", "-b": "built on: portable JavaScript", "-o": "options: Web Crypto, in-memory VFS", "-f": "compiler: TypeScript", "-p": "platform: portable", "-d": "OPENSSLDIR: virtual filesystem" };
    await io.write(Object.entries(values).filter(([flag]) => !args.length && flag === "-v" || a.has("-a") || a.has(flag)).map(([, value]) => value).join("\n") + "\n");
  } else if (sub === "dgst" || Object.hasOwn(hashes, sub)) return digest(sub, args, io);
  else if (sub === "enc") await encrypt(args, io, limits.maxIterations, limits.maxPasswordBytes);
  else if (["genpkey", "genrsa", "rsa", "ecparam", "ec", "pkey"].includes(sub)) await keys(sub, args, io, limits.maxKeyBits);
  else if (sub === "req" || sub === "x509") return certificates(sub, args, io, limits.maxKeyBits);
  else if (sub === "rand") {
    const a = new Arguments(args, "-hex -base64", "-out");
    if (a.positional.length !== 1 || a.has("-hex") && a.has("-base64")) throw new PublicDiagnostic("rand requires a byte count and one output format");
    const count = Number(a.positional[0]);
    if (!Number.isSafeInteger(count) || count < 0 || count > io.maxBytes || Array.from(a.positional[0]!).some(c => !"0123456789".includes(c))) throw new PublicDiagnostic("invalid random byte count");
    const size = a.has("-hex") ? count * 2 + 1 : a.has("-base64") ? Math.ceil(count / 3) * 4 + Math.ceil(count / 48) : count;
    if (size > io.maxBytes) throw new PublicDiagnostic("random output exceeds buffered limit");
    const bytes = new Uint8Array(count);
    for (let i = 0; i < count; i += 65536) { crypto.getRandomValues(bytes.subarray(i, i + 65536)); await yieldTurn(context.signal); }
    await io.write(a.has("-hex") ? `${hex(bytes)}\n` : a.has("-base64") ? `${base64(bytes, true)}\n` : bytes, a.get("-out"));
  } else if (sub === "base64") {
    const a = new Arguments(args, "-d -e -A -a -base64", "-in -out");
    if (a.positional.length) throw new PublicDiagnostic("unexpected base64 argument");
    const input = await io.read(a.get("-in"));
    await io.write(a.has("-d") ? unbase64(text.decode(input)) : base64(input, !a.has("-A")) + (a.has("-A") || !input.length ? "" : "\n"), a.get("-out"));
  } else if (sub === "passwd") {
    const a = new Arguments(args, "-1 -5 -6 -apr1 -stdin", "-salt");
    const modes = ["-1", "-5", "-6", "-apr1"].filter(flag => a.has(flag));
    if (modes.length > 1) throw new PublicDiagnostic("choose one password hash format");
    const mode = (modes[0] ?? "-1").slice(1);
    const passwords = a.has("-stdin") ? text.decode(await io.read()).split("\n") : a.positional;
    if (a.has("-stdin") && passwords.at(-1) === "") passwords.pop();
    if (!passwords.length) throw new PublicDiagnostic("password required via argument or -stdin");
    for (let password of passwords) {
      if (password.endsWith("\r")) password = password.slice(0, -1);
      if (utf8.encode(password).length > limits.maxPasswordBytes) throw new PublicDiagnostic("password exceeds maximum password size");
      const salt = a.has("-salt") ? a.get("-salt") : Array.from(crypto.getRandomValues(new Uint8Array(8)), n => "./0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"[n & 63]).join("");
      await io.write(`${await cryptPassword(password, salt, mode, context.signal, limits.maxIterations)}\n`);
    }
  } else if (sub === "pkeyutl") {
    const a = new Arguments(args, "-sign -verify -rawin -pubin", "-inkey -in -out -sigfile -digest");
    if (!a.has("-inkey") || a.has("-sign") === a.has("-verify")) throw new PublicDiagnostic("pkeyutl requires -inkey and one of -sign/-verify");
    const requestedHash = a.get("-digest", "sha256");
    if (!Object.hasOwn(hashes, requestedHash) || requestedHash === "md5") throw new PublicDiagnostic("unsupported signing digest");
    return signatureOperation(a, io, true, `SHA-${requestedHash.slice(3)}`);
  } else throw new PublicDiagnostic(`Invalid command '${sub}'; type "openssl help" for a list.`);
  return 0;
}

export function createOpensslCommand(options: OpensslCommandsOptions = {}): CommandDefinition {
  const limits = settings(options);
  return { name: "openssl", description: "Portable cryptographic and X.509 toolkit", runtimeIdentity: commandRuntimeIdentity,
    async execute(context) {
      try { return { exitCode: await execute(context, limits) }; }
      catch (error) {
        context.signal.throwIfAborted();
        await writeText(context.stderr, `openssl: ${error instanceof Error ? error.message : String(error)}\n`);
        return { exitCode: 1 };
      }
    },
  };
}
export function createOpensslCommands(options: OpensslCommandsOptions = {}): readonly CommandDefinition[] { return [createOpensslCommand(options)]; }
export function opensslCommands(options: OpensslCommandsOptions = {}): VirtualShellPlugin {
  const commands = createOpensslCommands(options);
  return { name: "openssl-commands", setup(host) {
    for (const command of commands) {
      if (!options.replace && host.commands.has(command.name)) throw new Error(`Command already registered: ${command.name}`);
      host.commands.register(command, { replace: options.replace ?? false });
    }
  } };
}
