import { basename, resolvePath, writeBytes, type CommandContext } from "../../contracts/index.js";
import { Budget, ToolError, definition, host, inspect, integer, type DiffPatchOptions } from "./shared.js";

interface DiffFlags {
  context: number;
  brief: boolean;
  recursive: boolean;
  newFile: boolean;
  labels: string[];
  files: string[];
}

function flags(args: readonly string[]): DiffFlags {
  const result: DiffFlags = { context: 3, brief: false, recursive: false, newFile: false, labels: [], files: [] };
  let operands = false;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!;
    const value = (attached: string | undefined, name: string) => {
      const next = attached ?? args[++index];
      if (next === undefined) throw new ToolError(`${name} requires an argument`);
      return next;
    };
    if (operands || arg === "-" || !arg.startsWith("-")) result.files.push(arg);
    else if (arg === "--") operands = true;
    else if (arg === "--brief") result.brief = true;
    else if (arg === "--recursive") result.recursive = true;
    else if (arg === "--new-file") result.newFile = true;
    else if (arg === "--unified") continue;
    else if (arg.startsWith("--unified=")) result.context = integer(arg.slice(10), "context");
    else if (arg === "--label" || arg.startsWith("--label=")) result.labels.push(value(arg.includes("=") ? arg.slice(8) : undefined, "--label"));
    else if (arg.startsWith("--")) throw new ToolError(`unsupported option: ${arg}`);
    else {
      for (let offset = 1; offset < arg.length; offset++) {
        const flag = arg[offset]!;
        if (flag === "u") continue;
        else if (flag === "q") result.brief = true;
        else if (flag === "r") result.recursive = true;
        else if (flag === "N") result.newFile = true;
        else if (flag === "U" || flag === "L") {
          const parameter = value(arg.slice(offset + 1) || undefined, `-${flag}`);
          if (flag === "U") result.context = integer(parameter, "context");
          else result.labels.push(parameter);
          break;
        } else throw new ToolError(`unsupported option: -${flag}`);
      }
    }
  }
  if (result.files.length !== 2) throw new ToolError("expected two files or directories");
  if (result.labels.length > 2) throw new ToolError("at most two labels are supported");
  for (const name of [...result.labels, ...result.files]) {
    if (!name || /[\0\r\n\t]/u.test(name)) throw new ToolError("empty names or control characters in filenames/labels are unsupported");
  }
  return result;
}

interface Edit { readonly kind: " " | "+" | "-"; readonly line: string }

async function edits(oldLines: string[], newLines: string[], budget: Budget): Promise<Edit[]> {
  let prefix = 0;
  while (prefix < Math.min(oldLines.length, newLines.length) && budget.equal(oldLines[prefix], newLines[prefix])) {
    prefix++;
    await budget.checkpoint();
  }
  let suffix = 0;
  while (suffix < Math.min(oldLines.length, newLines.length) - prefix
    && budget.equal(oldLines[oldLines.length - suffix - 1], newLines[newLines.length - suffix - 1])) {
    suffix++;
    await budget.checkpoint();
  }
  const oldCount = oldLines.length - prefix - suffix;
  const newCount = newLines.length - prefix - suffix;
  const cells = (oldCount + 1) * (newCount + 1);
  if (oldCount && newCount && cells > budget.limits.maxMatrixCells) throw new ToolError("diff matrix cell limit exceeded");
  const width = newCount + 1;
  const matrix = oldCount && newCount ? new Uint32Array(cells) : undefined;
  if (matrix) for (let oldIndex = oldCount - 1; oldIndex >= 0; oldIndex--) {
    for (let newIndex = newCount - 1; newIndex >= 0; newIndex--) {
      const position = oldIndex * width + newIndex;
      matrix[position] = budget.equal(oldLines[prefix + oldIndex], newLines[prefix + newIndex])
        ? 1 + matrix[position + width + 1]!
        : Math.max(matrix[position + width]!, matrix[position + 1]!);
      await budget.checkpoint();
    }
  }
  const result: Edit[] = oldLines.slice(0, prefix).map(line => ({ kind: " ", line }));
  let oldIndex = 0;
  let newIndex = 0;
  while (oldIndex < oldCount || newIndex < newCount) {
    budget.step();
    if (oldIndex < oldCount && newIndex < newCount && budget.equal(oldLines[prefix + oldIndex], newLines[prefix + newIndex])) {
      result.push({ kind: " ", line: oldLines[prefix + oldIndex++]! });
      newIndex++;
    } else if (oldIndex < oldCount && (newIndex === newCount || matrix![oldIndex * width + newIndex + width]! >= matrix![oldIndex * width + newIndex + 1]!)) {
      result.push({ kind: "-", line: oldLines[prefix + oldIndex++]! });
    } else result.push({ kind: "+", line: newLines[prefix + newIndex++]! });
    await budget.checkpoint();
  }
  for (const line of oldLines.slice(oldLines.length - suffix)) result.push({ kind: " ", line });
  return result;
}

function range(start: number, count: number): string {
  return count === 0 ? `${start},0` : count === 1 ? `${start + 1}` : `${start + 1},${count}`;
}

async function unified(oldText: string, newText: string, oldLabel: string, newLabel: string, context: number, budget: Budget, append: (text: string) => void): Promise<void> {
  const changes = await edits(budget.split(oldText), budget.split(newText), budget);
  append(`--- ${oldLabel}\n+++ ${newLabel}\n`);
  let scan = 0;
  let oldPosition = 0;
  let newPosition = 0;
  while (scan < changes.length) {
    let changed = scan;
    while (changed < changes.length && changes[changed]!.kind === " ") changed++;
    if (changed === changes.length) break;
    const start = Math.max(scan, changed - context);
    let lastChange = changed;
    let end = changed + 1;
    while (end < changes.length) {
      if (changes[end]!.kind !== " ") {
        if (end - lastChange - 1 > 2 * context) break;
        lastChange = end;
      }
      end++;
    }
    end = Math.min(changes.length, lastChange + context + 1);
    while (scan < start) {
      if (changes[scan]!.kind !== "+") oldPosition++;
      if (changes[scan++]!.kind !== "-") newPosition++;
    }
    let oldCount = 0;
    let newCount = 0;
    for (let index = start; index < end; index++) {
      if (changes[index]!.kind !== "+") oldCount++;
      if (changes[index]!.kind !== "-") newCount++;
    }
    budget.hunk();
    append(`@@ -${range(oldPosition, oldCount)} +${range(newPosition, newCount)} @@\n`);
    while (scan < end) {
      const edit = changes[scan++]!;
      append(`${edit.kind}${edit.line}${edit.line.endsWith("\n") ? "" : "\n\\ No newline at end of file\n"}`);
      budget.step();
      await budget.checkpoint();
    }
    oldPosition += oldCount;
    newPosition += newCount;
  }
}

async function run(context: CommandContext, budget: Budget): Promise<number> {
  const options = flags(context.args);
  const pieces: string[] = [];
  const append = (text: string) => { budget.output(text); pieces.push(text); };
  let different = false;
  let stdin: string | undefined;
  const pending: { left: string; right: string; nested: boolean }[] = [{ left: options.files[0]!, right: options.files[1]!, nested: false }];
  while (pending.length) {
    budget.file();
    await budget.checkpoint();
    const pair = pending.pop()!;
    let left = pair.left;
    let right = pair.right;
    let leftStat = left === "-" ? { type: "file" } : await inspect(budget, left);
    let rightStat = right === "-" ? { type: "file" } : await inspect(budget, right);
    if (!pair.nested && leftStat && rightStat && (leftStat.type === "directory") !== (rightStat.type === "directory")) {
      if (left === "-" || right === "-") throw new ToolError("cannot compare stdin with a directory");
      if (leftStat.type === "directory") { left = `${left}/${basename(right)}`; leftStat = await inspect(budget, left); }
      else { right = `${right}/${basename(left)}`; rightStat = await inspect(budget, right); }
    }
    if (!leftStat && !rightStat) throw new ToolError(`both paths are missing: ${left}, ${right}`);
    if ((!leftStat || !rightStat) && !options.newFile) {
      if (!pair.nested) throw new ToolError(`file not found: ${leftStat ? right : left}`);
      const present = leftStat ? left : right;
      append(`Only in ${present.slice(0, present.lastIndexOf("/"))}: ${basename(present)}\n`);
      different = true;
      continue;
    }
    if (leftStat?.type === "directory" || rightStat?.type === "directory") {
      if (leftStat && rightStat && leftStat.type !== rightStat.type) {
        append(`File ${left} is a ${leftStat.type} while file ${right} is a ${rightStat.type}\n`);
        different = true;
        continue;
      }
      if (pair.nested && !options.recursive) { append(`Common subdirectories: ${left} and ${right}\n`); continue; }
      const names = new Set<string>();
      for (const path of [leftStat ? left : undefined, rightStat ? right : undefined]) {
        if (path === undefined) continue;
        const entries = await host(context, () => context.fs.readdir(resolvePath(context.cwd, path), { signal: context.signal }));
        for (const entry of entries) {
          budget.step();
          if (!entry.name || entry.name === "." || entry.name === ".." || /[\/\\\0\r\n\t]/u.test(entry.name)) throw new ToolError("unsafe directory entry name");
          names.add(entry.name);
          if (names.size + pending.length > budget.limits.maxFiles) throw new ToolError("file/entry limit exceeded");
        }
      }
      for (const name of [...names].sort().reverse()) pending.push({ left: `${left}/${name}`, right: `${right}/${name}`, nested: true });
      continue;
    }
    const read = async (path: string, exists: boolean) => {
      if (!exists) return "";
      if (path === "-") return stdin ??= await budget.read("-");
      return budget.read(resolvePath(context.cwd, path));
    };
    const oldText = await read(left, !!leftStat);
    const newText = await read(right, !!rightStat);
    if (oldText === newText) continue;
    different = true;
    if (options.brief) append(`Files ${left} and ${right} differ\n`);
    else await unified(oldText, newText, options.labels[0] ?? (leftStat ? left : "/dev/null"), options.labels[1] ?? (rightStat ? right : "/dev/null"), options.context, budget, append);
  }
  await writeBytes(context.stdout, Buffer.from(pieces.join("")), context.signal);
  return different ? 1 : 0;
}

export function diffCommand(options: DiffPatchOptions) { return definition("diff", options, run); }
