import { randomBytes } from "./platform.js";
import { posixPath as posix } from "../../contracts/path.js";
import { yieldTurn } from "../../contracts/yield.js";
import { collectBytes, readBytes, type ByteSource, type CommandContext } from "../../contracts/index.js";
import { pathOf } from "../internal.js";
import type { CurlArguments, DataArgument } from "./args.js";
import { encode } from "./shared.js";
import { CurlError, type NetworkLimits } from "./types.js";

interface Part {
  readonly encoder?: string;
  readonly bytes?: Uint8Array;
  readonly separator?: boolean;
  readonly file?: string;
  readonly strip?: boolean;
  readonly urlencode?: boolean;
  readonly prefix?: Uint8Array;
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
    // curl 8.5/8.10 omit the name as well as the value for empty file data.
    if (at >= 0) return [{ prefix: encode(at ? `${value.slice(0, at)}=` : ""), file: value.slice(at + 1), urlencode: true }];
    return [{ bytes: encode(value), urlencode: true }];
  }
  if (argument.kind !== "raw" && value.startsWith("@")) return [{ file: value.slice(1), strip: argument.kind === "data" }];
  return [{ bytes: encode(value) }];
}

function quoted(value: string): string {
  if (/[\r\n\0]/.test(value)) throw new CurlError(2, "Invalid multipart field metadata");
  return value.replace(/["\\]/g, "\\$&");
}

// curl only unescapes quotes and backslashes inside a double-quoted operand.
function formWord(input: string, start: number, file: boolean): { value: string; end: number } {
  const delimiter = (character: string) => character === ";" || (file && character === ",");
  if (input[start] === '"') {
    let value = "";
    for (let index = start + 1; index < input.length; index++) {
      const character = input[index]!;
      if (character === '"') {
        let end = index + 1;
        while (end < input.length && !delimiter(input[end]!)) end++;
        return { value, end };
      }
      if (character === "\\" && (input[index + 1] === "\\" || input[index + 1] === '"')) {
        value += input[++index];
      } else value += character;
    }
    // An unmatched opening quote is literal in curl's form grammar.
  }
  let end = start;
  while (end < input.length && !delimiter(input[end]!)) end++;
  return { value: input.slice(start, end), end };
}

// curl's deliberately small extension table, rather than a general MIME database.
const multipartContentTypes = new Map([
  ["gif", "image/gif"], ["jpg", "image/jpeg"], ["jpeg", "image/jpeg"],
  ["png", "image/png"], ["svg", "image/svg+xml"], ["txt", "text/plain"],
  ["html", "text/html"], ["htm", "text/html"], ["pdf", "application/pdf"],
  ["xml", "application/xml"],
]);

function filenameContentType(filename: string): string | undefined {
  const basename = posix.basename(filename);
  const dot = basename.lastIndexOf(".");
  return dot < 0 ? undefined : multipartContentTypes.get(basename.slice(dot + 1).toLowerCase());
}

function multipart(argument: DataArgument, boundary: string): Part[] {
  const equals = argument.value.indexOf("=");
  if (equals < 1) throw new CurlError(2, "Multipart form requires name=value");
  const name = quoted(argument.value.slice(0, equals));
  let value = argument.value.slice(equals + 1);
  let type: string | undefined;
  let filename: string | undefined;
  let encoder: string | undefined;
  let file: string | undefined;
  if (argument.kind === "form") {
    const input = value;
    const isFile = input.startsWith("@") || input.startsWith("<");
    const word = formWord(input, isFile ? 1 : 0, isFile);
    if (isFile) {
      file = word.value;
      if (!file || input[word.end] === ",") throw new CurlError(2, "Unsupported multipart file list");
      if (input.startsWith("@")) filename = posix.basename(file);
    } else value = word.value;
    let end = word.end;
    while (end < input.length) {
      const start = end + 1;
      if (input.startsWith("type=", start)) {
        const attribute = formWord(input, start + 5, false);
        type = attribute.value;
        end = attribute.end;
      } else if (input.startsWith("filename=", start)) {
        const attribute = formWord(input, start + 9, false);
        filename = attribute.value;
        end = attribute.end;
      } else if (input.startsWith("encoder=", start)) {
        const attribute = formWord(input, start + 8, false);
        encoder = attribute.value.toLowerCase();
        end = attribute.end;
        if (!["binary", "8bit", "7bit", "base64", "quoted-printable"].includes(encoder))
          throw new CurlError(2, "Unsupported multipart transfer encoder");
      } else throw new CurlError(2, "Unsupported multipart form attribute");
    }
  }
  if (type !== undefined && !/^[\w!#$&^_.+-]+\/[\w!#$&^_.+-]+$/.test(type)) throw new CurlError(2, "Invalid multipart content type");
  let preamble = `--${boundary}\r\nContent-Disposition: form-data; name="${name}"`;
  if (filename !== undefined) preamble += `; filename="${quoted(filename)}"`;
  preamble += "\r\n";
  if (type || filename !== undefined) {
    const inferred = filename === undefined ? undefined : filenameContentType(filename) ??
      (file === undefined ? undefined : filenameContentType(file));
    preamble += `Content-Type: ${type ?? inferred ?? "application/octet-stream"}\r\n`;
  }
  if (encoder) preamble += `Content-Transfer-Encoding: ${encoder}\r\n`;
  preamble += "\r\n";
  return [{ bytes: encode(preamble) }, file !== undefined ? { file, encoder } : { bytes: encode(value), encoder }, { bytes: encode("\r\n") }];
}

async function* transfer(source: ByteSource, encoder: string | undefined, signal: AbortSignal): ByteSource {
  if (!encoder || encoder === "binary" || encoder === "8bit") { yield* source; return; }
  let pending: number[] = [];
  let column = 0;
  let output = "";
  const quotedByte = (byte: number, next: number | undefined, after: number | undefined) => {
    if (byte === 13 && next === 10) { output += "\r\n"; column = 0; return 2; }
    const trailing = next === undefined || (next === 13 && after === 10);
    const literal = (byte >= 33 && byte <= 126 && byte !== 61) || ((byte === 32 || byte === 9) && !trailing);
    const token = literal ? String.fromCharCode(byte) : `=${byte.toString(16).toUpperCase().padStart(2, "0")}`;
    if (column + token.length > 75) { output += "=\r\n"; column = 0; }
    output += token; column += token.length;
    return 1;
  };
  for await (const raw of source) {
    for (let offset = 0; offset < raw.length; offset += 16 * 1024) {
      signal.throwIfAborted();
      const chunk = raw.subarray(offset, offset + 16 * 1024);
      if (encoder === "7bit") {
        if (chunk.some(byte => byte > 127)) throw new CurlError(26, "Non-ASCII byte in 7bit multipart data");
        yield chunk;
        continue;
      }
      pending.push(...chunk);
      let consumed = 0;
      if (encoder === "base64") {
        while (pending.length - consumed >= 57) {
          if (column) output += "\r\n";
          output += Buffer.from(pending.slice(consumed, consumed + 57)).toString("base64");
          consumed += 57; column = 76;
        }
      } else {
        while (pending.length - consumed >= 3)
          consumed += quotedByte(pending[consumed]!, pending[consumed + 1], pending[consumed + 2]);
      }
      pending = pending.slice(consumed);
      if (output) { yield encode(output); output = ""; }
      await yieldTurn(signal);
    }
  }
  signal.throwIfAborted();
  if (encoder === "base64" && pending.length) {
    if (column) output += "\r\n";
    output += Buffer.from(pending).toString("base64");
  } else if (encoder === "quoted-printable") {
    for (let i = 0; i < pending.length;)
      i += quotedByte(pending[i]!, pending[i + 1], pending[i + 2]);
  }
  if (output) yield encode(output);
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
      if (index && !json) parts.push({ bytes: encode("&"), separator: true });
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
      const capabilities = await context.fs.capabilitiesFor?.(path, { signal }) ?? context.fs.capabilities;
      signal.throwIfAborted();
      if (context.fs.readStream && capabilities.streamingRead !== false) yield* readBytes(context.fs.readStream(path, { signal }), signal);
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
        for (const part of parts) {
          if (part.separator && count === 0) continue;
          let prefix = part.prefix;
          for await (const raw of transfer(source(part, signal), part.encoder, signal)) {
            if (++chunks % 256 === 0) await yieldTurn(signal);
            for (let offset = 0; offset < raw.length; offset += 16 * 1024) {
              signal.throwIfAborted();
              let chunk = raw.subarray(offset, offset + 16 * 1024);
              if (part.strip) chunk = chunk.filter(byte => byte !== 0 && byte !== 10 && byte !== 13);
              if (part.urlencode) chunk = percent(chunk);
              count += chunk.length + (prefix?.length ?? 0);
              if (count > limits.maxUploadBytes) throw new CurlError(63, "Upload exceeds host byte limit");
              if (prefix?.length) {
                const prefixed = new Uint8Array(prefix.length + chunk.length);
                prefixed.set(prefix);
                prefixed.set(chunk, prefix.length);
                chunk = prefixed;
                prefix = undefined;
              }
              if (hasStdin && replayable) {
                cachedBytes += chunk.length;
                if (cachedBytes > limits.maxBufferBytes) { replayable = false; cache = []; }
                else cache.push(new Uint8Array(chunk));
              }
              if (chunk.length) yield chunk;
            }
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
