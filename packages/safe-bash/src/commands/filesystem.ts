import {
  basename, dirname, FsError, isPathWithin, joinPath, relativePath,
  type CommandContext, type CommandDefinition, type FileStat,
} from "../contracts/index.js";
import { codeOf, define, eachOperand, options, output, pathOf, requireOperands, UsageError, value } from "./internal.js";
import { compareCopyIdentity, compareObservedEntries } from "./copy-identity.js";
import { MoveBudget, moveAcrossDevices } from "./move.js";
import { admitFilesystemModes, filesystemCommandRequirements } from "./filesystem-requirements.js";

async function preflightOperands(
  context: CommandContext, operands: readonly string[], check: (operand: string) => Promise<void>,
): Promise<void> {
  for (const operand of operands) {
    try { await check(operand); }
    catch (error) {
      context.signal.throwIfAborted();
      if (codeOf(error) === "ENOTSUP" || codeOf(error) === "EROFS"
        || codeOf(error) === "ENOTEMPTY" && error instanceof FsError && codeOf(error.cause) === "ENOTSUP") throw error;
    }
  }
}

async function maybeStat(context: CommandContext, path: string, follow = true): Promise<FileStat | undefined> {
  try { return await context.fs[follow ? "stat" : "lstat"](path, { signal: context.signal }); }
  catch (error) { context.signal.throwIfAborted(); if (codeOf(error) === "ENOENT") return undefined; throw error; }
}

async function canonicalMissing(context: CommandContext, path: string): Promise<string> {
  try { return await context.fs.realpath(path, { signal: context.signal }); }
  catch (error) {
    context.signal.throwIfAborted();
    if (codeOf(error) !== "ENOENT" || path === "/") throw error;
    const link = await maybeStat(context, path, false);
    if (link?.type === "symlink") throw error;
    return joinPath(await canonicalMissing(context, dirname(path)), basename(path));
  }
}

function needCapability(context: CommandContext, capability: "symlink" | "link" | "readlink" | "utimes"): void {
  const declaration = { symlink: "symlinks", link: "hardlinks", readlink: "readlink", utimes: "timestamps" }[capability];
  if (!context.fs.capabilitiesFor && context.fs.capabilities[declaration] === false) throw new FsError("ENOTSUP", { syscall: capability });
  if (!context.fs[capability]) throw new FsError("ENOTSUP", { syscall: capability });
}

async function admitEmptyDirectory(context: CommandContext, path: string): Promise<void> {
  try { await admitFilesystemModes(context, "rmdir", ["directory"], [path]); }
  catch (error) {
    context.signal.throwIfAborted();
    if (codeOf(error) === "ENOTSUP") {
      const capabilities = await context.fs.capabilitiesFor?.(path, { signal: context.signal }) ?? context.fs.capabilities;
      if (capabilities.write !== false && capabilities.readdir !== false
        && (await context.fs.readdir(path, { signal: context.signal })).length) {
        throw new FsError("ENOTEMPTY", { syscall: "rmdir", path, cause: error });
      }
    }
    throw error;
  }
}

async function removeEmptyDirectory(context: CommandContext, path: string): Promise<void> {
  await admitEmptyDirectory(context, path);
  context.signal.throwIfAborted();
  if (!context.fs.rmdir) throw new FsError("ENOTSUP", { syscall: "rmdir", path });
  await context.fs.rmdir(path, { signal: context.signal });
}

async function destinations(context: CommandContext, operands: readonly string[]) {
  requireOperands(operands, 2);
  const target = pathOf(context, operands.at(-1)!);
  const directory = (await maybeStat(context, target))?.type === "directory";
  if (operands.length > 2 && !directory) throw new FsError("ENOTDIR", { path: target });
  return { target, directory, sources: operands.slice(0, -1) };
}

async function copy(
  context: CommandContext, source: string, target: string,
  flags: ReadonlySet<string>, top = true, ancestors = new Set<string>(),
  preflight = false,
): Promise<void> {
  context.signal.throwIfAborted();
  const link = await context.fs.lstat(source, { signal: context.signal });
  const preserveLink = link.type === "symlink" && !flags.has("L") && (flags.has("P") || !top);
  const sourceStat = preserveLink ? link : await context.fs.stat(source, { signal: context.signal });
  const targetStat = await maybeStat(context, target, !preserveLink);
  const physicalSource = preserveLink
    ? joinPath(await context.fs.realpath(dirname(source), { signal: context.signal }), basename(source))
    : await context.fs.realpath(source, { signal: context.signal });
  const physicalTarget = preserveLink
    ? joinPath(preflight ? await canonicalMissing(context, dirname(target))
      : await context.fs.realpath(dirname(target), { signal: context.signal }), basename(target))
    : await canonicalMissing(context, target);
  if (physicalSource === physicalTarget || compareCopyIdentity(sourceStat, targetStat) === "same") {
    throw new FsError("EINVAL", { path: source, dest: target, message: "source and destination are the same file" });
  }
  if (flags.has("n") && await maybeStat(context, target, false)) return;
  if (!preflight && !preserveLink && targetStat && await compareObservedEntries(context.fs, source, sourceStat, context.fs, target, targetStat, { signal: context.signal }) === "same") {
    throw new FsError("EINVAL", { path: source, dest: target, message: "source and destination are the same file" });
  }
  if (sourceStat.type === "directory") {
    if (!flags.has("r") && !flags.has("R")) throw new FsError("EISDIR", { path: source, message: "omitting directory (use -R)" });
    if (isPathWithin(physicalSource, physicalTarget)) throw new FsError("EINVAL", { path: target, message: "cannot copy a directory into itself" });
    if (ancestors.has(physicalSource)) throw new FsError("ELOOP", { path: source });
    if (targetStat && targetStat.type !== "directory") throw new FsError("ENOTDIR", { path: target });
    await admitFilesystemModes(context, "cp", ["recursive"], [target]);
    if (!targetStat && !preflight) await context.fs.mkdir(target, { mode: sourceStat.mode & 0o777, signal: context.signal });
    const next = new Set(ancestors).add(physicalSource);
    for (const entry of (await context.fs.readdir(source, { signal: context.signal })).sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0)) {
      await copy(context, joinPath(source, entry.name), joinPath(target, entry.name), flags, false, next, preflight);
    }
  } else if (preserveLink) {
    await admitFilesystemModes(context, "cp", ["symlink"], [target]);
    needCapability(context, "symlink"); needCapability(context, "readlink");
    const linkTarget = await context.fs.readlink!(source, { signal: context.signal });
    const existing = await maybeStat(context, target, false);
    if (existing) {
      await admitFilesystemModes(context, "cp", ["replace"], [target]);
      if (existing.type === "directory") throw new FsError("EISDIR", { path: target });
      const sourceEntry = await context.fs.lstat(source, { signal: context.signal });
      const identity = compareCopyIdentity(sourceEntry, existing);
      if (identity === "same") throw new FsError("EINVAL", { path: source, dest: target, message: "source and destination are the same file" });
      if (identity === "unknown") throw new FsError("ENOTSUP", { path: source, dest: target, message: "symbolic link copy unlink lacks authoritative distinctness" });
      context.signal.throwIfAborted();
      if (!preflight) await context.fs.rm(target, { recursive: false, signal: context.signal });
    }
    if (!preflight) await context.fs.symlink!(linkTarget, target, { signal: context.signal });
  } else {
    await admitFilesystemModes(context, "cp", ["file", ...flags.has("f") && targetStat ? ["replace", "exclusive"] : []], [target]);
    if (targetStat?.type === "directory") throw new FsError("EISDIR", { path: target });
    if (preflight) return;
    try { await context.fs.copyFile(source, target, { signal: context.signal }); }
    catch (error) {
      context.signal.throwIfAborted();
      if (!flags.has("f") || !targetStat || codeOf(error) !== "EACCES") throw error;
      const existing = await maybeStat(context, target, false);
      if (existing) {
        const sourceEntry = await context.fs.lstat(source, { signal: context.signal });
        const sourceContents = await context.fs.stat(source, { signal: context.signal });
        const contentsIdentity = existing.type === "symlink" ? compareCopyIdentity(sourceContents, existing)
          : await compareObservedEntries(context.fs, source, sourceContents, context.fs, target, existing, { signal: context.signal });
        const entryIdentity = sourceEntry.type === "symlink" ? compareCopyIdentity(sourceEntry, existing) : contentsIdentity;
        const identities = [entryIdentity, contentsIdentity];
        if (identities.includes("same")) throw new FsError("EINVAL", { path: source, dest: target, message: "source and destination are the same file" });
        if (identities.includes("unknown")) throw new FsError("ENOTSUP", { path: source, dest: target, message: "forced copy unlink lacks authoritative distinctness" });
        await context.fs.rm(target, { recursive: false, signal: context.signal });
      }
      await context.fs.copyFile(source, target, { exclusive: true, signal: context.signal });
    }
  }
  if (!preflight && flags.has("v")) await output(context, `'${source}' -> '${target}'\n`);
}

function modeText(stat: FileStat): string {
  let text = stat.type === "directory" ? "d" : stat.type === "symlink" ? "l" : "-";
  for (const shift of [6, 3, 0]) {
    const mode = stat.mode >> shift;
    text += (mode & 4 ? "r" : "-") + (mode & 2 ? "w" : "-") + (mode & 1 ? "x" : "-");
  }
  if (stat.mode & 0o4000) text = text.slice(0, 3) + (stat.mode & 0o100 ? "s" : "S") + text.slice(4);
  if (stat.mode & 0o2000) text = text.slice(0, 6) + (stat.mode & 0o010 ? "s" : "S") + text.slice(7);
  if (stat.mode & 0o1000) text = text.slice(0, 9) + (stat.mode & 0o001 ? "t" : "T");
  return text;
}

export function filesystemCommands(): CommandDefinition[] {
  return [
    define("mkdir", async context => {
      const parsed = options(context.args, "pm:v", { parents: "p", mode: "m", verbose: "v" });
      requireOperands(parsed.operands);
      const mode = value(parsed, "m");
      if (mode !== undefined && !/^[0-7]{1,4}$/u.test(mode)) throw new UsageError(`invalid mode '${mode}' (octal required)`);
      await preflightOperands(context, parsed.operands, operand => admitFilesystemModes(context, "mkdir",
        [parsed.flags.has("p") ? "parents" : "directory"], [pathOf(context, operand)]));
      return eachOperand(context, parsed.operands, async operand => {
        await context.fs.mkdir(pathOf(context, operand), { recursive: parsed.flags.has("p"), ...(mode === undefined ? {} : { mode: parseInt(mode, 8) }), signal: context.signal });
        if (parsed.flags.has("v")) await output(context, `mkdir: created directory '${operand}'\n`);
      });
    }),
    define("touch", async context => {
      const parsed = options(context.args, "camr:", { "no-create": "c", reference: "r" });
      requireOperands(parsed.operands);
      const reference = value(parsed, "r");
      const times = reference === undefined ? undefined : await context.fs.stat(pathOf(context, reference), { signal: context.signal });
      const now = Date.now();
      await preflightOperands(context, parsed.operands, async operand => {
        const path = pathOf(context, operand);
        const existing = await maybeStat(context, path);
        const modes = existing ? ["existing"] : parsed.flags.has("c") ? ["no-create"]
          : reference === undefined ? ["create"] : ["create", "existing"];
        await admitFilesystemModes(context, "touch", modes, [path]);
      });
      return eachOperand(context, parsed.operands, async operand => {
        const path = pathOf(context, operand);
        let existing = await maybeStat(context, path);
        if (!existing) {
          if (parsed.flags.has("c")) return;
          await admitFilesystemModes(context, "touch", reference === undefined ? ["create"] : ["create", "existing"], [path]);
          if (reference !== undefined) needCapability(context, "utimes");
          await context.fs.writeFile(path, new Uint8Array(), { flag: "wx", signal: context.signal });
          if (reference === undefined) return;
          existing = await context.fs.stat(path, { signal: context.signal });
        }
        needCapability(context, "utimes");
        await admitFilesystemModes(context, "touch", ["existing"], [path]);
        const accessOnly = parsed.flags.has("a") && !parsed.flags.has("m");
        const modifyOnly = parsed.flags.has("m") && !parsed.flags.has("a");
        await context.fs.utimes!(path, modifyOnly ? existing.atimeMs : times?.atimeMs ?? now,
          accessOnly ? existing.mtimeMs : times?.mtimeMs ?? now, { signal: context.signal });
      });
    }),
    define("cp", async context => {
      const parsed = options(context.args, "rRfnvPL", { recursive: "R", force: "f", "no-clobber": "n", verbose: "v", dereference: "L", "no-dereference": "P" });
      if (parsed.flags.has("P") && parsed.flags.has("L")) throw new UsageError("-P and -L cannot be combined");
      const destination = await destinations(context, parsed.operands);
      await preflightOperands(context, destination.sources, async operand => {
        const source = pathOf(context, operand);
        await copy(context, source, destination.directory ? joinPath(destination.target, basename(source)) : destination.target,
          parsed.flags, true, new Set(), true);
      });
      return eachOperand(context, destination.sources, async operand => {
        const source = pathOf(context, operand);
        await copy(context, source, destination.directory ? joinPath(destination.target, basename(source)) : destination.target, parsed.flags);
      });
    }),
    define("mv", async context => {
      const parsed = options(context.args, "fnv", { force: "f", "no-clobber": "n", verbose: "v" });
      const destination = await destinations(context, parsed.operands);
      const budget = new MoveBudget(context.signal);
      await preflightOperands(context, destination.sources, async operand => {
        const source = pathOf(context, operand);
        const target = destination.directory ? joinPath(destination.target, basename(source)) : destination.target;
        if (parsed.flags.has("n") && await maybeStat(context, target, false)) return;
        await admitFilesystemModes(context, "mv", ["rename"], [source, target]);
      });
      return eachOperand(context, destination.sources, async operand => {
        const source = pathOf(context, operand);
        const target = destination.directory ? joinPath(destination.target, basename(source)) : destination.target;
        if (parsed.flags.has("n") && await maybeStat(context, target, false)) return;
        try { await context.fs.rename(source, target, { signal: context.signal }); }
        catch (error) {
          context.signal.throwIfAborted();
          if (codeOf(error) !== "EXDEV") throw error;
          if (!await moveAcrossDevices(context, source, target, parsed.flags.has("n"), budget)) {
            if (!parsed.flags.has("n")) throw new FsError("EINVAL", { path: source, dest: target, message: "source and destination are the same file" });
            return;
          }
        }
        if (parsed.flags.has("v")) await output(context, `'${operand}' -> '${target}'\n`);
      });
    }),
    define("rm", async context => {
      const parsed = options(context.args, "rRfdv", { recursive: "r", force: "f", dir: "d", verbose: "v" });
      if (!parsed.flags.has("f")) requireOperands(parsed.operands);
      await preflightOperands(context, parsed.operands, async operand => {
        const path = pathOf(context, operand);
        const stat = await maybeStat(context, path, false);
        if (!stat) return;
        const mode = stat.type === "directory" ? parsed.flags.has("r") || parsed.flags.has("R") ? "recursive" : "directory" : "file";
        if (mode === "directory") await admitEmptyDirectory(context, path);
        else await admitFilesystemModes(context, "rm", [mode], [path]);
      });
      return eachOperand(context, parsed.operands, async operand => {
        const path = pathOf(context, operand);
        if (path === "/" || [".", ".."].includes(operand.replace(/\/+$/u, "").split("/").at(-1)!)) throw new FsError("EBUSY", { path, message: "refusing to remove root, '.' or '..'" });
        const stat = await maybeStat(context, path, false);
        if (!stat) {
          if (parsed.flags.has("f")) return;
          throw new FsError("ENOENT", { path });
        }
        const recursive = parsed.flags.has("r") || parsed.flags.has("R");
        if (stat.type === "directory" && !recursive && !parsed.flags.has("d")) throw new FsError("EISDIR", { path });
        if (stat.type === "directory" && !recursive) {
          try { await removeEmptyDirectory(context, path); }
          catch (error) {
            context.signal.throwIfAborted();
            if (!parsed.flags.has("f") || codeOf(error) !== "ENOENT") throw error;
          }
        } else {
          await context.fs.rm(path, { recursive, force: parsed.flags.has("f"), signal: context.signal });
        }
        if (parsed.flags.has("v")) await output(context, `removed '${operand}'\n`);
      });
    }),
    define("rmdir", async context => {
      const parsed = options(context.args, "pv", { parents: "p", verbose: "v" });
      requireOperands(parsed.operands);
      await preflightOperands(context, parsed.operands, async operand => {
        let path = pathOf(context, operand);
        const stop = dirname(pathOf(context, operand.split("/").find(part => part && part !== ".") ?? operand));
        do {
          await admitEmptyDirectory(context, path);
          path = dirname(path);
        } while (parsed.flags.has("p") && path !== "/" && path !== stop);
      });
      return eachOperand(context, parsed.operands, async operand => {
        let path = pathOf(context, operand);
        const stop = dirname(pathOf(context, operand.split("/").find(part => part && part !== ".") ?? operand));
        do {
          if (path === "/") throw new FsError("EBUSY", { path });
          await removeEmptyDirectory(context, path);
          if (parsed.flags.has("v")) await output(context, `rmdir: removing directory '${path}'\n`);
          path = dirname(path);
        } while (parsed.flags.has("p") && path !== "/" && path !== stop);
      });
    }),
    define("ln", async context => {
      const parsed = options(context.args, "sfnT", { symbolic: "s", force: "f", "no-dereference": "n", "no-target-directory": "T" });
      requireOperands(parsed.operands);
      if (parsed.flags.has("T")) requireOperands(parsed.operands, 2, 2);
      const operands = parsed.operands.length === 1 ? [...parsed.operands, "."] : parsed.operands;
      const target = pathOf(context, operands.at(-1)!);
      const directory = !parsed.flags.has("T") && (await maybeStat(context, target, !parsed.flags.has("n")))?.type === "directory";
      if (operands.length > 2 && !directory) throw new FsError("ENOTDIR", { path: target });
      const symbolic = parsed.flags.has("s");
      needCapability(context, symbolic ? "symlink" : "link");
      await preflightOperands(context, operands.slice(0, -1), async operand => {
        const destination = directory ? joinPath(target, basename(operand)) : target;
        const replacing = parsed.flags.has("f") && await maybeStat(context, destination, false);
        await admitFilesystemModes(context, "ln", [symbolic ? "symbolic" : "hard", ...replacing ? ["replace"] : []], [destination]);
      });
      return eachOperand(context, operands.slice(0, -1), async operand => {
        const destination = directory ? joinPath(target, basename(operand)) : target;
        const source = pathOf(context, operand);
        if (!symbolic && source === destination) throw new FsError("EEXIST", { path: destination });
        const existing = await maybeStat(context, destination, false);
        if (existing && parsed.flags.has("f")) {
          if (existing.type === "directory") throw new FsError("EISDIR", { path: destination });
          if (!symbolic) {
            await context.fs.stat(source, { signal: context.signal });
            const sourceEntry = joinPath(await context.fs.realpath(dirname(source), { signal: context.signal }), basename(source));
            const targetEntry = joinPath(await context.fs.realpath(dirname(destination), { signal: context.signal }), basename(destination));
            if (sourceEntry === targetEntry) throw new FsError("EEXIST", { path: destination, message: "source and destination are the same file" });
          }
          await context.fs.rm(destination, { signal: context.signal });
        }
        if (symbolic) await context.fs.symlink!(operand, destination, { signal: context.signal });
        else await context.fs.link!(source, destination, { signal: context.signal });
      });
    }),
    define("readlink", async context => {
      const parsed = options(context.args, "fenz", { canonicalize: "f", "canonicalize-existing": "e", zero: "z", "no-newline": "n" });
      requireOperands(parsed.operands);
      return eachOperand(context, parsed.operands, async operand => {
        const path = pathOf(context, operand);
        await admitFilesystemModes(context, "readlink", [parsed.flags.has("e") || parsed.flags.has("f") ? "canonical" : "link"], [path]);
        let result: string;
        if (parsed.flags.has("e")) result = await context.fs.realpath(path, { signal: context.signal });
        else if (parsed.flags.has("f")) {
          const existing = await maybeStat(context, path, false);
          result = existing ? await context.fs.realpath(path, { signal: context.signal }) : joinPath(await context.fs.realpath(dirname(path), { signal: context.signal }), basename(path));
        } else {
          needCapability(context, "readlink");
          result = await context.fs.readlink!(path, { signal: context.signal });
        }
        await output(context, result + (parsed.flags.has("n") ? "" : parsed.flags.has("z") ? "\0" : "\n"));
      });
    }),
    define("realpath", async context => {
      const args: string[] = [];
      const relative = new Map<string, string>();
      let ended = false;
      for (let index = 0; index < context.args.length; index++) {
        const argument = context.args[index]!;
        if (argument === "--") ended = true;
        const key = argument.split("=", 1)[0]!;
        if (!ended && (key === "--relative-to" || key === "--relative-base")) {
          const equals = argument.indexOf("=");
          const directory = equals < 0 ? context.args[++index] : argument.slice(equals + 1);
          if (directory === undefined) throw new UsageError(`option '${key}' requires an argument`);
          relative.set(key, directory);
        } else args.push(argument);
      }
      const parsed = options(args, "emz", { "canonicalize-existing": "e", "canonicalize-missing": "m", zero: "z" });
      requireOperands(parsed.operands);
      const canonical = async (operand: string): Promise<string> => {
        const path = pathOf(context, operand);
        await admitFilesystemModes(context, "realpath", ["canonical"], [path]);
        const existing = await maybeStat(context, path, false);
        return parsed.flags.has("m") ? await canonicalMissing(context, path)
          : parsed.flags.has("e") || existing ? await context.fs.realpath(path, { signal: context.signal })
          : joinPath(await context.fs.realpath(dirname(path), { signal: context.signal }), basename(path));
      };
      const baseOperand = relative.get("--relative-base");
      const toOperand = relative.get("--relative-to") ?? baseOperand;
      const base = baseOperand === undefined ? undefined : await canonical(baseOperand);
      const to = toOperand === undefined ? undefined : await canonical(toOperand);
      return eachOperand(context, parsed.operands, async operand => {
        const resolved = await canonical(operand);
        const display = to !== undefined && (base === undefined || isPathWithin(base, to) && isPathWithin(base, resolved))
          ? relativePath(to, resolved) || "." : resolved;
        await output(context, display + (parsed.flags.has("z") ? "\0" : "\n"));
      });
    }),
    define("ls", async context => {
      const parsed = options(context.args, "aAl1dFprRL", { all: "a", "almost-all": "A", directory: "d", classify: "F", reverse: "r", recursive: "R", dereference: "L" });
      const operands = parsed.operands.length ? parsed.operands : ["."];
      let headerWritten = false;
      const render = async (path: string, display: string) => {
        await admitFilesystemModes(context, "ls", ["entry"], [path]);
        const stat = await context.fs[parsed.flags.has("L") ? "stat" : "lstat"](path, { signal: context.signal });
        let suffix = stat.type === "directory" && (parsed.flags.has("F") || parsed.flags.has("p")) ? "/" : "";
        if (parsed.flags.has("F") && stat.type === "symlink") suffix = "@";
        else if (parsed.flags.has("F") && stat.type === "file" && stat.mode & 0o111) suffix = "*";
        if (parsed.flags.has("l")) {
          const date = new Date(stat.mtimeMs).toISOString().slice(0, 16).replace("T", " ");
          let target = "";
          if (stat.type === "symlink") {
            await admitFilesystemModes(context, "ls", ["link"], [path]);
            needCapability(context, "readlink"); target = ` -> ${await context.fs.readlink!(path, { signal: context.signal })}`;
          }
          await output(context, `${modeText(stat)} ${stat.nlink ?? 1} ${stat.uid ?? 0} ${stat.gid ?? 0} ${stat.size} ${date} ${display}${suffix}${target}\n`);
        } else await output(context, `${display}${suffix}\n`);
      };
      const list = async (path: string, display: string, header: boolean, ancestors = new Set<string>()): Promise<void> => {
        context.signal.throwIfAborted();
        await admitFilesystemModes(context, "ls", ["entry"], [path]);
        const stat = await context.fs[parsed.flags.has("L") || !parsed.flags.has("d") && !parsed.flags.has("l") ? "stat" : "lstat"](path, { signal: context.signal });
        if (stat.type !== "directory" || parsed.flags.has("d")) { await render(path, display); return; }
        await admitFilesystemModes(context, "ls", ["directory"], [path]);
        const physical = await context.fs.realpath(path, { signal: context.signal });
        if (ancestors.has(physical)) throw new FsError("ELOOP", { path });
        const next = new Set(ancestors).add(physical);
        if (header) { await output(context, `${headerWritten ? "\n" : ""}${display}:\n`); headerWritten = true; }
        const entries = await context.fs.readdir(path, { signal: context.signal });
        const names = entries.map(entry => entry.name).filter(name => parsed.flags.has("a") || parsed.flags.has("A") || !name.startsWith("."));
        if (parsed.flags.has("a")) names.push(".", "..");
        names.sort();
        if (parsed.flags.has("r")) names.reverse();
        for (const name of names) await render(joinPath(path, name), name);
        if (parsed.flags.has("R")) for (const name of names) {
          if (name === "." || name === "..") continue;
          const child = joinPath(path, name);
          const childStat = await context.fs[parsed.flags.has("L") ? "stat" : "lstat"](child, { signal: context.signal });
          if (childStat.type === "directory") await list(child, `${display.replace(/\/$/u, "")}/${name}`, true, next);
        }
      };
      return eachOperand(context, operands, operand => list(pathOf(context, operand), operand, operands.length > 1 || parsed.flags.has("R")));
    }),
  ].map(command => {
    const requirements = filesystemCommandRequirements[command.name as keyof typeof filesystemCommandRequirements];
    return requirements ? { ...command, filesystemRequirements: requirements } : command;
  });
}
