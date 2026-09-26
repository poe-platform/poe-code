import { basename, createCommandArguments, isFsError, toByteSource, writeBytes, type CommandContext, type FileStat } from "../../contracts/index.js";
import { publicDiagnosticMessage } from "../../diagnostics.js";
import { writeDiagnostic } from "../../escaping.js";
import { pathOf } from "../internal.js";
import { Budget, ToolError, definition, host, inspect, sameIdentity, type DiffPatchOptions } from "./shared.js";
import { contextual, normal, type Edit } from "./diff-format.js";
import { sideBySide, script, ifdef, expandTabs, quoteDiffName, quoteDiffArgument } from "./diff-output.js";
import { flags, type DiffFlags } from "./diff-options.js";
import { Pattern } from "../text-programs/regex.js";
import { createPrCommand } from "../pr/index.js";

async function comparisonLines(lines: string[], options: DiffFlags, budget: Budget): Promise<string[]> {
  const whitespace = options.whitespace;
  if (whitespace === "exact" && !options.ignoreCase && !options.ignoreTabs && !options.ignoreTrailing) return lines;
  const result: string[] = [];
  for (const line of lines) {
    budget.step(1 + line.length);
    { const c = budget.checkpoint(); if (c) await c; }
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
    { const c = budget.checkpoint(); if (c) await c; }
  }
  return true;
}

async function edits(oldLines: string[], newLines: string[], oldKeys: string[], newKeys: string[], budget: Budget): Promise<Edit[]> {
  let prefix = 0;
  while (prefix < Math.min(oldLines.length, newLines.length) && budget.equal(oldKeys[prefix], newKeys[prefix])) {
    prefix++;
    { const c = budget.checkpoint(); if (c) await c; }
  }
  let suffix = 0;
  while (suffix < Math.min(oldLines.length, newLines.length) - prefix
    && budget.equal(oldKeys[oldLines.length - suffix - 1], newKeys[newLines.length - suffix - 1])) {
    suffix++;
    { const c = budget.checkpoint(); if (c) await c; }
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
      { const c = budget.checkpoint(); if (c) await c; }
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
    { const c = budget.checkpoint(); if (c) await c; }
  }
  for (let index = 0; index < suffix; index++) {
    result.push({ kind: " ", line: oldLines[oldLines.length - suffix + index]!, newLine: newLines[newLines.length - suffix + index]! });
    budget.step();
    { const c = budget.checkpoint(); if (c) await c; }
  }
  return result;
}

async function exclusionPatterns(options: DiffFlags, budget: Budget): Promise<Pattern[]> {
  const exclusions: Pattern[] = [];
  let patternBytes = 0;
  const append = async (source: string, ignoreCase: boolean, start = 0, end = source.length) => {
    budget.step(1 + end - start);
    { const c = budget.checkpoint(); if (c) await c; }
    if (exclusions.length >= budget.limits.maxExcludePatterns) throw new ToolError("exclusion pattern count limit exceeded");
    // UTF-16 length is a lower bound on UTF-8 bytes; admit the slice before allocating it.
    const remaining = budget.limits.maxExcludePatternBytes - patternBytes;
    if (end - start > remaining) throw new ToolError("exclusion pattern byte limit exceeded");
    const sourcePattern = source.slice(start, end);
    const bytes = Buffer.byteLength(sourcePattern);
    if (bytes > remaining) throw new ToolError("exclusion pattern byte limit exceeded");
    patternBytes += bytes;
    exclusions.push(globPattern(sourcePattern, ignoreCase));
  };
  for (const { pattern, ignoreCase } of options.excludes) await append(pattern, ignoreCase);
  for (const { path, ignoreCase } of options.excludeFiles) {
    if (path !== "-") await inspect(budget, path, "follow");
    const contents = await (path === "-" ? budget.read("-") : budget.readDiff(pathOf(budget.context, path)));
    let start = 0;
    while (start < contents.length) {
      const newline = contents.indexOf("\n", start);
      const end = newline < 0 ? contents.length : newline;
      if (end > start) await append(contents, ignoreCase, start, end);
      else { budget.step(); { const c = budget.checkpoint(); if (c) await c; } }
      start = end + 1;
    }
  }
  return exclusions;
}

function childPath(directory: string, name: string): string {
  let end = directory.length;
  while (end > 0 && directory[end - 1] === "/") end--;
  return `${directory.slice(0, end)}/${name}`;
}

async function run(context: CommandContext, budget: Budget): Promise<number> {
  const options = flags(context.args);
  const exclusions = await exclusionPatterns(options, budget);
  const pieces: Buffer[] = [];
  let encoding: "utf8" | "latin1" = "utf8";
  const append = (text: string) => { budget.output(text, encoding); pieces.push(Buffer.from(text, encoding)); };
  let different = false;
  let trouble = false;
  let stdin: string | undefined;
  const symlinks = options.noDereference ? "compare" : "follow";
  let inspectionFailed = false;
  const inspectOperand = async (path: string) => {
    try { return await inspect(budget, path, symlinks); }
    catch (error) {
      if (isFsError(error, "ENOENT")) return undefined;
      if (!isFsError(error)) throw error;
      await writeDiagnostic(context.stderr, `diff: ${publicDiagnosticMessage(error, context.onInternalError)}\n`, context.signal);
      inspectionFailed = trouble = true;
      return undefined;
    }
  };
  const pairs = options.fromFile !== undefined ? options.files.map(right => ({ left: options.fromFile!, right }))
    : options.toFile !== undefined ? options.files.map(left => ({ left, right: options.toFile! }))
    : [{ left: options.files[0]!, right: options.files[1]! }];
  type DirectoryIdentity = FileStat | string;
  interface Pair { left: string; right: string; nested: boolean; leftParents: DirectoryIdentity[]; rightParents: DirectoryIdentity[]; leftEntry?: boolean; rightEntry?: boolean }
  const pending: Pair[] = pairs.reverse().map(pair => ({ ...pair, nested: false, leftParents: [], rightParents: [] }));
  while (pending.length) {
    encoding = "utf8";
    inspectionFailed = false;
    budget.file();
    { const c = budget.checkpoint(); if (c) await c; }
    const pair = pending.pop()!;
    let left = pair.left;
    let right = pair.right;
    let leftStat = pair.leftEntry === false ? undefined : left === "-" ? { type: "file" as const } : await inspectOperand(left);
    let rightStat = pair.rightEntry === false ? undefined : right === "-" ? { type: "file" as const } : await inspectOperand(right);
    if (inspectionFailed) continue;
    if (options.format === "ifdef" && (leftStat?.type === "directory" || rightStat?.type === "directory")) {
      throw new ToolError("-D option not supported with directories");
    }
    if (!pair.nested && leftStat && rightStat && (leftStat.type === "directory") !== (rightStat.type === "directory")) {
      if (left === "-" || right === "-") throw new ToolError("cannot compare stdin with a directory");
      if (leftStat.type === "directory") { left = childPath(left, basename(right)); leftStat = await inspectOperand(left); }
      else { right = childPath(right, basename(left)); rightStat = await inspectOperand(right); }
      if (inspectionFailed) continue;
    }
    const treatMissingAsEmpty = (!leftStat && (options.newFile || options.unidirectionalNewFile)) || (!rightStat && options.newFile);
    const missingError = !leftStat && !rightStat
      || treatMissingAsEmpty && (leftStat?.type === "symlink" || rightStat?.type === "symlink")
      || !leftStat && pair.leftEntry === true || !rightStat && pair.rightEntry === true
      || !treatMissingAsEmpty && (!leftStat || !rightStat) && !pair.nested;
    if (missingError) {
      for (const path of [leftStat ? undefined : left, rightStat ? undefined : right]) {
        if (path !== undefined) await writeDiagnostic(context.stderr, `diff: ${path}: No such file or directory\n`, context.signal);
      }
      trouble = true;
      continue;
    }
    if ((!leftStat || !rightStat) && !treatMissingAsEmpty) {
      const present = leftStat ? left : right;
      append(`Only in ${present.slice(0, present.lastIndexOf("/")) || "/"}: ${basename(present)}\n`);
      different = true;
      continue;
    }
    if (leftStat && rightStat && leftStat.type !== rightStat.type) {
      const typeName = (stat: { type: string; size?: number }) => stat.type === "symlink" ? "symbolic link"
        : stat.type === "file" ? stat.size === 0 ? "regular empty file" : "regular file" : stat.type;
      append(`File ${left} is a ${typeName(leftStat)} while file ${right} is a ${typeName(rightStat)}\n`);
      different = true;
      continue;
    }
    if (leftStat?.type === "symlink" || rightStat?.type === "symlink") {
      if (!context.fs.readlink) throw new ToolError("filesystem cannot read symbolic links");
      const readlink = context.fs.readlink.bind(context.fs);
      const oldTarget = await host(context, () => readlink(pathOf(context, left), { signal: context.signal }));
      const newTarget = await host(context, () => readlink(pathOf(context, right), { signal: context.signal }));
      if (!budget.equal(oldTarget, newTarget)) {
        append(`Symbolic links ${left} and ${right} differ\n`);
        different = true;
      } else if (options.reportSame) append(`Files ${options.labels[0] ?? left} and ${options.labels[1] ?? right} are identical\n`);
      continue;
    }
    if (leftStat?.type === "directory" || rightStat?.type === "directory") {
      if (pair.nested && !options.recursive) { append(`Common subdirectories: ${left} and ${right}\n`); continue; }
      const leftIdentity = leftStat?.type !== "directory" ? undefined : sameIdentity(leftStat, leftStat) ? leftStat
        : await host(context, () => context.fs.realpath(pathOf(context, left), { signal: context.signal }));
      const rightIdentity = rightStat?.type !== "directory" ? undefined : sameIdentity(rightStat, rightStat) ? rightStat
        : await host(context, () => context.fs.realpath(pathOf(context, right), { signal: context.signal }));
      const isLoop = (identity: DirectoryIdentity | undefined, parents: DirectoryIdentity[]) => identity !== undefined
        && parents.some(parent => typeof identity === "string" ? parent === identity : typeof parent !== "string" && sameIdentity(identity, parent));
      const cycle = isLoop(leftIdentity, pair.leftParents) ? left : isLoop(rightIdentity, pair.rightParents) ? right : undefined;
      if (cycle !== undefined) {
        await writeDiagnostic(context.stderr, `diff: ${cycle}: recursive directory loop\n`, context.signal);
        trouble = true;
        continue;
      }
      const leftParents = leftIdentity === undefined ? pair.leftParents : [...pair.leftParents, leftIdentity];
      const rightParents = rightIdentity === undefined ? pair.rightParents : [...pair.rightParents, rightIdentity];
      const names = new Map<string, { left: string[]; right: string[] }>();
      const key = (name: string) => options.ignoreFileNameCase ? name.replace(/[A-Z]/gu, letter => letter.toLowerCase()) : name;
      // Each side may contain all the same names; only their union consumes pairs.
      const maxEntries = budget.remainingFiles - pending.length;
      let count = 0;
      for (const [side, path] of [["left", leftStat ? left : undefined], ["right", rightStat ? right : undefined]] as const) {
        if (path === undefined) continue;
        const entries = await host(context, () => context.fs.readdir(pathOf(context, path), { signal: context.signal, ...(Number.isFinite(maxEntries) ? { maxEntries } : {}) }));
        if (entries.length > maxEntries) throw new ToolError("file/entry limit exceeded");
        for (const entry of entries) {
          budget.step();
          if (!entry.name || entry.name === "." || entry.name === ".." || /[\/\\\0\r\n\t]/u.test(entry.name)) throw new ToolError("unsafe directory entry name");
          let excluded = false;
          const byteName = exclusions.length ? Buffer.from(entry.name).toString("latin1") : entry.name;
          for (const pattern of exclusions) if (await pattern.find(byteName, budget)) { excluded = true; break; }
          if (excluded) continue;
          const folded = key(entry.name);
          let group = names.get(folded);
          if (!group) { group = { left: [], right: [] }; names.set(folded, group); }
          const before = Math.max(group.left.length, group.right.length);
          group[side].push(entry.name);
          count += Math.max(group.left.length, group.right.length) - before;
          if (count > maxEntries) throw new ToolError("file/entry limit exceeded");
        }
      }
      for (const name of [...names.keys()].sort().reverse()) {
        if (!pair.nested && options.startingFile !== undefined && name < key(options.startingFile)) continue;
        const group = names.get(name)!;
        group.left.sort();
        group.right.sort();
        const rightNames = new Set(group.right);
        const matches: { left?: string; right?: string }[] = [];
        const unmatchedLeft: string[] = [];
        for (const leftName of group.left) {
          if (rightNames.delete(leftName)) matches.push({ left: leftName, right: leftName });
          else unmatchedLeft.push(leftName);
        }
        const unmatchedRight = [...rightNames];
        for (let index = 0; index < Math.max(unmatchedLeft.length, unmatchedRight.length); index++) {
          const leftName = unmatchedLeft[index], rightName = unmatchedRight[index];
          matches.push({ ...(leftName === undefined ? {} : { left: leftName }), ...(rightName === undefined ? {} : { right: rightName }) });
        }
        matches.sort((first, second) => {
          const unmatched = Number(first.left === undefined || first.right === undefined) - Number(second.left === undefined || second.right === undefined);
          const firstName = first.left ?? first.right!, secondName = second.left ?? second.right!;
          return unmatched || (firstName < secondName ? -1 : firstName > secondName ? 1 : 0);
        });
        for (const match of matches.reverse()) {
          pending.push({ left: childPath(left, match.left ?? match.right!), right: childPath(right, match.right ?? match.left!),
            nested: true, leftParents, rightParents, leftEntry: match.left !== undefined, rightEntry: match.right !== undefined });
        }
      }
      continue;
    }
    const read = async (path: string, exists: boolean) => {
      if (!exists) return "";
      if (path === "-") return stdin ??= await budget.read("-", "latin1");
      return budget.readDiff(pathOf(context, path), "latin1");
    };
    const oldBytes = await read(left, !!leftStat);
    const newBytes = await read(right, !!rightStat);
    const label = (name: string) => encoding === "latin1" ? Buffer.from(name).toString("latin1") : name;
    const reportSame = () => { if (options.reportSame) append(`Files ${label(options.labels[0] ?? left)} and ${label(options.labels[1] ?? right)} are identical\n`); };
    // Detect binary data before decoding; invalid UTF-8 without NUL is byte text.
    if (!options.text && oldBytes === newBytes && (options.format !== "side" && options.format !== "ifdef" || oldBytes.includes("\0"))) { reportSame(); continue; }
    if (!options.text && (oldBytes.includes("\0") || newBytes.includes("\0"))) {
      append(`${options.brief ? "Files" : "Binary files"} ${options.labels[0] ?? left} and ${options.labels[1] ?? right} differ\n`);
      different = true;
      continue;
    }
    let oldText = oldBytes, newText = newBytes;
    encoding = "latin1";
    if (!options.text) {
      const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
      try {
        const oldDecoded = decoder.decode(Buffer.from(oldBytes, "latin1"));
        const newDecoded = decoder.decode(Buffer.from(newBytes, "latin1"));
        oldText = oldDecoded; newText = newDecoded;
        encoding = "utf8";
      } catch { /* Latin-1 maps each input byte to one code unit without replacement. */ }
    }
    if (options.stripTrailingCr) {
      oldText = oldText.replaceAll("\r\n", "\n");
      newText = newText.replaceAll("\r\n", "\n");
    }
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
    if (!changed && pair.nested && options.suppressCommon) { reportSame(); continue; }
    if (pair.nested && !options.brief && (changed || options.format === "side")) {
      append(label(["diff", ...options.optionArgs.map(quoteDiffArgument), quoteDiffName(options.labels[0] ?? left), quoteDiffName(options.labels[1] ?? right)].join(" ")) + "\n");
    }
    if (options.brief) { if (changed) append(`Files ${label(options.labels[0] ?? left)} and ${label(options.labels[1] ?? right)} differ\n`); }
    else if (options.format === "side") await sideBySide(changes, options, budget, append);
    else if (options.format === "ifdef") await ifdef(changes, label(options.symbol), budget, append);
    else if (changed) {
      if (options.format === "normal") {
        await normal(changes, budget, append, options);
      }
      else if (options.format === "ed" || options.format === "rcs") await script(changes, options.format, budget, append);
      else await contextual(changes, options.format, label(options.labels[0] ?? quoteDiffName(leftStat ? left : "/dev/null")), label(options.labels[1] ?? quoteDiffName(rightStat ? right : "/dev/null")), options.context, budget, append, options, options.functions.length ? async position => {
        for (let index = position - 1; index >= 0; index--) {
          for (const pattern of options.functions) if (await pattern.find(oldLines[index]!, budget)) return oldLines[index]!.replace(/\n$/u, "").slice(0, 40);
          budget.step();
          { const c = budget.checkpoint(); if (c) await c; }
        }
        return "";
      } : undefined);
    }
    if (!changed) reportSame();
  }
  const output = Buffer.concat(pieces);
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
  return trouble ? 2 : different ? 1 : 0;
}

function globPattern(source: string, ignoreCase: boolean): Pattern {
  source = Buffer.from(source).toString("latin1");
  let result = "^";
  const oppositeCase = (character: string) => !ignoreCase ? ""
    : character >= "A" && character <= "Z" ? character.toLowerCase()
    : character >= "a" && character <= "z" ? character.toUpperCase() : "";
  for (let index = 0; index < source.length; index++) {
    const character = source[index]!;
    if (character === "\\" && index + 1 < source.length) {
      const literal = source[++index]!;
      result += oppositeCase(literal) ? `[${literal}${oppositeCase(literal)}]` : `\\${literal}`;
    }
    else if (character === "[") {
      let end = index + 1;
      const negated = source[end] === "!" || source[end] === "^";
      if (negated) end++;
      if (source[end] === "]") end++;
      while (end < source.length && source[end] !== "]") {
        if (source[end] === "\\" && end + 1 < source.length) end += 2;
        else if (source[end] === "[" && source[end + 1] === ":") {
          const classEnd = source.indexOf(":]", end + 2);
          if (classEnd < 0) break;
          end = classEnd + 2;
        } else end++;
      }
      if (source[end] === "]") {
        // Fold explicit ASCII literals/range endpoints; POSIX classes retain their meaning.
        let body = "";
        const literal = (value: string) => "\\]^-".includes(value) ? `\\${value}` : value;
        for (let scan = index + 1 + Number(negated); scan < end; scan++) {
          if (source[scan] === "[" && source[scan + 1] === ":") {
            const closing = source.indexOf(":]", scan + 2) + 1;
            body += source.slice(scan, closing + 1);
            scan = closing;
            continue;
          }
          if (source[scan] === "\\" && scan + 1 < end) scan++;
          let first = source[scan]!;
          if (ignoreCase && first >= "A" && first <= "Z") first = first.toLowerCase();
          if (source[scan + 1] === "-" && scan + 2 < end) {
            let last = source[scan + 2]!;
            if (ignoreCase && last >= "A" && last <= "Z") last = last.toLowerCase();
            for (let code = first.charCodeAt(0); code <= last.charCodeAt(0); code++) {
              const value = String.fromCharCode(code);
              body += literal(value) + oppositeCase(value);
            }
            scan += 2;
          } else body += literal(first) + oppositeCase(first);
        }
        result += body ? "[" + (negated ? "^" : "") + body + "]" : negated ? "[\u0000-\u00ff]" : "[^\u0000-\u00ff]";
        index = end;
      } else result += "\\[";
    }
    else if (character === "*") result += ".*";
    else if (character === "?") result += ".";
    else result += oppositeCase(character) ? `[${character}${oppositeCase(character)}]`
      : ".^$+(){}|]".includes(character) ? `\\${character}` : character;
  }
  return new Pattern(result + "$", true, false, "awk");
}

async function ignoreChanges(changes: Edit[], options: DiffFlags, budget: Budget): Promise<void> {
  if (!options.ignoreBlank && !options.ignorePatterns.length) return;
  let scan = 0;
  while (scan < changes.length) {
    budget.step();
    { const c = budget.checkpoint(); if (c) await c; }
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
      { const c = budget.checkpoint(); if (c) await c; }
    }
    if (ignored) for (let index = start; index < scan; index++) changes[index] = { ...changes[index]!, ignored: true };
  }
}

export function diffCommand(options: DiffPatchOptions) { return definition("diff", options, run); }
