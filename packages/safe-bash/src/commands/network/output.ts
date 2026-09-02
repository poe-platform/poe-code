import { FsError, readBytes, writeBytes, type ByteSource, type CommandContext } from "../../contracts/index.js";
import { pathOf } from "../internal.js";
import { encode, withSignal } from "./shared.js";
import { CurlError, type HttpResponse } from "./types.js";

export function responseHeaders(response: HttpResponse, maxBytes: number): Uint8Array {
  if (!Number.isInteger(response.status) || response.status < 100 || response.status > 599 || /[\r\n]/.test(response.statusText)) {
    throw new CurlError(56, "Invalid HTTP response status");
  }
  const version = response.httpVersion ?? "1.1";
  if (!/^\d(?:\.\d)?$/.test(version)) throw new CurlError(56, "Invalid HTTP response version");
  let text = `HTTP/${version} ${response.status} ${response.statusText}\r\n`;
  for (const [name, value] of response.headers) {
    if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name) || /[\r\n\0]/.test(value)) throw new CurlError(56, "Invalid HTTP response header");
    text += `${name}: ${value}\r\n`;
    if (Buffer.byteLength(text, "latin1") > maxBytes) throw new CurlError(63, "Response headers exceed host byte limit");
  }
  return new Uint8Array(Buffer.from(`${text}\r\n`, "latin1"));
}

export async function writeOutput(context: CommandContext, path: string | undefined, source: ByteSource, signal: AbortSignal): Promise<void> {
  if (path === undefined || path === "-") {
    for await (const chunk of readBytes(source, signal)) {
      try { await writeBytes(context.stdout, chunk, signal); }
      catch { signal.throwIfAborted(); throw new CurlError(23, "Failed writing output"); }
    }
    return;
  }
  try {
    const target = pathOf(context, path);
    if (context.fs.capabilities.streamingWrite !== false && context.fs.writeStream) {
      let acquired = false;
      const observed: ByteSource = {
        [Symbol.asyncIterator]() {
          acquired = true;
          return source[Symbol.asyncIterator]();
        }
      };
      try {
        await withSignal(() => context.fs.writeStream!(target, observed, { signal, flag: "w" }), signal);
        return;
      } catch (error) {
        if (acquired || !(error instanceof FsError) || error.code !== "ENOTSUP") throw error;
      }
    }
    await withSignal(() => context.fs.writeFile(target, new Uint8Array(), { signal, flag: "w" }), signal);
    for await (const chunk of readBytes(source, signal)) await withSignal(() => context.fs.appendFile(target, chunk, { signal }), signal);
  } catch (error) {
    signal.throwIfAborted();
    if (error instanceof CurlError) throw error;
    throw new CurlError(23, "Failed writing virtual output file");
  }
}

export async function dumpHeaders(context: CommandContext, path: string, bytes: Uint8Array, append: boolean, signal: AbortSignal): Promise<void> {
  try {
    if (path === "-") await writeBytes(context.stdout, bytes, signal);
    else if (append) await withSignal(() => context.fs.appendFile(pathOf(context, path), bytes, { signal }), signal);
    else await withSignal(() => context.fs.writeFile(pathOf(context, path), bytes, { signal, flag: "w" }), signal);
  } catch {
    signal.throwIfAborted();
    throw new CurlError(23, "Failed writing response headers");
  }
}

export function writeOutFormat(format: string, values: Readonly<Record<string, string>>): Uint8Array {
  let result = "";
  for (let index = 0; index < format.length; index++) {
    const character = format[index]!;
    if (character === "\\") {
      const next = format[++index];
      result += next === "n" ? "\n" : next === "r" ? "\r" : next === "t" ? "\t" : next === undefined ? "\\" : `\\${next}`;
    } else if (character === "%" && format[index + 1] === "%") { result += "%"; index++; }
    else if (character === "%" && format[index + 1] === "{") {
      const end = format.indexOf("}", index + 2);
      if (end < 0) throw new CurlError(2, "Invalid write-out format");
      const name = format.slice(index + 2, end);
      if (!Object.hasOwn(values, name)) throw new CurlError(2, "Unsupported write-out variable");
      result += values[name]; index = end;
    } else result += character;
  }
  return encode(result);
}
