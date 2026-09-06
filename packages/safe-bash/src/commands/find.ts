import { basename, FsError, getCommandArguments, type CommandDefinition, type CommandHandler, type FileStat } from "../contracts/index.js";
import { compilePattern } from "../shell/pattern.js";
import { codeOf, define, diagnostic, integer, output, pathOf, replaceArgument, UsageError } from "./internal.js";
import { escapeText } from "../escaping.js";
import { createDirectoryReader } from "./directory-admission.js";
import { assertCommandRequirements } from "../contracts/command-requirements.js";
import { filesystemCommandRequirements } from "./filesystem-requirements.js";

interface Entry { path: string; display: string; stat: FileStat; symlink: boolean; depth: number; prune: boolean }
type Expression = (entry: Entry) => Promise<boolean>;

export function findCommands(execute: CommandHandler, maxDirectoryEntries?: number): CommandDefinition[] {
  const readDirectory = createDirectoryReader(maxDirectoryEntries);
  return [define("find", async context => {
    const startedAt = Date.now();
    const argumentValues = getCommandArguments(context);
    const args = [...argumentValues.args];
    const values = [...argumentValues.values];
    let follow = false;
    while (args[0] === "-P" || args[0] === "-L") { follow = args.shift() === "-L"; values.shift(); }
    const roots: string[] = [];
    while (args.length && !args[0]!.startsWith("-") && !["!", "("].includes(args[0]!)) { roots.push(args.shift()!); values.shift(); }
    if (!roots.length) roots.push(".");
    let maxDepth = Infinity;
    let minDepth = 0;
    let depthFirst = false;
    let explicitDepth = false;
    for (let index = 0; index < args.length;) {
      if (args[index] === "-exec") {
        index++;
        while (index < args.length && args[index] !== ";" && args[index] !== "+") index++;
        index++;
      } else if (args[index] === "-maxdepth" || args[index] === "-mindepth") {
        if (args[index + 1] === undefined) throw new UsageError(`${args[index]} requires a number`);
        const number = integer(args[index + 1]!);
        if (args[index] === "-maxdepth") maxDepth = number; else minDepth = number;
        args.splice(index, 2);
        values.splice(index, 2);
      } else if (args[index] === "-depth") { depthFirst = true; explicitDepth = true; args.splice(index, 1); values.splice(index, 1); }
      else if (["-name", "-iname", "-path", "-ipath", "-type", "-size", "-mtime", "-mmin", "-newer"].includes(args[index]!)) index += 2;
      else index++;
    }
    let offset = 0;
    let explicitAction = false;
    let exitCode = 0;
    let deletes = false;
    let prunes = false;
    const references = new Map<string, number>();
    const flushes: (() => Promise<void>)[] = [];
    const primary = (): Expression => {
      const token = args[offset++];
      if (token === undefined) throw new UsageError("missing expression");
      if (token === "!" || token === "-not") { const inner = primary(); return async entry => !await inner(entry); }
      if (token === "(") {
        const inner = disjunction();
        if (args[offset++] !== ")") throw new UsageError("missing ')'");
        return inner;
      }
      if (["-name", "-iname", "-path", "-ipath", "-type", "-size", "-mtime", "-mmin", "-newer"].includes(token)) {
        const operand = args[offset++];
        if (operand === undefined) throw new UsageError(`${token} requires an argument`);
        if (token === "-newer") {
          references.set(operand, 0);
          return async entry => entry.stat.mtimeMs > references.get(operand)!;
        }
        if (token === "-mtime" || token === "-mmin") {
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
            const delta = entry.stat.mtimeMs - reference;
            return match[1] === "+" ? delta < 0 : match[1] === "-" ? delta > 0 : delta > 0 && delta <= unit;
          };
        }
        if (token === "-type") {
          const types: Record<string, string> = { f: "file", d: "directory", l: "symlink" };
          if (!types[operand]) throw new UsageError(`unsupported file type '${operand}'`);
          return async entry => entry.stat.type === types[operand];
        }
        if (token === "-size") {
          const match = /^([+-]?)([0-9]+)([cbkM]?)$/u.exec(operand);
          if (!match) throw new UsageError(`invalid size '${operand}'`);
          const size = integer(match[2]!);
          const unit = match[3] === "c" ? 1 : match[3] === "k" ? 1024 : match[3] === "M" ? 1048576 : 512;
          return async entry => match[1] === "+" ? Math.ceil(entry.stat.size / unit) > size : match[1] === "-" ? Math.ceil(entry.stat.size / unit) < size : Math.ceil(entry.stat.size / unit) === size;
        }
        const ignoreCase = token === "-iname" || token === "-ipath";
        const work = {
          remaining: 1_000_000,
          signal: context.signal,
          exhausted(): never { throw new UsageError(`pattern work limit exceeded for '${operand}'`); },
        };
        const matcher = compilePattern(ignoreCase ? operand.toLowerCase() : operand, work);
        return async entry => {
          const value = token === "-name" || token === "-iname" ? basename(entry.display) || entry.display : entry.display;
          return (await matcher)(ignoreCase ? value.toLowerCase() : value);
        };
      }
      if (token === "-true" || token === "-false") return async () => token === "-true";
      if (token === "-empty") return async entry => entry.stat.type === "directory" ? !(await readDirectory(context, entry.path)).length : entry.stat.type === "file" && entry.stat.size === 0;
      if (token === "-prune") { prunes = true; return async entry => { entry.prune = true; return true; }; }
      if (token === "-delete") {
        explicitAction = true;
        depthFirst = true;
        deletes = true;
        return async entry => {
          context.signal.throwIfAborted();
          if (entry.display === ".") return true;
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
      if (token === "-exec") {
        explicitAction = true;
        const command: string[] = [];
        const start = offset;
        while (args[offset] !== undefined && args[offset] !== ";" && args[offset] !== "+") command.push(args[offset++]!);
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
      while (offset < args.length && !["-o", "-or", ")"].includes(args[offset]!)) {
        if (args[offset] === "-a" || args[offset] === "-and") offset++;
        const left = predicate;
        const right = primary();
        predicate = async entry => await left(entry) && await right(entry);
      }
      return predicate;
    };
    const disjunction = (): Expression => {
      let predicate = conjunction();
      while (args[offset] === "-o" || args[offset] === "-or") {
        offset++;
        const left = predicate;
        const right = conjunction();
        predicate = async entry => await left(entry) || await right(entry);
      }
      return predicate;
    };
    const evaluate: Expression = args.length ? disjunction() : async () => true;
    if (offset !== args.length) throw new UsageError(`unexpected expression '${args[offset]}'`);
    if (deletes && prunes && !explicitDepth) throw new Error("-delete implies -depth; -prune is ineffective unless -depth is explicitly supplied");
    for (const reference of references.keys()) {
      context.signal.throwIfAborted();
      const path = pathOf(context, reference);
      let stat: FileStat;
      try { stat = await context.fs[follow ? "stat" : "lstat"](path, { signal: context.signal }); }
      catch (error) {
        context.signal.throwIfAborted();
        if (!follow || codeOf(error) !== "ENOENT") throw error;
        stat = await context.fs.lstat(path, { signal: context.signal });
      }
      context.signal.throwIfAborted();
      references.set(reference, stat.mtimeMs);
    }
    const visit = async (display: string, depth: number, ancestors: ReadonlySet<string>): Promise<void> => {
      context.signal.throwIfAborted();
      const path = pathOf(context, display);
      try {
        if (depth > 1024) throw new FsError("ELOOP", { path, message: "find depth limit exceeded (1024)" });
        let stat = await context.fs.lstat(path, { signal: context.signal });
        const symlink = stat.type === "symlink";
        if (follow && stat.type === "symlink") {
          try { stat = await context.fs.stat(path, { signal: context.signal }); }
          catch (error) { if (codeOf(error) !== "ENOENT") throw error; }
        }
        const entry: Entry = { path, display, stat, symlink, depth, prune: false };
        const apply = async () => { if (depth >= minDepth && await evaluate(entry) && !explicitAction) await output(context, `${escapeText(display, "display")}\n`); };
        if (!depthFirst) await apply();
        if (stat.type === "directory" && depth < maxDepth && (!entry.prune || depthFirst)) {
          const physical = await context.fs.realpath(path, { signal: context.signal });
          if (ancestors.has(physical)) throw new FsError("ELOOP", { path });
          const next = new Set(ancestors).add(physical);
          const children = await readDirectory(context, path, true);
          for (const child of children) await visit(`${display.replace(/\/$/u, "")}/${child.name}`, depth + 1, next);
        }
        if (depthFirst) await apply();
      } catch (error) { await diagnostic(context, error); exitCode = 1; }
    };
    for (const root of roots) await visit(root, 0, new Set());
    for (const flush of flushes) await flush();
    return { exitCode };
  })];
}
