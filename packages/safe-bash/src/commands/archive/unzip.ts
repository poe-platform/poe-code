import { dirname, collectBytes, readBytes, resolvePath, writeBytes, type CommandContext, type CommandDefinition, type FileStat } from "../../contracts/index.js";
import { writeFileOutput } from "../../contracts/filesystem-output.js";
import { createOutputOperation, type OutputOperation } from "../../contracts/output.js";
import { publicDiagnosticMessage } from "../../diagnostics.js";
import { Budget, bounded, checkPath, display, fail, settings, text, vfsPath, type ArchiveCommandsOptions } from "./internal.js";
import { decodeZipEntry, readZipArchive, type ZipEntry } from "./zip-format.js";
import { Answers, parseArguments, Selection } from "./unzip/arguments.js";
import { Extraction } from "./unzip/safety.js";

function filtered(name: string): string {
  let output = "";
  for (const character of name) {
    const code = character.charCodeAt(0);
    output += code < 32 ? `^${String.fromCharCode(code + 64)}` : character;
  }
  return output;
}

function padded(name: string): string {
  return name + " ".repeat(Math.max(0, 22 - Buffer.byteLength(name)));
}

function date(entry: ZipEntry): string {
  const modified = entry.modified;
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${modified.getFullYear()}-${pad(modified.getMonth() + 1)}-${pad(modified.getDate())} ${pad(modified.getHours())}:${pad(modified.getMinutes())}`;
}

async function comment(bytes: Uint8Array, budget: Budget): Promise<void> {
  if (!bytes.length) return;
  const output: number[] = [];
  let length = 0;
  for (const byte of bytes) {
    if (!byte) break;
    if (byte !== 13 && byte !== 19) length += byte === 27 ? 2 : 1;
    if (length > budget.limits.maxTextBytes - budget.textBytes) fail("text output limit exceeded");
  }
  for (const byte of bytes) {
    if (!byte) break;
    if (byte === 13 || byte === 19) continue;
    if (byte === 27) output.push(94, 91);
    else output.push(byte);
  }
  if (output.length && output.at(-1) !== 10) output.push(10);
  const value = Uint8Array.from(output);
  if (value.length > budget.limits.maxTextBytes - budget.textBytes) fail("text output limit exceeded");
  budget.textBytes += value.length;
  await writeBytes(budget.context.stdout, value, budget.context.signal);
}

export function createUnzipCommand(options: ArchiveCommandsOptions = {}): CommandDefinition {
  const limits = settings(options);
  return { name: "unzip", description: "List, stream or safely extract ZIP archives in the virtual filesystem", async execute(original) {
    original.signal.throwIfAborted();
    const controller = new AbortController();
    const context: CommandContext = { ...original, signal: AbortSignal.any([original.signal, controller.signal]) };
    const extraction = new Extraction(context, limits);
    let output: OutputOperation | undefined;
    let answers: Answers | undefined;
    let closing: Promise<void> | undefined;
    const close = () => closing ??= (async () => {
      controller.abort(new Error("unzip command closed"));
      await Promise.all([extraction.close(), output?.close()]);
      await answers?.close().catch(() => {});
    })();
    original.registerCleanup?.(close);
    const budget = new Budget(context, limits);
    try {
      const parsed = parseArguments(context, limits);
      if (parsed.pipe) output = createOutputOperation(context, context.stdout);
      if (parsed.pipe && parsed.destination !== undefined) await budget.output("caution:  not extracting; -d ignored\n", true);
      const selection = new Selection(parsed.patterns, limits, context.signal);
      let archive = parsed.archive;
      let archiveStat: FileStat | undefined;
      for (const candidate of [archive, `${archive}.zip`, `${archive}.ZIP`]) {
        checkPath(candidate, limits);
        const candidateStat = await extraction.stat(vfsPath(context.cwd, candidate));
        if (candidateStat) { archive = candidate; archiveStat = candidateStat; break; }
      }
      if (!archiveStat) {
        if (!parsed.pipe) await budget.output(`unzip:  cannot find or open ${archive}, ${archive}.zip or ${archive}.ZIP.\n`, true);
        return { exitCode: 9 };
      }
      const archivePath = await extraction.operation(() => context.fs.realpath(vfsPath(context.cwd, archive), { signal: context.signal }));
      archiveStat = await extraction.operation(() => context.fs.stat(archivePath, { signal: context.signal }));
      if (archiveStat.type !== "file") fail("input archive is not a regular file");
      const bytes = await collectBytes(bounded(extraction.input(archivePath), limits.maxArchiveBytes, context.signal, limits.chunkSize), { signal: context.signal, maxBytes: limits.maxArchiveBytes });
      if (!parsed.pipe) await budget.output(`Archive:  ${filtered(archive)}\n`);
      const zip = await readZipArchive(bytes, limits, context.signal);
      if (!parsed.pipe) await comment(zip.comment, budget);
      if (!zip.entries.length) {
        await budget.output(`warning [${filtered(archive)}]:  zipfile is empty\n`, true);
        return { exitCode: 1 };
      }
      if (parsed.list) await budget.output("  Length      Date    Time    Name\n---------  ---------- -----   ----\n");
      const rootRaw = parsed.destination === undefined ? context.cwd : vfsPath(context.cwd, parsed.destination);
      const root = parsed.list || parsed.pipe ? resolvePath(rootRaw) : await extraction.directory(rootRaw, true);
      if (!parsed.list && !parsed.pipe) answers = new Answers(extraction.source(context.stdin), limits, context.signal);
      let overwrite: "ask" | "all" | "none" = parsed.overwrite ? "all" : "ask";
      let exitCode = 0;
      let selected = 0;
      let total = 0;
      let actualTotal = 0;
      const payload = async function* (entry: ZipEntry) {
        let actual = 0;
        const signal = output?.signal ?? context.signal;
        for await (const chunk of readBytes(decodeZipEntry(entry, limits, signal), signal)) {
          if (chunk.length > limits.maxEntryBytes - actual || chunk.length > limits.maxTotalBytes - actualTotal) fail("actual decompressed byte limit exceeded");
          actual += chunk.length; actualTotal += chunk.length;
          yield chunk;
        }
      };
      const links: { path: string; shown: string; target: string; existing: FileStat | undefined; parent: FileStat; entry: ZipEntry }[] = [];
      const directories: { path: string; entry: ZipEntry; identity: FileStat; parent: FileStat }[] = [];
      for (const entry of zip.entries) {
        await budget.member(entry.size);
        checkPath(entry.name, limits);
        if (!await selection.matches(entry.name, parsed.pipe)) continue;
        selected++; total += entry.size;
        if (parsed.pipe) {
          for await (const chunk of payload(entry)) await output!.output.write(chunk);
          continue;
        }
        if (parsed.list) {
          await budget.output(`${String(entry.size).padStart(9)}  ${date(entry)}   ${filtered(entry.name)}\n`);
          if (entry.comment) await comment(entry.comment, budget);
          continue;
        }
        let path = extraction.member(root, entry.name);
        const fileType = entry.mode & 0o170000;
        if (fileType && fileType !== 0o100000 && fileType !== 0o040000 && fileType !== 0o120000) fail("unsupported special ZIP entry");
        if (path === root && !entry.directory) fail("entry would replace extraction root");
        let shown = parsed.destination === undefined ? entry.name : `${parsed.destination.endsWith("/") ? parsed.destination : `${parsed.destination}/`}${entry.name}`;
        await extraction.parents(root, path, true);
        if (entry.directory) {
          if (entry.size) fail("directory has nonempty payload");
          for await (const chunk of payload(entry)) {
            await writeFileOutput(context, chunk, async () => { if (chunk.length) fail("directory has nonempty payload"); });
          }
          const parent = await extraction.operation(() => context.fs.lstat(dirname(path), { signal: context.signal }));
          const existing = await extraction.stat(path);
          let identity = existing;
          if (existing && existing.type !== "directory") fail("directory destination is not a directory");
          if (!existing) {
            identity = await extraction.createDirectory(path, parent);
            await budget.output(`   creating: ${filtered(shown)}\n`);
          }
          if (!identity || identity.type !== "directory") fail("directory changed during creation");
          directories.push({ path, entry, identity, parent });
          continue;
        }
        let parent = await extraction.operation(() => context.fs.lstat(dirname(path), { signal: context.signal }));
        let existing = await extraction.destination(path, archivePath, archiveStat);
        let skip = false;
        let prompting = 0;
        while (existing && overwrite !== "all") {
          if (overwrite === "none") { skip = true; break; }
          if (++prompting > limits.maxMembers) fail("overwrite prompt work limit exceeded");
          await budget.output(`replace ${filtered(shown)}? [y]es, [n]o, [A]ll, [N]one, [r]ename: `, true);
          const answer = await answers!.read();
          if (answer === undefined) {
            await budget.output(' NULL\n(EOF or read error, treating as "[N]one" ...)\n', true);
            overwrite = "none"; exitCode = 1; skip = true; break;
          }
          const choice = answer[0];
          if (choice === "A") { overwrite = "all"; break; }
          if (choice === "y" || choice === "Y") break;
          if (choice === "n" || choice === "N") { if (choice === "N") overwrite = "none"; skip = true; break; }
          if (choice === "r" || choice === "R") {
            let renamed = "";
            while (!renamed) {
              await budget.output("new name: ", true);
              const value = await answers!.read(limits.maxPathBytes);
              if (value === undefined) fail("EOF while reading replacement name");
              renamed = value.endsWith("\n") ? value.slice(0, -1) : value;
            }
            path = extraction.member(root, renamed);
            shown = parsed.destination === undefined ? renamed : `${parsed.destination.endsWith("/") ? parsed.destination : `${parsed.destination}/`}${renamed}`;
            await extraction.parents(root, path, true);
            parent = await extraction.operation(() => context.fs.lstat(dirname(path), { signal: context.signal }));
            existing = await extraction.destination(path, archivePath, archiveStat);
            continue;
          }
          const response = choice === "\n" || choice === "\r" ? "{ENTER}" : answer.endsWith("\n") ? answer.slice(0, -1) : answer;
          await budget.output(`error:  invalid response [${response}]\n`, true);
        }
        if (skip) continue;
        const chunks: Uint8Array[] = [];
        let actual = 0;
        for await (const chunk of payload(entry)) {
          actual += chunk.length;
          await writeFileOutput(context, chunk, async bytes => { chunks.push(Uint8Array.from(bytes)); });
        }
        if (entry.symlink) {
          if (actual > limits.maxPathBytes) fail("symlink target byte limit exceeded");
          const target = text(Buffer.concat(chunks));
          await extraction.target(root, path, target);
          if (!context.fs.symlink || context.fs.capabilities.symlinks === false) fail("filesystem does not support symlinks");
          links.push({ path, shown, target, existing, parent, entry });
          await budget.output(`    linking: ${padded(filtered(shown))}  -> ${filtered(target)} \n`);
        } else {
          await extraction.publish(root, path, chunks, existing, parent, entry.mode, entry.modified);
          await budget.output(`${entry.method === 0 ? " extracting" : "  inflating"}: ${padded(filtered(shown))}  \n`);
        }
      }
      if (parsed.list) await budget.output(`---------                     -------\n${String(total).padStart(9)}                     ${selected} file${selected === 1 ? "" : "s"}\n`);
      else {
        if (links.length) await budget.output("finishing deferred symbolic links:\n");
        for (const link of links) {
          await extraction.parents(root, link.path, false);
          await extraction.target(root, link.path, link.target);
          await extraction.destination(link.path, archivePath, archiveStat);
          await extraction.publish(root, link.path, [], link.existing, link.parent, link.entry.mode, link.entry.modified, link.target);
          await budget.output(`  ${padded(filtered(link.shown))} -> ${filtered(link.target)}\n`);
        }
        for (const { path, entry, identity, parent } of directories.reverse()) {
          await extraction.metadata(root, path, identity, parent, entry.mode, entry.modified);
        }
        for (let index = 0; index < parsed.patterns.length; index++) if (!selection.matched.has(index)) {
          await budget.output(`caution: filename not matched:  ${filtered(parsed.patterns[index]!)}\n`, true);
          exitCode = 11;
        }
      }
      return { exitCode: selected ? exitCode : 11 };
    } catch (error) {
      original.signal.throwIfAborted();
      const message = display(publicDiagnosticMessage(error, original.onInternalError).slice(0, limits.maxDiagnosticBytes));
      await writeBytes(original.stderr, Buffer.from(`unzip: ${message}\n`).subarray(0, limits.maxDiagnosticBytes), original.signal);
      return { exitCode: 2 };
    } finally { await close(); }
  } };
}
