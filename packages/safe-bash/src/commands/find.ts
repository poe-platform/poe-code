import { tryGetMemoryDirectoryEntryNamesSync } from "@poe-code/safe-fs/core";
import { modeChange } from "./metadata/chmod.js";
import { PublicDiagnostic } from "../diagnostics.js";
import { basename, FsError, getCommandArguments, type CommandDefinition, type CommandHandler, type FileStat } from "../contracts/index.js";
import { compilePattern } from "../shell/pattern.js";
import { getRuntimeBackingFileSystem, isSyncResolved } from "../fs/creation-mask.js";
import { codeOf, define, diagnostic, integer, output, pathOf, replaceArgument, RESOLVED_EXIT_ZERO, UsageError } from "./internal.js";
import { escapeText } from "../escaping.js";
import { createDirectoryReader } from "./directory-admission.js";
import { assertCommandRequirements } from "../contracts/command-requirements.js";
import { filesystemCommandRequirements } from "./filesystem-requirements.js";
import { compileFindFormat, FindFormatBudget, type FindFormatEntry } from "./find-format.js";

interface Entry extends FindFormatEntry { path: string; display: string; relative: string; depth: number; root: string; name: string; symlink: boolean; prune: boolean }
type Expression = (entry: Entry) => boolean | Promise<boolean>;
const SYNTHETIC_FILE_STAT: FileStat = Object.freeze({ type: "file", size: 0, mode: 0o644, mtimeMs: 0, atimeMs: 0, ctimeMs: 0 });
const SYNTHETIC_DIR_STAT: FileStat = Object.freeze({ type: "directory", size: 0, mode: 0o755, mtimeMs: 0, atimeMs: 0, ctimeMs: 0 });
const SYNTHETIC_SYMLINK_STAT: FileStat = Object.freeze({ type: "symlink", size: 0, mode: 0o777, mtimeMs: 0, atimeMs: 0, ctimeMs: 0 });
const SYNTHETIC_CHAR_STAT: FileStat = Object.freeze({ type: "character", size: 0, mode: 0o666, mtimeMs: 0, atimeMs: 0, ctimeMs: 0 });
const FIND_DIR_REQUIREMENTS = Object.freeze(["directory"]);
const cachedFindPatternsCS = new Map<string, (text: string) => boolean>();
const cachedFindPatternsCI = new Map<string, (text: string) => boolean>();
function getCachedFindPattern(pattern: string, caseInsensitive: boolean): ((text: string) => boolean) | undefined {
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern.charCodeAt(i);
    if (c === 91 || c === 92 || c === 93) return undefined;
  }
  const map = caseInsensitive ? cachedFindPatternsCI : cachedFindPatternsCS;
  let fn = map.get(pattern);
  if (!fn) {
    if (map.size >= 64) map.clear();
    const star = pattern.indexOf("*");
    if (!caseInsensitive && pattern.indexOf("?") === -1 && star !== -1 && pattern.indexOf("*", star + 1) === -1) {
      const prefix = pattern.slice(0, star);
      const suffix = pattern.slice(star + 1);
      const minLen = prefix.length + suffix.length;
      fn = (text: string) => text.length >= minLen && text.startsWith(prefix) && text.endsWith(suffix);
    } else {
      let rxSrc = "^";
      for (let i = 0; i < pattern.length; i++) {
        const ch = pattern[i]!;
        if (ch === "*") rxSrc += ".*";
        else if (ch === "?") rxSrc += ".";
        else if (".+^${}()|[]\\".includes(ch)) rxSrc += "\\" + ch;
        else rxSrc += ch;
      }
      rxSrc += "$";
      const rx = new RegExp(rxSrc, caseInsensitive ? "si" : "s");
      fn = (text: string) => rx.test(text);
    }
    map.set(pattern, fn);
  }
  return fn;
}
const sharedFindPrintBuf = new Uint8Array(8192);
function writeUtf8(buf: Uint8Array, pos: number, s: string): number {
  const len = s.length;
  for (let i = 0; i < len; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0x80) return Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength).write(s, pos, "utf8");
    buf[pos + i] = c;
  }
  return len;
}
let sharedFindPrintBufInUse = false;
const findKeyScratch: string[] = new Array(256).fill("");
let findKeyScratchTop = 0;
let findKeySorted = true;
let findKeyAllFiles = true;
let findKeyPrev = "";
let findKeyCurrentMatch: ((text: string) => boolean) | undefined;
const SHELLSORT_GAPS = [701, 301, 132, 57, 23, 10, 4, 1];
function collectFindKey(v: { readonly type?: string }, k: string): void {
  if (v.type !== "file") findKeyAllFiles = false;
  if (findKeyCurrentMatch !== undefined && !findKeyCurrentMatch(k)) return;
  if (findKeyPrev > k) findKeySorted = false;
  findKeyPrev = k;
  if (findKeyScratchTop === findKeyScratch.length) findKeyScratch.push(k);
  else findKeyScratch[findKeyScratchTop] = k;
  findKeyScratchTop++;
}
function sortFindKeyRange(start: number, end: number): void {
  const len = end - start;
  for (let g = 0; g < SHELLSORT_GAPS.length; g++) {
    const gap = SHELLSORT_GAPS[g]!;
    if (gap >= len) continue;
    for (let i = start + gap; i < end; i++) {
      const key = findKeyScratch[i]!;
      let j = i;
      while (j >= start + gap && findKeyScratch[j - gap]! > key) {
        findKeyScratch[j] = findKeyScratch[j - gap]!;
        j -= gap;
      }
      findKeyScratch[j] = key;
    }
  }
}
function stageAndSortFindKeys(map: ReadonlyMap<string, unknown>, baseOffset: number, match?: (text: string) => boolean): number {
  findKeyScratchTop = baseOffset;
  findKeySorted = true;
  findKeyAllFiles = true;
  findKeyPrev = "";
  const fastMap = map as { _next?: number; _keys?: string[]; _vals?: ({ readonly type?: string } | undefined)[] };
  if (typeof fastMap._next === "number" && fastMap._keys !== undefined && fastMap._vals !== undefined) {
    const next = fastMap._next;
    const keys = fastMap._keys;
    const vals = fastMap._vals;
    for (let i = 0; i < next; i++) {
      const v = vals[i];
      if (v !== undefined) {
        if (v.type !== "file") findKeyAllFiles = false;
        const k = keys[i]!;
        if (match !== undefined && !match(k)) continue;
        if (findKeyPrev > k) findKeySorted = false;
        findKeyPrev = k;
        if (findKeyScratchTop === findKeyScratch.length) findKeyScratch.push(k);
        else findKeyScratch[findKeyScratchTop] = k;
        findKeyScratchTop++;
      }
    }
  } else {
    findKeyCurrentMatch = match;
    map.forEach(collectFindKey as (v: unknown, k: string) => void);
    findKeyCurrentMatch = undefined;
  }
  if (!findKeySorted) {
    sortFindKeyRange(baseOffset, findKeyScratchTop);
  }
  return findKeyScratchTop;
}
function syntheticStatFor(type: FileStat["type"]): FileStat {
  return type === "file" ? SYNTHETIC_FILE_STAT : type === "directory" ? SYNTHETIC_DIR_STAT : type === "symlink" ? SYNTHETIC_SYMLINK_STAT : SYNTHETIC_CHAR_STAT;
}

export function findCommands(execute: CommandHandler, maxDirectoryEntries?: number): CommandDefinition[] {
  const readDirectory = createDirectoryReader(maxDirectoryEntries);
  return [define("find", context => {
    if (
      !context.argumentValues &&
      context.args.length === 3 &&
      (context.args[1] === "-name" || context.args[1] === "-iname") &&
      !sharedFindPrintBufInUse &&
      !context.signal.aborted
    ) {
      const rootDisplay = context.args[0]!;
      if (rootDisplay && !rootDisplay.startsWith("-") && rootDisplay !== "!" && rootDisplay !== "(") {
        const fastBacking = (context as { _fastMemoryBackingFs?: ReturnType<typeof getRuntimeBackingFileSystem> })._fastMemoryBackingFs;
        const backing = fastBacking ?? getRuntimeBackingFileSystem(context.fs);
        if (
          backing !== undefined &&
          backing.capabilitiesFor === undefined &&
          backing.capabilities.readOnly !== true &&
          backing.capabilities.readdir !== false &&
          backing.capabilities.realpath !== false
        ) {
          const path = pathOf(context, rootDisplay);
          if (path !== "/dev" && !path.startsWith("/dev/")) {
            const match = getCachedFindPattern(context.args[2]!, context.args[1] === "-iname");
            const memDirEntries = match !== undefined ? tryGetMemoryDirectoryEntryNamesSync(backing, path) : undefined;
            if (match !== undefined && memDirEntries !== undefined && memDirEntries.size <= (maxDirectoryEntries ?? Infinity)) {
              const keyBase = findKeyScratchTop;
              const keyEnd = stageAndSortFindKeys(memDirEntries, keyBase, match);
              if (findKeyAllFiles) {
                try {
                  assertCommandRequirements(context, filesystemCommandRequirements.ls, FIND_DIR_REQUIREMENTS, backing.capabilities);
                  if (fastBacking !== undefined) (context as unknown as { _chargeFastFsOp(): void })._chargeFastFsOp();
                  let parent = rootDisplay;
                  while (parent.endsWith("/") && parent.length > 1) parent = parent.slice(0, -1);
                  const escapedParent = escapeText(parent === "/" ? "" : parent, "display");
                  const rootName = basename(rootDisplay) || "/";
                  sharedFindPrintBufInUse = true;
                  let printPos = 0;
                  let overflow = false;
                  if (match(rootName)) {
                    const escRoot = escapeText(rootDisplay, "display");
                    if (escRoot.length + 1 <= sharedFindPrintBuf.length) {
                      for (let c = 0; c < escRoot.length; c++) sharedFindPrintBuf[printPos++] = escRoot.charCodeAt(c);
                      sharedFindPrintBuf[printPos++] = 10;
                    } else {
                      overflow = true;
                    }
                  }
                  if (!overflow) {
                    const pLen = escapedParent.length;
                    for (let i = keyBase; i < keyEnd; i++) {
                      const childName = findKeyScratch[i]!;
                      const escChild = escapeText(childName, "display");
                      const cLen = escChild.length;
                      if (printPos + pLen + cLen + 2 > sharedFindPrintBuf.length) {
                        overflow = true;
                        break;
                      }
                      for (let c = 0; c < pLen; c++) sharedFindPrintBuf[printPos++] = escapedParent.charCodeAt(c);
                      sharedFindPrintBuf[printPos++] = 47;
                      for (let c = 0; c < cLen; c++) sharedFindPrintBuf[printPos++] = escChild.charCodeAt(c);
                      sharedFindPrintBuf[printPos++] = 10;
                    }
                  }
                  if (!overflow) {
                    if (printPos === 0) {
                      sharedFindPrintBufInUse = false;
                      return RESOLVED_EXIT_ZERO;
                    }
                    const stdoutSink = context.stdout as { isPipeStage?: boolean; writeRangeSync?: (src: Uint8Array, len: number) => boolean };
                    if (!stdoutSink.isPipeStage && typeof stdoutSink.writeRangeSync === "function" && stdoutSink.writeRangeSync(sharedFindPrintBuf, printPos) !== false) {
                      sharedFindPrintBufInUse = false;
                      return RESOLVED_EXIT_ZERO;
                    }
                    const p = output(context, sharedFindPrintBuf.subarray(0, printPos));
                    if (isSyncResolved(p)) {
                      sharedFindPrintBufInUse = false;
                      return RESOLVED_EXIT_ZERO;
                    }
                    return p.then(() => {
                      sharedFindPrintBufInUse = false;
                      return RESOLVED_EXIT_ZERO;
                    });
                  }
                  sharedFindPrintBufInUse = false;
                } finally {
                  findKeyScratch.fill("", keyBase, keyEnd);
                  findKeyScratchTop = keyBase;
                }
              } else {
                findKeyScratch.fill("", keyBase, keyEnd);
                findKeyScratchTop = keyBase;
              }
            }
          }
        }
      }
    }
    return (async () => {
    const startedAt = Date.now();
    const rawArgumentValues = context.argumentValues ? getCommandArguments(context) : undefined;
    const args = rawArgumentValues ? [...rawArgumentValues.args] : [...context.args];
    const values = rawArgumentValues ? [...rawArgumentValues.values] : [...context.args];
    let follow = "-P";
    let debugTree = false;
    while (["-P", "-L", "-H", "-D"].includes(args[0] ?? "")) {
      const option = args.shift()!;
      values.shift();
      if (option !== "-D") { follow = option; continue; }
      const debug = args.shift();
      values.shift();
      if (debug === undefined) throw new UsageError("-D requires a debug option");
      if (debug !== "tree") throw new UsageError(`unsupported debug option '${debug}' (supported: tree)`);
      debugTree = true;
    }
    if (args[0] === "--") { args.shift(); values.shift(); }
    const roots: string[] = [];
    while (args.length && !args[0]!.startsWith("-") && !["!", "("].includes(args[0]!)) { roots.push(args.shift()!); values.shift(); }
    if (!roots.length) roots.push(".");
    let maxDepth = Infinity;
    let minDepth = 0;
    let depthFirst = false;
    let explicitDepth = false;
    let offset = 0;
    let explicitAction = false;
    let quitRequested = false;
    let exitCode = 0;
    let deletes = false;
    let prunes = false;
    let needsStat = false;
    let needsDisplay = false;
    const references = new Map<string, number>();
    const flushes: (() => Promise<void>)[] = [];
    const formats: (() => Promise<void>)[] = [];
    const formatBudget = new FindFormatBudget(context);
    const trees = new Map<Expression, string>();
    const primary = (): Expression => {
      const start = offset;
      const expression = parsePrimary();
      if (debugTree && !trees.has(expression)) trees.set(expression, JSON.stringify(args.slice(start, offset)));
      return expression;
    };
    const parsePrimary = (): Expression => {
      const token = args[offset++];
      if (token === undefined) throw new UsageError("missing expression");
      if (token === "!" || token === "-not") {
        const inner = primary();
        const expression: Expression = entry => {
          const res = inner(entry);
          return typeof res === "boolean" ? !res : res.then(v => !v);
        };
        if (debugTree) trees.set(expression, `NOT(${trees.get(inner)})`);
        return expression;
      }
      if (token === "(") {
        const inner = disjunction();
        if (args[offset++] !== ")") throw new UsageError("missing ')'");
        return inner;
      }
      if (token === "-depth") {
        depthFirst = true;
        explicitDepth = true;
        return () => true;
      }
      if (token === "-maxdepth" || token === "-mindepth") {
        const operand = args[offset++];
        if (operand === undefined) throw new UsageError(`${token} requires a number`);
        const number = integer(operand);
        if (token === "-maxdepth") maxDepth = number; else minDepth = number;
        return () => true;
      }
      if (["-name", "-iname", "-path", "-ipath", "-wholename", "-iwholename", "-regex", "-iregex", "-type", "-perm", "-links", "-size", "-mtime", "-mmin", "-amin", "-cmin", "-newer"].includes(token)) {
        const operand = args[offset++];
        if (operand === undefined) throw new UsageError(`${token} requires an argument`);
        if (token === "-regex" || token === "-iregex") {
          needsDisplay = true;
          let regex: RegExp;
          try { regex = new RegExp(`^(?:${operand})$`, token === "-iregex" ? "iu" : "u"); }
          catch { throw new UsageError(`invalid regular expression '${operand}'`); }
          return entry => regex.test(entry.display);
        }
        if (token === "-newer") {
          needsStat = true;
          references.set(operand, 0);
          return entry => entry.stat.mtimeMs > references.get(operand)!;
        }
        if (token === "-mtime" || token === "-mmin" || token === "-amin" || token === "-cmin") {
          needsStat = true;
          const match = /^([+-]?)([0-9]+)$/u.exec(operand);
          if (!match) throw new UsageError(`invalid time '${operand}'`);
          const amount = integer(match[2]!);
          const unit = token === "-mtime" ? 86_400_000 : 60_000;
          const origin = startedAt - (token === "-mtime" ? match[1] === "-" ? 1000 : unit : 0);
          const reference = origin - amount * unit;
          if (!Number.isSafeInteger(amount * unit) || !Number.isSafeInteger(reference) || !Number.isSafeInteger(reference + unit)) {
            throw new UsageError(`invalid time '${operand}': comparison is out of range`);
          }
          return async entry => {
            const stamp = token === "-amin" ? (entry.stat.atimeMs ?? entry.stat.mtimeMs) : token === "-cmin" ? (entry.stat.ctimeMs ?? entry.stat.mtimeMs) : entry.stat.mtimeMs;
            const delta = stamp - reference;
            return match[1] === "+" ? delta < 0 : match[1] === "-" ? delta > 0 : delta > 0 && delta <= unit;
          };
        }
        if (token === "-type") {
          const types: Record<string, string> = { f: "file", d: "directory", l: "symlink", c: "character" };
          const specialModes: Record<string, number> = { b: 0o060000, p: 0o010000, s: 0o140000 };
          const requested = operand.split(",");
          if (requested.some(type => !types[type] && !specialModes[type])) throw new UsageError(`unsupported file type '${operand}'`);
          if (requested.some(type => Boolean(specialModes[type]))) needsStat = true;
          if (requested.length === 1 && types[requested[0]!]) {
            const expectedType = types[requested[0]!]!;
            return entry => entry.stat.type === expectedType;
          }
          return entry => requested.some(type => specialModes[type]
            ? (entry.stat.mode & 0o170000) === specialModes[type] : entry.stat.type === types[type]);
        }
        if (token === "-perm") {
          needsStat = true;
          const comparison = operand[0] === "-" || operand[0] === "/" || (operand[0] === "+" && /^[0-7]/u.test(operand.slice(1))) ? operand[0] : "";
          const spec = comparison ? operand.slice(1) : operand;
          const evalMode = modeChange(spec, 0);
          return async entry => {
            const bits = evalMode({ mode: 0, type: entry.stat.type });
            const permissions = entry.stat.mode & 0o7777;
            return comparison === "-" ? (permissions & bits) === bits
              : (comparison === "/" || comparison === "+") ? bits === 0 || (permissions & bits) !== 0 : permissions === bits;
          };
        }
        if (token === "-links") {
          needsStat = true;
          const comparison = operand[0] === "+" || operand[0] === "-" ? operand[0] : "";
          const digits = comparison ? operand.slice(1) : operand;
          if (!digits || [...digits].some(digit => digit < "0" || digit > "9")) throw new UsageError(`invalid link count '${operand}'`);
          const count = integer(digits);
          return async entry => {
            if (entry.stat.nlink === undefined) throw new FsError("ENOTSUP", { path: entry.path, message: "link count unavailable" });
            return comparison === "+" ? entry.stat.nlink > count : comparison === "-" ? entry.stat.nlink < count : entry.stat.nlink === count;
          };
        }
        if (token === "-size") {
          needsStat = true;
          const comparison = operand[0] === "+" || operand[0] === "-" ? operand[0] : "";
          const units: Record<string, number> = { c: 1, w: 2, b: 512, k: 1024, M: 1048576, G: 1073741824 };
          const suffix = operand.at(-1)!;
          const unit = units[suffix] ?? 512;
          const digits = operand.slice(comparison ? 1 : 0, units[suffix] === undefined ? undefined : -1);
          if (!digits || [...digits].some(digit => digit < "0" || digit > "9")) throw new UsageError(`invalid size '${operand}'`);
          const size = integer(digits);
          return async entry => comparison === "+" ? Math.ceil(entry.stat.size / unit) > size : comparison === "-" ? Math.ceil(entry.stat.size / unit) < size : Math.ceil(entry.stat.size / unit) === size;
        }
        const ignoreCase = token === "-iname" || token === "-ipath" || token === "-iwholename";
        const work = {
          remaining: Infinity,
          signal: context.signal,
          exhausted(): never { throw new UsageError(`pattern work limit exceeded for '${operand}'`); },
        };
        const matcherPromise = compilePattern(operand, work, ignoreCase);
        let compiledMatcher: ((value: string) => boolean | Promise<boolean>) | undefined;
        formats.push(async () => { compiledMatcher = await matcherPromise; });
        const useName = token === "-name" || token === "-iname";
        if (!useName) needsDisplay = true;
        return entry => compiledMatcher!(useName ? entry.name : entry.display);
      }
      if (token === "-true" || token === "-false") return () => token === "-true";
      if (token === "-empty") { needsStat = true; return async entry => entry.stat.type === "directory" ? !(await readDirectory(context, entry.path)).length : entry.stat.type === "file" && entry.stat.size === 0; }
      if (token === "-prune") { prunes = true; return entry => { entry.prune = true; return true; }; }
      if (token === "-quit") { explicitAction = true; return () => { quitRequested = true; return true; }; }
      if (token === "-delete") {
        explicitAction = true;
        depthFirst = true;
        deletes = true;
        return async entry => {
          context.signal.throwIfAborted();
          if (basename(entry.display) === ".") return true;
          try {
            const directory = entry.stat.type === "directory" && !entry.symlink;
            const capabilities = await context.fs.capabilitiesFor?.(entry.path, { signal: context.signal }) ?? context.fs.capabilities;
            assertCommandRequirements(context, directory ? filesystemCommandRequirements.rmdir : filesystemCommandRequirements.rm,
              [directory ? "directory" : "file"], capabilities);
            if (directory) {
              if (!context.fs.rmdir || capabilities.snapshotRmdir) throw new FsError("ENOTSUP", { syscall: "rmdir", path: entry.path });
              await context.fs.rmdir(entry.path, { signal: context.signal });
            } else await context.fs.rm(entry.path, { recursive: false, signal: context.signal });
            context.signal.throwIfAborted();
            return true;
          } catch (error) { await diagnostic(context, error); exitCode = 1; return false; }
        };
      }
      if (token === "-print" || token === "-print0") {
        explicitAction = true;
        return async entry => { await output(context, token === "-print0" ? `${entry.display}\0` : `${escapeText(entry.display, "display")}\n`); return true; };
      }
      if (token === "-printf") {
        needsStat = true;
        if (args[offset] === undefined) throw new UsageError("-printf requires a format");
        const operand = values[offset++]!;
        let render: ((entry: FindFormatEntry) => Promise<void>) | undefined;
        formats.push(async () => { render = await compileFindFormat(operand, formatBudget); });
        explicitAction = true;
        return async entry => { await render!(entry); return true; };
      }
      if (token === "-exec") {
        explicitAction = true;
        const command: string[] = [];
        const start = offset;
        while (args[offset] !== undefined && args[offset] !== ";" && !(args[offset] === "+" && args[offset - 1] === "{}")) command.push(args[offset++]!);
        const commandArguments = (rawArgumentValues ?? getCommandArguments(context)).withValues(values.slice(start, offset));
        const terminator = args[offset++];
        if (!command.length || terminator === undefined) throw new UsageError("-exec requires a command terminated by ';' or '+'");
        if (terminator === ";") return async entry => {
          const invocation = commandArguments.withValues(commandArguments.values.map((argument, index) => replaceArgument(typeof argument === "string" ? argument : commandArguments.bytes(index)!, "{}", entry.display)));
          const childArguments = invocation.slice(1);
          return (await execute({ ...context, command: invocation.args[0]!, args: childArguments.args, argumentValues: childArguments, env: { ...context.env } })).exitCode === 0;
        };
        if (command.at(-1) !== "{}" || command.slice(0, -1).some(argument => argument.includes("{}"))) throw new UsageError("batched -exec requires exactly one final '{}' argument");
        const pending: string[] = [];
        let bytes = 0;
        const flush = async () => {
          if (!pending.length) return;
          const childArguments = commandArguments.withValues([...commandArguments.values.slice(1, -1), ...pending]);
          const result = await execute({ ...context, command: command[0]!, args: childArguments.args, argumentValues: childArguments, env: { ...context.env } });
          if (result.exitCode !== 0) exitCode = 1;
          pending.length = 0; bytes = 0;
        };
        flushes.push(flush);
        return async entry => {
          const size = Buffer.byteLength(entry.display) + 1;
          if (pending.length >= 1000 || bytes + size > 65536) await flush();
          pending.push(entry.display); bytes += size; return true;
        };
      }
      throw new UsageError(`unsupported expression '${token}'`);
    };
    const conjunction = (): Expression => {
      let predicate = primary();
      while (offset < args.length && !["-o", "-or", ",", ")"].includes(args[offset]!)) {
        if (args[offset] === "-a" || args[offset] === "-and") offset++;
        const left = predicate;
        const right = primary();
        predicate = entry => {
          const l = left(entry);
          return typeof l === "boolean" ? (l ? right(entry) : false) : l.then(lv => lv ? right(entry) : false);
        };
        if (debugTree) trees.set(predicate, `AND(${trees.get(left)}, ${trees.get(right)})`);
      }
      return predicate;
    };
    const disjunction = (): Expression => {
      let predicate = conjunction();
      while (args[offset] === "-o" || args[offset] === "-or") {
        offset++;
        const left = predicate;
        const right = conjunction();
        predicate = entry => {
          const l = left(entry);
          return typeof l === "boolean" ? (l ? true : right(entry)) : l.then(lv => lv ? true : right(entry));
        };
        if (debugTree) trees.set(predicate, `OR(${trees.get(left)}, ${trees.get(right)})`);
      }
      while (args[offset] === ",") {
        offset++;
        const left = predicate;
        const right = conjunction();
        predicate = entry => {
          const l = left(entry);
          return typeof l === "boolean" ? right(entry) : l.then(() => right(entry));
        };
        if (debugTree) trees.set(predicate, `LIST(${trees.get(left)}, ${trees.get(right)})`);
      }
      return predicate;
    };
    const evaluate: Expression = args.length ? disjunction() : () => true;
    if (offset !== args.length) throw new UsageError(`unexpected expression '${args[offset]}'`);
    for (const prepare of formats) await prepare();
    if (deletes && prunes && !explicitDepth) throw new PublicDiagnostic("-delete implies -depth; -prune is ineffective unless -depth is explicitly supplied");
    if (debugTree) {
      const tree = trees.get(evaluate) ?? "true";
      await context.stderr.write(new TextEncoder().encode(`find: virtual expression tree (evaluation order; no optimizer)\n${explicitAction ? tree : `AND(${tree}, implicit -print)`}\n`));
    }
    for (const reference of references.keys()) {
      context.signal.throwIfAborted();
      const path = pathOf(context, reference);
      let stat: FileStat;
      try { stat = await context.fs[follow !== "-P" ? "stat" : "lstat"](path, { signal: context.signal }); }
      catch (error) {
        context.signal.throwIfAborted();
        if (follow === "-P" || codeOf(error) !== "ENOENT") throw error;
        stat = await context.fs.lstat(path, { signal: context.signal });
      }
      context.signal.throwIfAborted();
      references.set(reference, stat.mtimeMs);
    }
    const useSharedPrintBuf = !sharedFindPrintBufInUse;
    if (useSharedPrintBuf) sharedFindPrintBufInUse = true;
    const printBuf = useSharedPrintBuf ? sharedFindPrintBuf : Buffer.allocUnsafe(8192);
    let printPos = 0;
    const flushPrintBuffer = (): Promise<void> | undefined => {
      if (printPos === 0) return undefined;
      const chunk = Uint8Array.prototype.slice.call(printBuf, 0, printPos);
      printPos = 0;
      const p = output(context, chunk);
      return isSyncResolved(p) ? undefined : p;
    };
    const appendPrintLine = async (escaped: string): Promise<void> => {
      const maxNeed = escaped.length * 3 + 1;
      if (printPos + maxNeed > printBuf.length) {
        const fp = flushPrintBuffer();
        if (fp) await fp;
      }
      if (maxNeed > printBuf.length) {
        const p = output(context, `${escaped}\n`);
        if (!isSyncResolved(p)) await p;
        return;
      }
      printPos += writeUtf8(printBuf, printPos, escaped);
      printBuf[printPos++] = 10;
    };
    const appendPrintChild = (escapedParent: string, escapedChild: string): Promise<void> | void => {
      const maxNeed = (escapedParent.length + escapedChild.length) * 3 + 2;
      if (printPos + maxNeed <= printBuf.length) {
        printPos += writeUtf8(printBuf, printPos, escapedParent);
        printBuf[printPos++] = 47;
        printPos += writeUtf8(printBuf, printPos, escapedChild);
        printBuf[printPos++] = 10;
        return;
      }
      return (async () => {
        const fp = flushPrintBuffer();
        if (fp) await fp;
        if (maxNeed > printBuf.length) {
          const p = output(context, `${escapedParent}/${escapedChild}\n`);
          if (!isSyncResolved(p)) await p;
          return;
        }
        printPos += writeUtf8(printBuf, printPos, escapedParent);
        printBuf[printPos++] = 47;
        printPos += writeUtf8(printBuf, printPos, escapedChild);
        printBuf[printPos++] = 10;
      })();
    };
    const canSkipChildStat = !needsStat && !explicitAction && follow !== "-L";
    const backing = getRuntimeBackingFileSystem(context.fs);
    const maxEntriesLimit = maxDirectoryEntries ?? Infinity;
    let uniformDirAdmitted = false;
    const scratchChildEntry: Entry = { path: "", display: "", name: "", stat: SYNTHETIC_FILE_STAT, symlink: false, depth: 0, root: "", relative: "", prune: false };
    const visit = async (display: string, depth: number, ancestors: ReadonlySet<string>, root: string, relative: string, knownName?: string, knownType?: FileStat["type"]): Promise<void> => {
      if (quitRequested) return;
      context.signal.throwIfAborted();
      const path = pathOf(context, display);
      try {
        const memDirEntries = canSkipChildStat && backing !== undefined && backing.capabilitiesFor === undefined
          && context.fs.capabilities.readOnly !== true && context.fs.capabilities.readdir !== false && context.fs.capabilities.realpath !== false
          && path !== "/dev" && !path.startsWith("/dev/")
          ? tryGetMemoryDirectoryEntryNamesSync(backing, path)
          : undefined;
        let stat: FileStat;
        let symlink: boolean;
        if (memDirEntries !== undefined) {
          if (!uniformDirAdmitted) {
            assertCommandRequirements(context, filesystemCommandRequirements.ls, ["directory"]);
            uniformDirAdmitted = true;
          }
          stat = SYNTHETIC_DIR_STAT;
          symlink = false;
        } else if (knownType !== undefined && canSkipChildStat && !(knownType === "symlink" && follow === "-H" && depth === 0)) {
          stat = syntheticStatFor(knownType);
          symlink = knownType === "symlink";
        } else {
          stat = await context.fs.lstat(path, { signal: context.signal });
          symlink = stat.type === "symlink";
          if ((follow === "-L" || follow === "-H" && depth === 0) && symlink) {
            try { stat = await context.fs.stat(path, { signal: context.signal }); }
            catch (error) { if (codeOf(error) !== "ENOENT") throw error; }
          }
        }
        const entry: Entry = { path, display, name: knownName ?? (basename(display) || "/"), stat, symlink, depth, root, relative, prune: false };
        if (!depthFirst && depth >= minDepth) {
          const res = evaluate(entry);
          const ok = typeof res === "boolean" ? res : await res;
          if (ok && !explicitAction) await appendPrintLine(escapeText(display, "display"));
          if (quitRequested) return;
        }
        if (stat.type === "directory" && depth < maxDepth && (!entry.prune || depthFirst)) {
          const physical = memDirEntries !== undefined ? path : await context.fs.realpath(path, { signal: context.signal });
          if (ancestors.has(physical)) throw new FsError("ELOOP", { path });
          let next: Set<string> | undefined;
          let parent = display;
          while (parent.endsWith("/")) parent = parent.slice(0, -1);
          const escapedParent = canSkipChildStat && !needsDisplay ? escapeText(parent, "display") : "";
          const childDepth = depth + 1;
          if (memDirEntries !== undefined && memDirEntries.size <= maxEntriesLimit) {
            const keyBase = findKeyScratchTop;
            const keyEnd = stageAndSortFindKeys(memDirEntries, keyBase);
            try {
              for (let i = keyBase; i < keyEnd; i++) {
                if (quitRequested) return;
                const childName = findKeyScratch[i]!;
                const childType = memDirEntries.get(childName)!.type;
                if (childType === "file" && childDepth <= 1024) {
                  if (childDepth >= minDepth) {
                    scratchChildEntry.name = childName;
                    scratchChildEntry.depth = childDepth;
                    scratchChildEntry.root = root;
                    scratchChildEntry.prune = false;
                    if (needsDisplay) {
                      const childDisplay = `${parent}/${childName}`;
                      scratchChildEntry.display = childDisplay;
                      scratchChildEntry.path = pathOf(context, childDisplay);
                      scratchChildEntry.relative = relative ? `${relative}/${childName}` : childName;
                    }
                    const res = evaluate(scratchChildEntry);
                    const ok = typeof res === "boolean" ? res : await res;
                    if (ok) {
                      if (needsDisplay) await appendPrintLine(escapeText(scratchChildEntry.display, "display"));
                      else {
                        const pending = appendPrintChild(escapedParent, escapeText(childName, "display"));
                        if (pending) await pending;
                      }
                    }
                  }
                  continue;
                }
                next ??= new Set(ancestors).add(physical);
                const childDisplay = `${parent}/${childName}`;
                const childRel = relative ? `${relative}/${childName}` : childName;
                await visit(childDisplay, childDepth, next, root, childRel, childName, childType);
              }
            } finally {
              findKeyScratch.fill("", keyBase, keyEnd);
              findKeyScratchTop = keyBase;
            }
          } else {
          const children = await readDirectory(context, path, true);
          for (const child of children) {
            if (quitRequested) return;
            if (canSkipChildStat && child.type === "file" && childDepth <= 1024) {
              if (childDepth >= minDepth) {
                scratchChildEntry.name = child.name;
                scratchChildEntry.depth = childDepth;
                scratchChildEntry.root = root;
                scratchChildEntry.prune = false;
                if (needsDisplay) {
                  const childDisplay = `${parent}/${child.name}`;
                  scratchChildEntry.display = childDisplay;
                  scratchChildEntry.path = pathOf(context, childDisplay);
                  scratchChildEntry.relative = relative ? `${relative}/${child.name}` : child.name;
                }
                const res = evaluate(scratchChildEntry);
                const ok = typeof res === "boolean" ? res : await res;
                if (ok) {
                  if (needsDisplay) await appendPrintLine(escapeText(scratchChildEntry.display, "display"));
                  else {
                    const pending = appendPrintChild(escapedParent, escapeText(child.name, "display"));
                    if (pending) await pending;
                  }
                }
              }
              continue;
            }
            next ??= new Set(ancestors).add(physical);
            const childDisplay = `${parent}/${child.name}`;
            const childRel = relative ? `${relative}/${child.name}` : child.name;
            await visit(childDisplay, childDepth, next, root, childRel, child.name, child.type);
          }
          }
        }
        if (depthFirst && depth >= minDepth) {
          const res = evaluate(entry);
          const ok = typeof res === "boolean" ? res : await res;
          if (ok && !explicitAction) await appendPrintLine(escapeText(display, "display"));
        }
        if (depth === 0 && printPos > 0) {
          const fp = flushPrintBuffer();
          if (fp) await fp;
        }
      } catch (error) {
        const fp = flushPrintBuffer();
        if (fp) await fp;
        await diagnostic(context, error);
        exitCode = 1;
      }
    };
    try {
      for (const root of roots) { if (quitRequested) break; await visit(root, 0, new Set(), root, ""); }
      const fp = flushPrintBuffer();
      if (fp) await fp;
      for (const flush of flushes) await flush();
      return { exitCode };
    } finally {
      if (useSharedPrintBuf) sharedFindPrintBufInUse = false;
    }
    })();
  })];
}
