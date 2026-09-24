import { FsError, readBytes, writeBytes, type ByteSource, type CommandContext } from "../../contracts/index.js";
import { openFileOutput } from "../../contracts/filesystem-output.js";
import { outputFailure } from "../../contracts/io.js";
import { pathOf } from "../internal.js";
import { encode } from "./shared.js";
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

export async function writeOutput(context: CommandContext, path: string | undefined, source: ByteSource, signal: AbortSignal, append = false, preserveEmpty = false): Promise<void> {
  if (path === undefined || path === "-") {
    try {
      for await (const chunk of readBytes(source, signal)) {
        try { await writeBytes(context.stdout, chunk, signal); }
        catch { signal.throwIfAborted(); throw new CurlError(23, "Failed writing output"); }
      }
    } catch (error) {
      await context.stdout[outputFailure]?.(error);
      throw error;
    }
    return;
  }
  try {
    let target = preserveEmpty ? undefined : await openFileOutput({ ...context, signal, outputBudget: "independent" }, pathOf(context, path), append ? "a" : "w");
    try {
      for await (const chunk of readBytes(source, target?.signal ?? signal)) {
        if (preserveEmpty && chunk.length === 0) continue;
        target ??= await openFileOutput({ ...context, signal, outputBudget: "independent" }, pathOf(context, path), append ? "a" : "w");
        await target.sink.write(chunk);
      }
      await target?.finish();
    } catch (error) { await target?.abort(error); throw error; }
  } catch (error) {
    signal.throwIfAborted();
    if (error instanceof CurlError) throw error;
    throw new CurlError(23, error instanceof FsError ? `Failed writing virtual output file: ${error.message}` : "Failed writing virtual output file");
  }
}

export async function dumpHeaders(context: CommandContext, path: string, bytes: Uint8Array, append: boolean, signal: AbortSignal): Promise<void> {
  try {
    if (path === "-") await writeBytes(context.stdout, bytes, signal);
    else {
      const target = await openFileOutput({ ...context, signal, outputBudget: "independent" }, pathOf(context, path), append ? "a" : "w");
      try { await target.sink.write(bytes); await target.finish(); }
      catch (error) { await target.abort(error); throw error; }
    }
  } catch {
    signal.throwIfAborted();
    throw new CurlError(23, "Failed writing response headers");
  }
}

export function writeOutFormat(format: string, values: Readonly<Record<string, string>>, maxBytes: number): Uint8Array {
  let result = "";
  let bytes = 0;
  const sizes = new Map<string, number>();
  const append = (text: string): void => {
    let size = sizes.get(text);
    if (size === undefined) { size = Buffer.byteLength(text); sizes.set(text, size); }
    if (size > maxBytes - bytes) throw new CurlError(63, "Write-out exceeds host buffer limit");
    bytes += size;
    result += text;
  };
  for (let index = 0; index < format.length; index++) {
    const character = format[index]!;
    if (character === "\\") {
      const next = format[++index];
      append(next === "n" ? "\n" : next === "r" ? "\r" : next === "t" ? "\t" : next === undefined ? "\\" : `\\${next}`);
    } else if (character === "%" && format[index + 1] === "%") { append("%"); index++; }
    else if (character === "%" && format[index + 1] === "{") {
      const end = format.indexOf("}", index + 2);
      if (end < 0) throw new CurlError(2, "Invalid write-out format");
      const name = format.slice(index + 2, end);
      if (!Object.hasOwn(values, name)) throw new CurlError(2, "Unsupported write-out variable");
      append(values[name]!); index = end;
    } else {
      const start = index;
      while (index + 1 < format.length && format[index + 1] !== "%" && format[index + 1] !== "\\") index++;
      append(format.slice(start, index + 1));
    }
  }
  return encode(result);
}
