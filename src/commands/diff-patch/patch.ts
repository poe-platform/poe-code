import { dirname, resolvePath, writeBytes, type CommandContext, type FileStat } from "../../contracts/index.js";
import { Budget, ToolError, definition, host, inspect, integer, type DiffPatchOptions } from "./shared.js";
import { applyHunks, parseUnified, reversePatch } from "./unified.js";

interface PatchFlags { strip: number; input: string; reverse: boolean; dryRun: boolean; fuzz: number; target?: string }

function flags(args: readonly string[]): PatchFlags {
  const result: PatchFlags = { strip: 0, input: "-", reverse: false, dryRun: false, fuzz: 0 };
  const operands: string[] = [];
  let literal = false;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!;
    const value = (attached: string | undefined, name: string) => {
      const next = attached ?? args[++index];
      if (next === undefined) throw new ToolError(`${name} requires an argument`);
      return next;
    };
    if (literal || arg === "-" || !arg.startsWith("-")) operands.push(arg);
    else if (arg === "--") literal = true;
    else if (arg === "--dry-run") result.dryRun = true;
    else if (arg === "--reverse") result.reverse = true;
    else if (/^--(?:strip|input|fuzz)(?:=|$)/u.test(arg)) {
      const [name] = arg.split("=");
      const parameter = value(arg.includes("=") ? arg.slice(arg.indexOf("=") + 1) : undefined, name!);
      if (name === "--strip") result.strip = integer(parameter, "strip count");
      else if (name === "--fuzz") result.fuzz = integer(parameter, "fuzz");
      else result.input = parameter;
    } else if (arg.startsWith("--")) throw new ToolError(`unsupported option: ${arg}`);
    else for (let offset = 1; offset < arg.length; offset++) {
      const flag = arg[offset]!;
      if (flag === "R") result.reverse = true;
      else if (flag === "u") continue;
      else if (flag === "p" || flag === "i" || flag === "F") {
        const parameter = value(arg.slice(offset + 1) || undefined, `-${flag}`);
        if (flag === "p") result.strip = integer(parameter, "strip count");
        else if (flag === "F") result.fuzz = integer(parameter, "fuzz");
        else result.input = parameter;
        break;
      } else throw new ToolError(`unsupported option: -${flag}`);
    }
  }
  if (operands.length > 1) throw new ToolError("expected at most one target file; use -i for the patch input");
  if (operands.length) result.target = operands[0]!;
  if (!result.input || result.input.includes("\0")) throw new ToolError("invalid patch input path");
  return result;
}

function safeTarget(path: string, strip: number): string | undefined {
  if (path === "/dev/null") return undefined;
  if (path.length > 4096 || path.split("/").length > 256) throw new ToolError("path length/depth limit exceeded");
  if (!path || path.startsWith("/") || /[\\\0-\x1f\x7f]/u.test(path) || /^[A-Za-z]:/u.test(path)) throw new ToolError(`unsafe patch path: ${JSON.stringify(path)}`);
  const parts = path.split("/");
  if (parts.some(part => part === ".." || part === "")) throw new ToolError(`unsafe patch path: ${JSON.stringify(path)}`);
  const stripped = parts.slice(strip).filter(part => part !== ".").join("/");
  if (!stripped) throw new ToolError(`strip count removes entire patch path: ${path}`);
  return stripped;
}

function regular(stat: FileStat | undefined, path: string): void {
  if (stat && stat.type !== "file") throw new ToolError(`patch target is not a regular file: ${path}`);
  if (stat && (stat.nlink ?? 1) > 1) throw new ToolError(`hard-linked patch targets are unsupported: ${path}`);
}

interface Prepared {
  readonly path: string;
  readonly original: string | undefined;
  readonly result: string;
  readonly remove: boolean;
}

async function run(context: CommandContext, budget: Budget): Promise<number> {
  const options = flags(context.args);
  const explicit = options.target === undefined ? undefined : safeTarget(options.target, 0);
  if (options.target !== undefined && explicit === undefined) throw new ToolError("/dev/null is not an explicit target");
  if (options.input !== "-") {
    const stat = await inspect(budget, options.input);
    if (stat?.type !== "file") throw new ToolError("patch input must be a regular file");
  }
  const input = await budget.read(options.input === "-" ? "-" : resolvePath(context.cwd, options.input));
  const parsed = await parseUnified(input, budget);
  if (explicit && parsed.length !== 1) throw new ToolError("explicit target requires exactly one file patch");
  const prepared: Prepared[] = [];
  const paths = new Set<string>();
  for (const sourcePatch of parsed) {
    const patch = options.reverse ? reversePatch(sourcePatch) : sourcePatch;
    const oldName = safeTarget(patch.oldPath, options.strip);
    const newName = safeTarget(patch.newPath, options.strip);
    if (oldName === undefined && newName === undefined) throw new ToolError("both patch filenames are /dev/null");
    const oldPath = oldName === undefined ? undefined : resolvePath(context.cwd, oldName);
    const newPath = newName === undefined ? undefined : resolvePath(context.cwd, newName);
    const oldStat = oldPath === undefined ? undefined : await inspect(budget, oldPath);
    const newStat = newPath === undefined || newPath === oldPath ? oldStat : await inspect(budget, newPath);
    const path = explicit ? resolvePath(context.cwd, explicit) : oldStat ? oldPath! : newStat ? newPath! : oldPath ?? newPath!;
    if (paths.has(path)) throw new ToolError(`duplicate target in patch: ${path}`);
    paths.add(path);
    const stat = await inspect(budget, path);
    regular(stat, path);
    const parent = await inspect(budget, dirname(path));
    if (parent?.type !== "directory") throw new ToolError(`target parent directory must already exist: ${dirname(path)}`);
    const creation = oldName === undefined;
    const remove = newName === undefined;
    if (creation && stat) throw new ToolError(`creation target already exists: ${path}`, 1);
    if (!creation && !stat) throw new ToolError(`patch target does not exist: ${path}`, 1);
    if (creation && patch.hunks.some(hunk => hunk.oldCount !== 0 || hunk.oldStart !== 0)) throw new ToolError("creation patch contains old content");
    const original = stat ? await budget.read(path) : undefined;
    const result = await applyHunks(original ?? "", patch, options.fuzz, budget);
    if (remove && result !== "") throw new ToolError(`deletion patch leaves content: ${path}`, 1);
    prepared.push({ path, original, result, remove });
  }
  const status = prepared.map(item => `${options.dryRun ? "checking" : "patching"} file ${item.path}\n`).join("");
  budget.output(status);
  if (options.dryRun) {
    await writeBytes(context.stdout, Buffer.from(status), context.signal);
    return 0;
  }
  for (const item of prepared) {
    const stat = await inspect(budget, item.path);
    regular(stat, item.path);
    if ((stat === undefined) !== (item.original === undefined)) throw new ToolError(`target changed during preflight: ${item.path}`, 1);
    if (item.original !== undefined) {
      const current = await budget.read(item.path);
      if (current !== item.original) throw new ToolError(`target changed during preflight: ${item.path}`, 1);
    }
  }
  let committed = 0;
  for (const item of prepared) {
    try {
      const stat = await inspect(budget, item.path);
      regular(stat, item.path);
      if ((stat === undefined) !== (item.original === undefined)) throw new ToolError("target existence changed");
      if (item.remove) await host(context, () => context.fs.rm(item.path, { signal: context.signal }));
      else await host(context, () => context.fs.writeFile(item.path, Buffer.from(item.result), {
        signal: context.signal, flag: item.original === undefined ? "wx" : "w",
      }));
      committed++;
    } catch (error) {
      context.signal.throwIfAborted();
      throw new ToolError(`commit stopped; ${committed}/${prepared.length} files committed; failing operation may have side effects; path ${item.path}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  await writeBytes(context.stdout, Buffer.from(status), context.signal);
  return 0;
}

export function patchCommand(options: DiffPatchOptions) { return definition("patch", options, run); }
