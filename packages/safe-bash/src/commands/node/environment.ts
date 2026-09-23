import { resolvePath } from "../../contracts/path.js";
import { SafeJsCommandLimitError } from "../safejs/types.js";

/** Parse dotenv assignments without shell expansion or reading host state. */
export async function nodeEnvironment(
  files: readonly { path: string; optional: boolean }[], inherited: Readonly<Record<string, string>>,
  cwd: string, read: (path: string, maxBytes: number) => Promise<string>, signal: AbortSignal, remainingBytes: number,
): Promise<Record<string, string>> {
  const values: Record<string, string> = Object.create(null);
  for (const file of files) {
    let source: string;
    try { source = await read(resolvePath(cwd, file.path), remainingBytes); }
    catch (error) {
      signal.throwIfAborted();
      if (file.optional && typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") continue;
      throw error;
    }
    remainingBytes -= Buffer.byteLength(source);
    if (remainingBytes < 0) throw new SafeJsCommandLimitError("maxSourceBytes");
    let index = 0;
    const nextLine = (): void => { while (index < source.length && source[index] !== "\n") index++; index++; };
    while (index < source.length) {
      while (" \t\r\n".includes(source[index] ?? "\0")) index++;
      if (source[index] === "#") { nextLine(); continue; }
      if (source.startsWith("export ", index)) index += 7;
      const start = index;
      while (index < source.length && "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_".includes(source[index]!)) index++;
      const name = source.slice(start, index);
      while (source[index] === " " || source[index] === "\t") index++;
      if (!name || "0123456789".includes(name[0]!) || source[index] !== "=") { nextLine(); continue; }
      index++;
      while (source[index] === " " || source[index] === "\t") index++;
      const quote = source[index];
      let value = "";
      if (quote === '"' || quote === "'" || quote === "`") {
        index++;
        while (index < source.length && source[index] !== quote) {
          if (quote === '"' && source[index] === "\\" && source[index + 1] === "n") { value += "\n"; index += 2; }
          else value += source[index++];
        }
        index++;
      } else {
        while (index < source.length && source[index] !== "\n" && source[index] !== "#") value += source[index++];
        value = value.trim();
      }
      values[name] = value;
      nextLine();
    }
  }
  return Object.assign(values, inherited);
}
