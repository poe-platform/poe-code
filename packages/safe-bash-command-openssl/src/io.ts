import { FsError, readBytes, writeBytes, type CommandContext } from "safe-bash-contracts";
import { PublicDiagnostic } from "safe-bash-contracts/diagnostics";
import { writeFileOutput } from "safe-bash-contracts/filesystem-output-budget";
import { yieldTurn } from "safe-bash-contracts/yield";

export const utf8 = new TextEncoder();
export const text = new TextDecoder();
export const hex = (bytes: Uint8Array): string => Array.from(bytes, n => n.toString(16).padStart(2, "0")).join("");
export function unhex(value: string): Uint8Array<ArrayBuffer> {
  if (value.length % 2 || Array.from(value.toLowerCase()).some(c => !"0123456789abcdef".includes(c))) throw new PublicDiagnostic("invalid hex value");
  return Uint8Array.from({ length: value.length / 2 }, (_, i) => Number.parseInt(value.slice(i * 2, i * 2 + 2), 16));
}
export function base64(bytes: Uint8Array, wrap = false): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const encoded = btoa(binary);
  if (!wrap) return encoded;
  const lines: string[] = [];
  for (let i = 0; i < encoded.length; i += 64) lines.push(encoded.slice(i, i + 64));
  return lines.join("\n");
}
export function unbase64(value: string): Uint8Array<ArrayBuffer> {
  const clean = Array.from(value).filter(c => !" \t\n\r".includes(c)).join("").split("-").join("+").split("_").join("/");
  return Uint8Array.from(atob(clean), c => c.charCodeAt(0));
}
export function pem(label: string, bytes: Uint8Array): string {
  return `-----BEGIN ${label}-----\n${base64(bytes, true)}\n-----END ${label}-----\n`;
}
export function der(bytes: Uint8Array, format: string): Uint8Array<ArrayBuffer> {
  if (format === "DER") return new Uint8Array(bytes);
  if (format !== "PEM") throw new PublicDiagnostic("format must be PEM or DER");
  const lines = text.decode(bytes).trim().split("\n");
  if (!lines[0]?.startsWith("-----BEGIN ") || !lines.at(-1)?.startsWith("-----END ")) throw new PublicDiagnostic("invalid PEM input");
  return unbase64(lines.slice(1, -1).join(""));
}

export class Arguments {
  readonly values = new Map<string, string[]>();
  readonly positional: string[] = [];
  constructor(args: readonly string[], flags: string, options: string) {
    const booleans = flags.split(" ");
    const valued = options.split(" ");
    for (let i = 0; i < args.length; i++) {
      const arg = args[i]!;
      if (arg === "--") { this.positional.push(...args.slice(i + 1)); break; }
      if (!arg.startsWith("-")) { this.positional.push(arg); continue; }
      if (!booleans.includes(arg) && !valued.includes(arg)) throw new PublicDiagnostic(`unknown option: ${arg}`);
      const value = valued.includes(arg) ? args[++i] : "";
      if (value === undefined) throw new PublicDiagnostic(`missing value for ${arg}`);
      const values = this.values.get(arg) ?? [];
      values.push(value);
      this.values.set(arg, values);
    }
  }
  has(name: string): boolean { return this.values.has(name); }
  get(name: string, fallback = ""): string { return this.values.get(name)?.at(-1) ?? fallback; }
  integer(name: string, fallback: number, maximum: number): number {
    const raw = this.get(name, String(fallback));
    const n = Number(raw);
    if (!raw || Array.from(raw).some(c => !"0123456789".includes(c)) || !Number.isSafeInteger(n) || n < 1 || n > maximum) throw new PublicDiagnostic(`invalid or excessive ${name}: ${raw}`);
    return n;
  }
}

export class Io {
  private stdin: Uint8Array<ArrayBuffer> | undefined;
  private consumed = 0;
  constructor(readonly context: CommandContext, readonly maxBytes: number) {}
  path(file: string): string {
    const parts: string[] = [];
    for (const part of (file.startsWith("/") ? file : `${this.context.cwd}/${file}`).split("/")) {
      if (part === "..") parts.pop();
      else if (part && part !== ".") parts.push(part);
    }
    return `/${parts.join("/")}`;
  }
  async read(file?: string): Promise<Uint8Array<ArrayBuffer>> {
    if (!file && this.stdin) { const result = this.stdin; this.stdin = new Uint8Array(); return result; }
    const remaining = this.maxBytes - this.consumed;
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      if (file) {
        const bytes = await this.context.fs.readFile(this.path(file), { ...(remaining === Infinity ? {} : { maxBytes: remaining }), signal: this.context.signal });
        size = bytes.length;
        chunks.push(bytes);
      } else {
        for await (const chunk of readBytes(this.context.stdin, this.context.signal)) {
          size += chunk.length;
          if (size > remaining) throw new PublicDiagnostic(`input exceeds maximum buffered size of ${this.maxBytes} bytes`);
          chunks.push(new Uint8Array(chunk));
          await yieldTurn(this.context.signal);
        }
        this.stdin = new Uint8Array();
      }
    } catch (error) {
      if (error instanceof FsError && error.code === "EFBIG") throw new PublicDiagnostic(`input exceeds maximum buffered size of ${this.maxBytes} bytes`);
      throw error;
    }
    if (size > remaining) throw new PublicDiagnostic(`input exceeds maximum buffered size of ${this.maxBytes} bytes`);
    this.consumed += size;
    const result = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
    return result;
  }
  async password(spec: string): Promise<string> {
    if (spec.startsWith("pass:")) return spec.slice(5);
    if (spec.startsWith("env:")) {
      const value = this.context.env[spec.slice(4)];
      if (value === undefined) throw new PublicDiagnostic("password environment variable is not set");
      return value;
    }
    let bytes: Uint8Array;
    if (spec.startsWith("file:")) bytes = await this.read(spec.slice(5));
    else if (spec === "stdin") {
      bytes = await this.read();
      const newline = bytes.indexOf(10);
      this.stdin = bytes.slice(newline < 0 ? bytes.length : newline + 1);
      bytes = bytes.slice(0, newline < 0 ? bytes.length : newline);
    } else throw new PublicDiagnostic("password source must be pass:, env:, file: or stdin");
    return text.decode(bytes).split("\n")[0]!.split("\r")[0]!;
  }
  async write(bytes: Uint8Array | string, file?: string): Promise<void> {
    const data = typeof bytes === "string" ? utf8.encode(bytes) : bytes;
    this.context.signal.throwIfAborted();
    if (data.length > this.maxBytes) throw new PublicDiagnostic(`output exceeds maximum buffered size of ${this.maxBytes} bytes`);
    if (file) await writeFileOutput(this.context, data, output => this.context.fs.writeFile(this.path(file), output, { signal: this.context.signal }));
    else await writeBytes(this.context.stdout, data, this.context.signal);
  }
}
