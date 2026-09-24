import { basename, createCommandArguments, toByteSource, writeBytes, type CommandContext } from "../../contracts/index.js";
import { pathOf } from "../internal.js";
import { Budget, ToolError, definition, host, inspect, type DiffPatchOptions } from "./shared.js";
import { contextual, normal, type Edit } from "./diff-format.js";
import { sideBySide, script, ifdef, expandTabs } from "./diff-output.js";
import { flags, type DiffFlags } from "./diff-options.js";
import { Pattern } from "../text-programs/regex.js";
import { createPrCommand } from "../pr/index.js";

async function comparisonLines(lines: string[], options: DiffFlags, budget: Budget): Promise<string[]> {
  const whitespace = options.whitespace;
  if (whitespace === "exact" && !options.ignoreCase && !options.ignoreTabs && !options.ignoreTrailing) return lines;
  const result: string[] = [];
  for (const line of lines) {
    budget.step(1 + line.length);
    await budget.checkpoint();
    let body = line.endsWith("\n") ? line.slice(0, -1) : line;
    if (options.ignoreTabs) body = expandTabs(body);
    if (whitespace !== "exact") body = body.replace(/[ \t\v\f\r]+/gu, whitespace === "all" ? "" : " ");
    if (options.ignoreTrailing || whitespace !== "exact") body = body.replace(/[ \t\v\f\r]+$/u, "");
    if (options.ignoreCase) body = body.replace(/[A-Z]/gu, letter => letter.toLowerCase());
    // Whitespace options ignore an absent final LF; -i alone does not.
    result.push(body + (whitespace !== "exact" || options.ignoreTrailing || options.ignoreTabs ? "" : line.endsWith("\n") ? "\n" : ""));
  }
  return result;
}

async function equivalent(oldKeys: string[], newKeys: string[], budget: Budget): Promise<boolean> {
  if (oldKeys.length !== newKeys.length) return false;
  for (let index = 0; index < oldKeys.length; index++) {
    if (!budget.equal(oldKeys[index], newKeys[index])) return false;
    await budget.checkpoint();
  }
  return true;
}

async function edits(oldLines: string[], newLines: string[], oldKeys: string[], newKeys: string[], budget: Budget): Promise<Edit[]> {
  let prefix = 0;
  while (prefix < Math.min(oldLines.length, newLines.length) && budget.equal(oldKeys[prefix], newKeys[prefix])) {
    prefix++;
    await budget.checkpoint();
  }
  let suffix = 0;
  while (suffix < Math.min(oldLines.length, newLines.length) - prefix
    && budget.equal(oldKeys[oldLines.length - suffix - 1], newKeys[newLines.length - suffix - 1])) {
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
      matrix[position] = budget.equal(oldKeys[prefix + oldIndex], newKeys[prefix + newIndex])
        ? 1 + matrix[position + width + 1]!
        : Math.max(matrix[position + width]!, matrix[position + 1]!);
      await budget.checkpoint();
    }
  }
  const result: Edit[] = oldLines.slice(0, prefix).map((line, index) => ({ kind: " ", line, newLine: newLines[index]! }));
  let oldIndex = 0;
  let newIndex = 0;
  while (oldIndex < oldCount || newIndex < newCount) {
    budget.step();
    if (oldIndex < oldCount && newIndex < newCount && budget.equal(oldKeys[prefix + oldIndex], newKeys[prefix + newIndex])) {
      result.push({ kind: " ", line: oldLines[prefix + oldIndex++]!, newLine: newLines[prefix + newIndex++]! });
    } else if (oldIndex < oldCount && (newIndex === newCount || matrix![oldIndex * width + newIndex + width]! >= matrix![oldIndex * width + newIndex + 1]!)) {
      result.push({ kind: "-", line: oldLines[prefix + oldIndex++]! });
    } else result.push({ kind: "+", line: newLines[prefix + newIndex++]! });
    await budget.checkpoint();
  }
  for (let index = 0; index < suffix; index++) {
    result.push({ kind: " ", line: oldLines[oldLines.length - suffix + index]!, newLine: newLines[newLines.length - suffix + index]! });
    budget.step();
    await budget.checkpoint();
  }
  return result;
}

async function exclusionPatterns(options: DiffFlags, budget: Budget): Promise<Pattern[]> {
  const exclusions: Pattern[] = [];
  let patternBytes = 0;
  const append = async (source: string, start = 0, end = source.length) => {
    budget.step(1 + end - start);
    await budget.checkpoint();
    if (exclusions.length >= budget.limits.maxExcludePatterns) throw new ToolError("exclusion pattern count limit exceeded");
    // UTF-16 length is a lower bound on UTF-8 bytes; admit the slice before allocating it.
    const remaining = budget.limits.maxExcludePatternBytes - patternBytes;
    if (end - start > remaining) throw new ToolError("exclusion pattern byte limit exceeded");
    const sourcePattern = source.slice(start, end);
    const bytes = Buffer.byteLength(sourcePattern);
    if (bytes > remaining) throw new ToolError("exclusion pattern byte limit exceeded");
    patternBytes += bytes;
    exclusions.push(globPattern(sourcePattern));
  };
  for (const pattern of options.excludes) await append(pattern);
  for (const path of options.excludeFiles) {
    if (path !== "-") await inspect(budget, path);
    const contents = await budget.read(path === "-" ? "-" : pathOf(budget.context, path));
    let start = 0;
    while (start < contents.length) {
      const newline = contents.indexOf("\n", start);
      const end = newline < 0 ? contents.length : newline;
      if (end > start) await append(contents, start, end);
      else { budget.step(); await budget.checkpoint(); }
      start = end + 1;
    }
  }
  return exclusions;
}

async function run(context: CommandContext, budget: Budget): Promise<number> {
  const options = flags(context.args);
  const exclusions = await exclusionPatterns(options, budget);
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
      // Each side may contain all the same names; only their union consumes pairs.
      const maxEntries = budget.remainingFiles - pending.length;
      for (const path of [leftStat ? left : undefined, rightStat ? right : undefined]) {
        if (path === undefined) continue;
        const entries = await host(context, () => context.fs.readdir(pathOf(context, path), { signal: context.signal, maxEntries }));
        if (entries.length > maxEntries) throw new ToolError("file/entry limit exceeded");
        for (const entry of entries) {
          budget.step();
          if (!entry.name || entry.name === "." || entry.name === ".." || /[\/\\\0\r\n\t]/u.test(entry.name)) throw new ToolError("unsafe directory entry name");
          names.add(entry.name);
          if (names.size > maxEntries) throw new ToolError("file/entry limit exceeded");
        }
      }
      for (const name of [...names].sort().reverse()) {
        if (!pair.nested && options.startingFile !== undefined && name < options.startingFile) continue;
        let excluded = false;
        for (const pattern of exclusions) if (await pattern.find(name, budget)) { excluded = true; break; }
        if (!excluded) pending.push({ left: `${left}/${name}`, right: `${right}/${name}`, nested: true });
      }
      continue;
    }
    const read = async (path: string, exists: boolean) => {
      if (!exists) return "";
      if (path === "-") return stdin ??= await budget.read("-", "latin1");
      return budget.read(pathOf(context, path), "latin1");
    };
    const oldBytes = await read(left, !!leftStat);
    const newBytes = await read(right, !!rightStat);
    const reportSame = () => { if (options.reportSame) append(`Files ${options.labels[0] ?? left} and ${options.labels[1] ?? right} are identical\n`); };
    // Latin-1 preserves byte identity before binary inputs reach text validation.
    if (!options.text && oldBytes.includes("\0") && oldBytes === newBytes) { reportSame(); continue; }
    const oldText = options.text ? oldBytes : budget.text(Buffer.from(oldBytes, "latin1"));
    const newText = options.text ? newBytes : budget.text(Buffer.from(newBytes, "latin1"));
    if (oldText === newText && options.format !== "side" && options.format !== "ifdef") { reportSame(); continue; }
    const oldLines = budget.split(oldText);
    const newLines = budget.split(newText);
    const oldKeys = await comparisonLines(oldLines, options, budget);
    const newKeys = await comparisonLines(newLines, options, budget);
    const same = oldText === newText || await equivalent(oldKeys, newKeys, budget);
    const changes = await edits(oldLines, newLines, oldKeys, newKeys, budget);
    if (!same) await ignoreChanges(changes, options, budget);
    const changed = changes.some(edit => edit.kind !== " " && !edit.ignored);
    different ||= changed;
    const label = (name: string) => options.text ? Buffer.from(name).toString("latin1") : name;
    if (!changed && options.reportSame) append(`Files ${label(options.labels[0] ?? left)} and ${label(options.labels[1] ?? right)} are identical\n`);
    if (options.brief) { if (changed) append(`Files ${label(options.labels[0] ?? left)} and ${label(options.labels[1] ?? right)} differ\n`); }
    else if (options.format === "side") await sideBySide(changes, options, budget, append);
    else if (options.format === "ifdef") await ifdef(changes, options.symbol, budget, append);
    else if (changed) {
      if (options.format === "normal") {
        if (pair.nested) append(label(["diff", ...options.optionArgs, left, right].join(" ")) + "\n");
        await normal(changes, budget, append, options);
      }
      else if (options.format === "ed" || options.format === "rcs") await script(changes, options.format, budget, append);
      else await contextual(changes, options.format, label(options.labels[0] ?? (leftStat ? left : "/dev/null")), label(options.labels[1] ?? (rightStat ? right : "/dev/null")), options.context, budget, append, options, options.functions.length ? async position => {
        for (let index = position - 1; index >= 0; index--) {
          for (const pattern of options.functions) if (await pattern.find(oldLines[index]!, budget)) return oldLines[index]!.replace(/\n$/u, "").slice(0, 40);
          budget.step();
          await budget.checkpoint();
        }
        return "";
      } : undefined);
    }
  }
  const output = Buffer.from(pieces.join(""), options.text ? "latin1" : "utf8");
  if (options.paginate && output.length) {
    const title = ["diff", ...context.args].join(" ");
    const argumentValues = createCommandArguments(["-f", "-h", title]);
    const pages: Uint8Array[] = [];
    const result = await createPrCommand({ limits: { maxInputBytes: budget.limits.maxOutputBytes, maxOutputBytes: budget.limits.maxOutputBytes, maxWork: Math.max(1, budget.remainingWork) } }).execute({
      ...context, command: "pr", args: argumentValues.args, argumentValues, stdin: toByteSource(output),
      stdout: { async write(chunk) { pages.push(chunk.slice()); } },
    });
    if (result.exitCode) return 2;
    await writeBytes(context.stdout, Buffer.concat(pages), context.signal);
  } else await writeBytes(context.stdout, output, context.signal);
  return different ? 1 : 0;
}

function globPattern(source: string): Pattern {
  let result = "^";
  let bracket = false;
  for (let index = 0; index < source.length; index++) {
    const character = source[index]!;
    if (character === "\\" && index + 1 < source.length) result += `\\${source[++index]}`;
    else if (character === "[") { bracket = source.indexOf("]", index + 1) >= 0; result += bracket ? "[" : "\\["; }
    else if (bracket) { result += character === "!" && source[index - 1] === "[" ? "^" : character; if (character === "]") bracket = false; }
    else if (character === "*") result += ".*";
    else if (character === "?") result += ".";
    else result += ".^$+(){}|]".includes(character) ? `\\${character}` : character;
  }
  return new Pattern(result + "$", true);
}

async function ignoreChanges(changes: Edit[], options: DiffFlags, budget: Budget): Promise<void> {
  if (!options.ignoreBlank && !options.ignorePatterns.length) return;
  let scan = 0;
  while (scan < changes.length) {
    budget.step();
    await budget.checkpoint();
    if (changes[scan]!.kind === " ") { scan++; continue; }
    const start = scan;
    let ignored = true;
    while (scan < changes.length && changes[scan]!.kind !== " ") {
      const edit = changes[scan++]!;
      const body = edit.line.endsWith("\n") ? edit.line.slice(0, -1) : edit.line;
      let matches = options.ignoreBlank && (body === "" || options.whitespace !== "exact" && /^[ \t\v\f\r]*$/u.test(body));
      for (const pattern of options.ignorePatterns) if (await pattern.find(body, budget)) { matches = true; break; }
      ignored &&= matches;
      budget.step(1 + body.length);
      await budget.checkpoint();
    }
    if (ignored) for (let index = start; index < scan; index++) changes[index] = { ...changes[index]!, ignored: true };
  }
}

export function diffCommand(options: DiffPatchOptions) { return definition("diff", options, run); }
