import { modeChange } from "./metadata/chmod.js";
import { PublicDiagnostic } from "../diagnostics.js";
import { basename, FsError, getCommandArguments, type CommandDefinition, type CommandHandler, type FileStat } from "../contracts/index.js";
import { compilePattern } from "../shell/pattern.js";
import { codeOf, define, diagnostic, integer, output, pathOf, replaceArgument, UsageError } from "./internal.js";
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
function syntheticStatFor(type: FileStat["type"]): FileStat {
  return type === "file" ? SYNTHETIC_FILE_STAT : type === "directory" ? SYNTHETIC_DIR_STAT : type === "symlink" ? SYNTHETIC_SYMLINK_STAT : SYNTHETIC_CHAR_STAT;
}

export function findCommands(execute: CommandHandler, maxDirectoryEntries?: number): CommandDefinition[] {
  const readDirectory = createDirectoryReader(maxDirectoryEntries);
  return [define("find", async context => {
    const startedAt = Date.now();
    const argumentValues = getCommandArguments(context);
    const args = [...argumentValues.args];
    const values = [...argumentValues.values];
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
          remaining: 1_000_000,
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
        const commandArguments = argumentValues.withValues(values.slice(start, offset));
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
    const printBuf = Buffer.allocUnsafe(8192);
    let printPos = 0;
    const flushPrintBuffer = async (): Promise<void> => {
      if (printPos === 0) return;
      const chunk = printBuf.subarray(0, printPos);
      printPos = 0;
      await output(context, chunk);
    };
    const appendPrintLine = async (escaped: string): Promise<void> => {
      const maxNeed = escaped.length * 3 + 1;
      if (printPos + maxNeed > printBuf.length) await flushPrintBuffer();
      if (maxNeed > printBuf.length) {
        await output(context, `${escaped}\n`);
        return;
      }
      printPos += printBuf.write(escaped, printPos, "utf8");
      printBuf[printPos++] = 10;
    };
    const appendPrintChild = async (escapedParent: string, escapedChild: string): Promise<void> => {
      const maxNeed = (escapedParent.length + escapedChild.length) * 3 + 2;
      if (printPos + maxNeed > printBuf.length) await flushPrintBuffer();
      if (maxNeed > printBuf.length) {
        await output(context, `${escapedParent}/${escapedChild}\n`);
        return;
      }
      printPos += printBuf.write(escapedParent, printPos, "utf8");
      printBuf[printPos++] = 47;
      printPos += printBuf.write(escapedChild, printPos, "utf8");
      printBuf[printPos++] = 10;
    };
    const canSkipChildStat = !needsStat && !explicitAction && follow !== "-L";
    const scratchChildEntry: Entry = { path: "", display: "", name: "", stat: SYNTHETIC_FILE_STAT, symlink: false, depth: 0, root: "", relative: "", prune: false };
    const visit = async (display: string, depth: number, ancestors: ReadonlySet<string>, root: string, relative: string, knownName?: string, knownType?: FileStat["type"]): Promise<void> => {
      if (quitRequested) return;
      context.signal.throwIfAborted();
      const path = pathOf(context, display);
      try {
        if (depth > 1024) throw new FsError("ELOOP", { path, message: "find depth limit exceeded (1024)" });
        let stat: FileStat;
        let symlink: boolean;
        if (knownType !== undefined && canSkipChildStat && !(knownType === "symlink" && follow === "-H" && depth === 0)) {
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
          const physical = await context.fs.realpath(path, { signal: context.signal });
          if (ancestors.has(physical)) throw new FsError("ELOOP", { path });
          const next = new Set(ancestors).add(physical);
          const children = await readDirectory(context, path, true);
          let parent = display;
          while (parent.endsWith("/")) parent = parent.slice(0, -1);
          const escapedParent = canSkipChildStat && !needsDisplay ? escapeText(parent, "display") : "";
          const childDepth = depth + 1;
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
                  else await appendPrintChild(escapedParent, escapeText(child.name, "display"));
                }
              }
              continue;
            }
            const childDisplay = `${parent}/${child.name}`;
            const childRel = relative ? `${relative}/${child.name}` : child.name;
            await visit(childDisplay, childDepth, next, root, childRel, child.name, child.type);
          }
        }
        if (depthFirst && depth >= minDepth) {
          const res = evaluate(entry);
          const ok = typeof res === "boolean" ? res : await res;
          if (ok && !explicitAction) await appendPrintLine(escapeText(display, "display"));
        }
      } catch (error) {
        if (formatBudget.exhausted) throw error;
        await flushPrintBuffer();
        await diagnostic(context, error);
        exitCode = 1;
      }
    };
    for (const root of roots) { if (quitRequested) break; await visit(root, 0, new Set(), root, ""); }
    await flushPrintBuffer();
    for (const flush of flushes) await flush();
    return { exitCode };
  })];
}
