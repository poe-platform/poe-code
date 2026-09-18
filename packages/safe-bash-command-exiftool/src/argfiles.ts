import type { CommandContext } from "safe-bash-contracts/command";
import { readBytes } from "safe-bash-contracts/io";
import type { Publication } from "./publication.js";
import type { Resources } from "./resources.js";
import { virtualPath } from "./paths.js";

const escapes: Readonly<Record<string, string>> = Object.freeze({ a: "\x07", b: "\b", f: "\f", n: "\n", r: "\r", t: "\t", '"': '"', "\\": "\\" });
function whitespace(character: string): boolean {
  return character === " " || character === "\t" || character === "\n" || character === "\r" || character === "\f" || character === "\v";
}

/** Pinned CLI physical-line filtering; neither shell quoting nor code evaluation. */
export function filterArgfileLine(line: string): string | undefined {
  const cstr = line.startsWith("#[CSTR]");
  if (line.startsWith("#") && !cstr) return undefined;
  let start = cstr ? 7 : 0, end = line.length;
  if (!cstr) while (start < end && whitespace(line[start]!)) start++;
  while (end > start && (line[end - 1] === "\r" || line[end - 1] === "\n")) end--;
  const value = line.slice(start, end);
  if (cstr) {
    const parts: string[] = [];
    for (let index = 0; index < value.length; index++) {
      const character = value[index]!;
      if (character === "\\" && index + 1 < value.length) {
        const next = value[++index]!;
        parts.push(Object.hasOwn(escapes, next) ? escapes[next]! : "\\" + next);
      } else parts.push(character);
    }
    return parts.join("");
  }
  if (!value) return undefined;
  if (value[0] !== "-") return value;
  let index = 1;
  while (index < value.length) {
    const character = value[index]!;
    if (!(character === "-" || character === "_" || character === ":" || (character >= "0" && character <= "9") || (character >= "A" && character <= "Z") || (character >= "a" && character <= "z"))) break;
    index++;
  }
  if (index === 1) return value;
  if (value[index] === "#") index++;
  const nameEnd = index;
  while (index < value.length && whitespace(value[index]!)) index++;
  const operationStart = index;
  if (value[index] === "+" || value[index] === "-" || value[index] === "<") index++;
  if (value[index] !== "=") return value;
  index++;
  const operationEnd = index;
  if (value[index] === " ") index++;
  return value.slice(0, nameEnd) + value.slice(operationStart, operationEnd) + value.slice(index);
}

/** Invocation-local VFS expansion. No executable-directory search or EOF polling. */
export async function expandArgfiles(args: readonly string[], context: CommandContext, publication: Publication, resources: Resources): Promise<string[]> {
  const frames: { args: readonly string[]; index: number; path?: string }[] = [{ args, index: 0 }];
  const result: string[] = [];
  let literal = false;
  let takesValue = false;
  while (frames.length) {
    resources.signal.throwIfAborted();
    const frame = frames[frames.length - 1]!;
    if (frame.index >= frame.args.length) { frames.pop(); continue; }
    const arg = frame.args[frame.index++]!;
    resources.admit("work", arg.length + 1);
    const option = arg.toLowerCase();
    if (!literal && !takesValue && frame.path && (option === "-config" || option === "-common_args")) throw new Error("Configuration/common arguments are not allowed in argument files");
    if (!literal && !takesValue && option === "-@") {
      // Consume the filename from the expanded stream, including parent frames.
      while (frames.length && frames[frames.length - 1]!.index >= frames[frames.length - 1]!.args.length) frames.pop();
      const owner = frames[frames.length - 1];
      if (!owner) throw new Error("Missing argument for -@");
      const input = owner.args[owner.index++]!;
      if (input === "-" || input.includes("\0")) throw new Error("Argument-file stdin/invalid paths are not supported");
      const path = virtualPath(context.cwd, input, resources);
      if (frames.some(active => active.path === path)) throw new Error("Argument-file cycle is not supported");
      if (frames.length >= 16) throw new Error("Argument-file nesting limit exceeded");
      const stat = await publication.track(() => context.fs.lstat(path, { signal: context.signal }));
      if (stat.type !== "file") throw new Error("Only regular VFS argument files are admitted");
      resources.admit("input", stat.size);
      resources.admit("decoded", stat.size * 2);
      resources.admit("retained", stat.size * 48 + 256);
      resources.admit("work", stat.size * 24 + path.length);
      const bytes = await publication.track(async () => {
        if (!context.fs.readStream) {
          const result = await context.fs.readFile(path, { signal: context.signal, maxBytes: stat.size });
          context.signal.throwIfAborted();
          if (result.length > stat.size) throw new RangeError("ExifTool argument file grew beyond admitted size");
          return result;
        }
        const chunks: Uint8Array[] = []; let extent = 0;
        for await (const chunk of readBytes(context.fs.readStream(path, { signal: context.signal }), context.signal)) {
          if (chunk.length > stat.size - extent) throw new Error("Argument file grew beyond admitted size");
          resources.admit("retained", chunk.length + 128);
          resources.admit("work", chunk.length + 1);
          chunks.push(new Uint8Array(chunk)); extent += chunk.length;
        }
        const owned = new Uint8Array(extent); let offset = 0;
        for (const chunk of chunks) { owned.set(chunk, offset); offset += chunk.length; }
        return owned;
      });
      if (bytes.length > stat.size) throw new Error("Argument file grew beyond admitted size");
      let text: string;
      try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
      catch { throw new Error("Only UTF-8 argument files are currently supported"); }
      const expanded: string[] = [];
      let start = 0;
      for (let index = 0; index <= text.length; index++) {
        if (index !== text.length && text[index] !== "\n") continue;
        const value = filterArgfileLine(text.slice(start, index === text.length ? index : index + 1));
        start = index + 1;
        if (value !== undefined) {
          resources.admit("retained", value.length * 2 + 128);
          if (expanded.length >= 4096) throw new Error("Argument-file argument count exceeded");
          expanded.push(value);
        }
      }
      frames.push({ args: expanded, index: 0, path });
      continue;
    }
    if (!literal && !takesValue && arg === "--") literal = true;
    const wasValue: boolean = takesValue;
    takesValue = !literal && !wasValue && ["-config", "-api", "-o", "-if", "-p", "-stay_open"].includes(option);
    resources.admit("retained", arg.length * 2 + 128);
    if (result.length >= 4096) throw new Error("ExifTool argument count exceeded");
    result.push(arg);
  }
  return result;
}
