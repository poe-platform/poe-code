import { StoredExclusions } from "./stored-exclusions.js";
import { directoryMatches } from "./stored-directory.js";
import { closeDocumentResources } from "safe-bash-diff-engine/document";
import { PagedStorage } from "@poe-code/safe-fs/storage";
import { indexedDiff, type StdinDocument } from "./indexed.js";
import { compareBrief } from "./brief.js";
import { contextual,normal,type Edit } from "./diff-format.js";
import { flags,type DiffFlags } from "./diff-options.js";
import { expandTabs,ifdef,quoteDiffArgument,quoteDiffName,script,sideBySide } from "./diff-output.js";
import { createPrCommand } from "safe-bash-command-pr";
import { basename,createCommandArguments,isFsError,writeBytes,type CommandContext,type FileStat } from "safe-bash-contracts";
import { publicDiagnosticMessage } from "safe-bash-contracts/diagnostics";
import { writeDiagnostic } from "safe-bash-contracts/escaping";
import { Budget,ToolError,definition,host,inspect,sameIdentity,type DiffPatchOptions } from "safe-bash-diff-engine/shared";
import { decodeBytes,encodeBytes } from "safe-bash-io-engine/byte-encoding";
import { pathOf } from "safe-bash-io-engine/internal";

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
  const ids = new Map<string, number>();
  const intern = async (keys: string[], count: number) => {
    const result = new Uint32Array(count);
    for (let index = 0; index < count; index++) {
      const key = keys[prefix + index]!;
      budget.step(1 + key.length);
      let id = ids.get(key);
      if (id === undefined) { id = ids.size; ids.set(key, id); }
      result[index] = id;
      const checkpoint = budget.checkpoint();
      if (checkpoint) await checkpoint;
    }
    return result;
  };
  const oldIds = matrix ? await intern(oldKeys, oldCount) : undefined;
  const newIds = matrix ? await intern(newKeys, newCount) : undefined;
  if (matrix) {
    for (let oldIndex = oldCount - 1; oldIndex >= 0; oldIndex--) {
      budget.step(newCount);
      const oldId = oldIds![oldIndex]!;
      const rowOffset = oldIndex * width;
      const nextRowOffset = rowOffset + width;
      for (let newIndex = newCount - 1; newIndex >= 0; newIndex--) {
        const position = rowOffset + newIndex;
        const nextPos = nextRowOffset + newIndex;
        if (oldId === newIds![newIndex]) {
          matrix[position] = 1 + matrix[nextPos + 1]!;
        } else {
          const down = matrix[nextPos]!;
          const right = matrix[position + 1]!;
          matrix[position] = down >= right ? down : right;
        }
      }
      const checkpoint = budget.checkpoint();
      if (checkpoint) await checkpoint;
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

function childPath(directory: string, name: string): string {
  let end = directory.length;
  while (end > 0 && directory[end - 1] === "/") end--;
  return `${directory.slice(0, end)}/${name}`;
}

async function run(context: CommandContext, budget: Budget): Promise<number> {
  const storage = new PagedStorage(context, 32);
  const stdin: StdinDocument = {};
  const exclusions = new StoredExclusions(budget);
  context.registerCleanup?.(() => closeDocumentResources([storage, exclusions]));
  try { return await runStored(context, budget, storage, stdin, exclusions); }
  finally { await closeDocumentResources([storage, exclusions, ...(stdin.document ? [stdin.document] : [])]); }
}

async function runStored(context: CommandContext, budget: Budget, storage: PagedStorage, stdinDocument: StdinDocument, exclusions: StoredExclusions): Promise<number> {
  const options = flags(context.args);
  await exclusions.load(options);
  let outputSize = 0;
  let encoding: "utf8" | "latin1" = "utf8";
  const appendBytes = async (bytes: Uint8Array) => {
    budget.outputLength(bytes.length);
    for (let offset = 0; offset < bytes.length; offset += 16384) await storage.append(bytes.subarray(offset, offset + 16384));
    outputSize += bytes.length;
  };
  const append = async (text: string) => { await appendBytes(encodeBytes(text, encoding)); };
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
    const isStdin = (path: string) => path === "-" || !options.noDereference
      && (pathOf(context, path) === "/dev/stdin" || pathOf(context, path) === "/dev/fd/0");
    let leftStat = pair.leftEntry === false ? undefined : isStdin(left) ? { type: "file" as const } : await inspectOperand(left);
    let rightStat = pair.rightEntry === false ? undefined : isStdin(right) ? { type: "file" as const } : await inspectOperand(right);
    if (inspectionFailed) continue;
    if (options.format === "ifdef" && (leftStat?.type === "directory" || rightStat?.type === "directory")) {
      throw new ToolError("-D option not supported with directories");
    }
    if (!pair.nested && leftStat && rightStat && (leftStat.type === "directory") !== (rightStat.type === "directory")) {
      if (isStdin(left) || isStdin(right)) throw new ToolError("cannot compare stdin with a directory");
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
      await append(`Only in ${present.slice(0, present.lastIndexOf("/")) || "/"}: ${basename(present)}\n`);
      different = true;
      continue;
    }
    const streamType = (type: string) => type === "character" || type === "fifo";
    const comparable = (type: string) => type === "file" || streamType(type);
    if (leftStat && rightStat && leftStat.type !== rightStat.type
      && (pair.nested || !comparable(leftStat.type) || !comparable(rightStat.type))) {
      const typeName = (stat: { type: string; size?: number }) => stat.type === "symlink" ? "symbolic link"
        : stat.type === "file" ? stat.size === 0 ? "regular empty file" : "regular file"
        : stat.type === "character" ? "character special file" : stat.type;
      await append(`File ${left} is a ${typeName(leftStat)} while file ${right} is a ${typeName(rightStat)}\n`);
      different = true;
      continue;
    }
    if (leftStat?.type === "symlink" || rightStat?.type === "symlink") {
      if (!context.fs.readlink) throw new ToolError("filesystem cannot read symbolic links");
      const readlink = context.fs.readlink.bind(context.fs);
      const oldTarget = await host(context, () => readlink(pathOf(context, left), { signal: context.signal }));
      const newTarget = await host(context, () => readlink(pathOf(context, right), { signal: context.signal }));
      if (!budget.equal(oldTarget, newTarget)) {
        await append(`Symbolic links ${left} and ${right} differ\n`);
        different = true;
      } else if (options.reportSame) await append(`Files ${options.labels[0] ?? left} and ${options.labels[1] ?? right} are identical\n`);
      continue;
    }
    if (leftStat?.type === "directory" || rightStat?.type === "directory") {
      if (pair.nested && !options.recursive) { await append(`Common subdirectories: ${left} and ${right}\n`); continue; }
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
      for await (const match of directoryMatches(leftStat ? left : undefined, rightStat ? right : undefined, budget,
        options.ignoreFileNameCase, budget.remainingFiles - pending.length, name => exclusions.matches(name), pair.nested ? undefined : options.startingFile)) {
        pending.push({ left: childPath(left, match.left ?? match.right!), right: childPath(right, match.right ?? match.left!),
          nested: true, leftParents, rightParents, leftEntry: match.left !== undefined, rightEntry: match.right !== undefined });
      }
      continue;
    }
    if (options.brief && options.whitespace === "exact" && !options.ignoreCase
      && !options.ignoreTabs && !options.ignoreTrailing && !options.stripTrailingCr
      && !options.ignoreBlank && options.ignorePatterns.length === 0
      && leftStat?.type === "file" && rightStat?.type === "file" && !isStdin(left) && !isStdin(right)) {
      const same = await compareBrief(budget, pathOf(context, left), pathOf(context, right), options.text, options.format === "side" || options.format === "ifdef");
      if (!same) {
        different = true;
        await append(`Files ${options.labels[0] ?? left} and ${options.labels[1] ?? right} differ\n`);
      } else if (options.reportSame) await append(`Files ${options.labels[0] ?? left} and ${options.labels[1] ?? right} are identical\n`);
      continue;
    }
    const canIndex = async (path: string, stat: { type: string } | undefined) => {
      if (!stat || stat.type === "file") return true;
      if (pair.nested || !streamType(stat.type) || !context.fs.readStream) return false;
      const capabilities = await host(context, async () =>
        await context.fs.capabilitiesFor?.(pathOf(context, path), { signal: context.signal }) ?? context.fs.capabilities);
      return capabilities.streamingRead !== false;
    };
    let storedPatterns = true;
    for (const pattern of [...options.ignorePatterns, ...options.functions]) {
      if (!await pattern.supportsStoredTest(budget)) { storedPatterns = false; break; }
    }
    if (storedPatterns
      && await canIndex(left, leftStat) && await canIndex(right, rightStat)) {
      const result = await indexedDiff(budget, options, left, right, pair.nested, appendBytes, {
        left: !leftStat ? undefined : isStdin(left) ? "-" : streamType(leftStat.type) ? { stream: pathOf(context, left) } : pathOf(context, left),
        right: !rightStat ? undefined : isStdin(right) ? "-" : streamType(rightStat.type) ? { stream: pathOf(context, right) } : pathOf(context, right),
      }, stdinDocument);
      different ||= result.different;
      trouble ||= result.trouble;
      continue;
    }
    const read = async (path: string, stat: { type: string } | undefined) => {
      if (!stat) return "";
      if (isStdin(path)) return stdin ??= await budget.read("-", "latin1");
      if (!pair.nested && streamType(stat.type)) return budget.read(pathOf(context, path), "latin1");
      return budget.readDiff(pathOf(context, path), "latin1");
    };
    const oldBytes = await read(left, leftStat);
    const newBytes = await read(right, rightStat);
    const label = (name: string) => encoding === "latin1" ? decodeBytes(encodeBytes(name), "latin1") : name;
    let incompleteEdLine = false;
    const reportSame = async () => { if (options.reportSame && !incompleteEdLine) await append(`Files ${label(options.labels[0] ?? left)} and ${label(options.labels[1] ?? right)} are identical\n`); };
    if (options.format === "ed" && !options.brief && (options.text || !oldBytes.includes("\0") && !newBytes.includes("\0"))) {
      for (const [path, text] of [[left, oldBytes], [right, newBytes]] as const) {
        if (text && !text.endsWith("\n")) {
          await writeDiagnostic(context.stderr, `diff: ${path}: No newline at end of file\n\n`, context.signal);
          trouble = true;
          incompleteEdLine = true;
        }
      }
    }
    // Detect binary data before decoding; invalid UTF-8 without NUL is byte text.
    if (!options.text && oldBytes === newBytes && (options.format !== "side" && options.format !== "ifdef" || oldBytes.includes("\0"))) { await reportSame(); continue; }
    if (!options.text && (oldBytes.includes("\0") || newBytes.includes("\0"))) {
      await append(`${options.brief ? "Files" : "Binary files"} ${options.labels[0] ?? left} and ${options.labels[1] ?? right} differ\n`);
      different = true;
      continue;
    }
    let oldText = oldBytes, newText = newBytes;
    encoding = "latin1";
    {
      const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
      try {
        const oldDecoded = decoder.decode(encodeBytes(oldBytes, "latin1"));
        const newDecoded = decoder.decode(encodeBytes(newBytes, "latin1"));
        oldText = oldDecoded; newText = newDecoded;
        encoding = "utf8";
      } catch { /* Latin-1 maps each input byte to one code unit without replacement. */ }
    }
    if (options.stripTrailingCr) {
      oldText = oldText.replaceAll("\r\n", "\n");
      newText = newText.replaceAll("\r\n", "\n");
    }
    if (options.format === "ed" && !options.brief) {
      if (oldText && !oldText.endsWith("\n")) oldText += "\n";
      if (newText && !newText.endsWith("\n")) newText += "\n";
    }
    if (oldText === newText && options.format !== "side" && options.format !== "ifdef") { await reportSame(); continue; }
    const oldLines = budget.split(oldText);
    const newLines = budget.split(newText);
    const oldKeys = await comparisonLines(oldLines, options, budget);
    const newKeys = await comparisonLines(newLines, options, budget);
    const same = oldText === newText || await equivalent(oldKeys, newKeys, budget);
    if (same && options.format !== "side" && options.format !== "ifdef") { await reportSame(); continue; }
    if (options.brief && !options.ignoreBlank && options.ignorePatterns.length === 0) {
      if (!same) {
        different = true;
        await append(`Files ${label(options.labels[0] ?? left)} and ${label(options.labels[1] ?? right)} differ\n`);
      } else await reportSame();
      continue;
    }
    const changes = await edits(oldLines, newLines, oldKeys, newKeys, budget);
    if (!same) await ignoreChanges(changes, options, budget);
    const changed = changes.some(edit => edit.kind !== " " && !edit.ignored);
    different ||= changed;
    if (!changed && pair.nested && options.suppressCommon) { await reportSame(); continue; }
    if (pair.nested && !options.brief && (changed || options.format === "side")) {
      await append(label(["diff", ...options.optionArgs.map(quoteDiffArgument), quoteDiffName(options.labels[0] ?? left), quoteDiffName(options.labels[1] ?? right)].join(" ")) + "\n");
    }
    if (options.brief) { if (changed) await append(`Files ${label(options.labels[0] ?? left)} and ${label(options.labels[1] ?? right)} differ\n`); }
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
    if (!changed) await reportSame();
  }
  const output = (async function* () {
    for (let position = 0; position < outputSize; position += 16384) {
      yield await storage.read(8 + position, Math.min(16384, outputSize - position));
    }
  })();
  if (options.paginate && outputSize) {
    const title = ["diff", ...context.args].join(" ");
    const argumentValues = createCommandArguments(["-f", "-h", title]);
    const pages = new PagedStorage(context, 16);
    context.registerCleanup?.(() => pages.close());
    let pageBytes = 0;
    try {
      const result = await createPrCommand({ limits: { maxInputBytes: budget.limits.maxOutputBytes, maxOutputBytes: budget.limits.maxOutputBytes, maxWork: Math.max(1, budget.remainingWork) } }).execute({
        ...context, command: "pr", args: argumentValues.args, argumentValues, stdin: output,
        stdout: { async write(chunk) {
          for (let offset = 0; offset < chunk.length; offset += 16384) {
            context.signal.throwIfAborted();
            await pages.append(chunk.subarray(offset, offset + 16384));
          }
          pageBytes += chunk.length;
        } },
      });
      if (result.exitCode) return 2;
      for (let position = 0; position < pageBytes; position += 16384) {
        const bytes = await pages.read(8 + position, Math.min(16384, pageBytes - position));
        await writeBytes(context.stdout, bytes, context.signal);
      }
    } finally { await pages.close(); }
  } else for await (const bytes of output) await writeBytes(context.stdout, bytes, context.signal);
  return trouble ? 2 : different ? 1 : 0;
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

export function diffCommand(options: DiffPatchOptions = {}) { return definition("diff", options, run); }
