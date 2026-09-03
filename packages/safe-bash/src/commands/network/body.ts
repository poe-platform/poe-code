import { randomBytes } from "node:crypto";
import { posix } from "node:path";
import { yieldTurn } from "../../contracts/yield.js";
import { collectBytes, readBytes, type ByteSource, type CommandContext } from "../../contracts/index.js";
import { pathOf } from "../internal.js";
import type { CurlArguments, DataArgument } from "./args.js";
import { encode } from "./shared.js";
import { CurlError, type NetworkLimits } from "./types.js";

interface Part {
  readonly bytes?: Uint8Array;
  readonly file?: string;
  readonly strip?: boolean;
  readonly urlencode?: boolean;
}

export interface RequestBody {
  readonly contentType?: string;
  open(signal: AbortSignal): ByteSource;
}

function percent(bytes: Uint8Array): Uint8Array {
  let output = "";
  for (const byte of bytes) output += (byte >= 65 && byte <= 90) || (byte >= 97 && byte <= 122) ||
    (byte >= 48 && byte <= 57) || [45, 46, 95, 126].includes(byte)
    ? String.fromCharCode(byte) : byte === 32 ? "+" : `%${byte.toString(16).toUpperCase().padStart(2, "0")}`;
  return encode(output);
}

function dataPart(argument: DataArgument): Part[] {
  const value = argument.value;
  if (argument.kind === "urlencode") {
    const equals = value.indexOf("=");
    if (equals >= 0) return [{ bytes: encode(equals ? `${value.slice(0, equals)}=` : "") }, { bytes: encode(value.slice(equals + 1)), urlencode: true }];
    const at = value.indexOf("@");
    if (at >= 0) return [{ bytes: encode(at ? `${value.slice(0, at)}=` : "") }, { file: value.slice(at + 1), urlencode: true }];
    return [{ bytes: encode(value), urlencode: true }];
  }
  if (argument.kind !== "raw" && value.startsWith("@")) return [{ file: value.slice(1), strip: argument.kind === "data" }];
  return [{ bytes: encode(value) }];
}

function quoted(value: string): string {
  if (/[\r\n\0]/.test(value)) throw new CurlError(2, "Invalid multipart field metadata");
  return value.replace(/["\\]/g, "\\$&");
}

function multipart(argument: DataArgument, boundary: string): Part[] {
  const equals = argument.value.indexOf("=");
  if (equals < 1) throw new CurlError(2, "Multipart form requires name=value");
  const name = quoted(argument.value.slice(0, equals));
  let value = argument.value.slice(equals + 1);
  let type: string | undefined;
  let filename: string | undefined;
  if (argument.kind === "form") {
    const fields = value.split(";");
    value = fields.shift()!;
    for (const field of fields) {
      if (field.startsWith("type=")) type = field.slice(5);
      else if (field.startsWith("filename=")) filename = field.slice(9);
      else throw new CurlError(2, "Unsupported multipart form attribute");
    }
  }
  const isFile = argument.kind === "form" && /^[<@]/.test(value);
  if (isFile && (value.slice(1).includes(",") || !value.slice(1))) throw new CurlError(2, "Unsupported multipart file list");
  if (isFile && value.startsWith("@")) filename ??= posix.basename(value.slice(1));
  if (type !== undefined && !/^[\w!#$&^_.+-]+\/[\w!#$&^_.+-]+$/.test(type)) throw new CurlError(2, "Invalid multipart content type");
  let preamble = `--${boundary}\r\nContent-Disposition: form-data; name="${name}"`;
  if (filename !== undefined) preamble += `; filename="${quoted(filename)}"`;
  preamble += "\r\n";
  if (type || filename !== undefined) preamble += `Content-Type: ${type ?? "application/octet-stream"}\r\n`;
  preamble += "\r\n";
  return [{ bytes: encode(preamble) }, isFile ? { file: value.slice(1) } : { bytes: encode(value) }, { bytes: encode("\r\n") }];
}

export function createBody(context: CommandContext, args: CurlArguments, limits: NetworkLimits): RequestBody | undefined {
  if (!args.data.length && args.upload === undefined) return undefined;
  const parts: Part[] = [];
  let contentType: string | undefined;
  const form = args.data.some(part => part.kind.startsWith("form"));
  if (form) {
    const boundary = `virtual-bash-${randomBytes(18).toString("hex")}`;
    contentType = `multipart/form-data; boundary=${boundary}`;
    for (const argument of args.data) parts.push(...multipart(argument, boundary));
    parts.push({ bytes: encode(`--${boundary}--\r\n`) });
  } else if (args.upload !== undefined) parts.push({ file: args.upload });
  else {
    const json = args.data[0]?.kind === "json";
    contentType = json ? "application/json" : "application/x-www-form-urlencoded";
    args.data.forEach((argument, index) => {
      if (index && !json) parts.push({ bytes: encode("&") });
      parts.push(...dataPart(argument));
    });
  }
  const hasStdin = parts.some(part => part.file === "-");
  let opened = false;
  let replayComplete = false;
  let replayable = true;
  let cachedBytes = 0;
  let cache: Uint8Array[] = [];
  let stdinUsed = false;
  const source = async function* (part: Part, signal: AbortSignal): ByteSource {
    if (part.bytes !== undefined) { yield part.bytes; return; }
    if (part.file === "-") {
      if (!stdinUsed) { stdinUsed = true; yield* readBytes(context.stdin, signal); }
      return;
    }
    try {
      const path = pathOf(context, part.file!);
      if (context.fs.readStream) yield* readBytes(context.fs.readStream(path, { signal }), signal);
      else yield await context.fs.readFile(path, { signal, maxBytes: Math.min(limits.maxBufferBytes, limits.maxUploadBytes) });
    } catch (error) {
      signal.throwIfAborted();
      if (error instanceof CurlError) throw error;
      throw new CurlError(26, "Failed to read virtual upload file");
    }
  };
  return {
    ...(contentType === undefined ? {} : { contentType }),
    open(signal) {
      return (async function* (): ByteSource {
        if (hasStdin && opened) {
          if (!replayComplete || !replayable) throw new CurlError(65, "Cannot replay stdin upload within the host buffer limit");
          for (const chunk of cache) { signal.throwIfAborted(); yield chunk.slice(); }
          return;
        }
        opened = true;
        let count = 0;
        let chunks = 0;
        for (const part of parts) for await (const raw of source(part, signal)) {
          if (++chunks % 256 === 0) await yieldTurn(signal);
          for (let offset = 0; offset < raw.length; offset += 16 * 1024) {
            signal.throwIfAborted();
            let chunk = raw.subarray(offset, offset + 16 * 1024);
            if (part.strip) chunk = chunk.filter(byte => byte !== 0 && byte !== 10 && byte !== 13);
            if (part.urlencode) chunk = percent(chunk);
            count += chunk.length;
            if (count > limits.maxUploadBytes) throw new CurlError(63, "Upload exceeds host byte limit");
            if (hasStdin && replayable) {
              cachedBytes += chunk.length;
              if (cachedBytes > limits.maxBufferBytes) { replayable = false; cache = []; }
              else cache.push(new Uint8Array(chunk));
            }
            if (chunk.length) yield chunk;
          }
        }
        replayComplete = true;
      })();
    },
  };
}

export async function queryData(body: RequestBody, signal: AbortSignal, limits: NetworkLimits): Promise<string> {
  try { return Buffer.from(await collectBytes(body.open(signal), { signal, maxBytes: limits.maxBufferBytes })).toString("utf8"); }
  catch (error) {
    signal.throwIfAborted();
    if (error instanceof CurlError) throw error;
    throw new CurlError(63, "Query data exceeds host buffer limit");
  }
}
