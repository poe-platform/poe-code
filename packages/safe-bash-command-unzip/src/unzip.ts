import { createZipScratchFactory } from "safe-bash-zip-engine/zip/scratch";
import { ZipMetadataMap } from "safe-bash-zip-engine/zip/metadata";
import { hasZipIdentity, spoolZipSource } from "safe-bash-zip-engine/zip/safety";
import { withArchiveInputByteBudget } from "safe-bash-io-engine/commands/archive/internal";
import { Extraction } from "./unzip/safety.js";
import { collectBytes,dirname,readBytes,resolvePath,writeBytes,type CommandContext,type CommandDefinition,type FileStat } from "safe-bash-contracts";
import { PublicDiagnostic,publicDiagnosticMessage } from "safe-bash-contracts/diagnostics";
import { writeFileOutput } from "safe-bash-contracts/filesystem-output";
import { createOutputOperation,type OutputOperation } from "safe-bash-contracts/output";
import { byteLength,encodeBytes } from "safe-bash-io-engine/byte-encoding";
import { Budget,checkPath,display,fail,invocationLimits,settings,text,vfsPath,type ArchiveCommandsOptions } from "safe-bash-io-engine/commands/archive/internal";
import { Answers,parseArguments } from "./unzip/arguments.js";
import { Selection } from "safe-bash-zip-engine/unzip/arguments";
import { decodeZipEntry,readZipArchive,readZipIndexedArchive,type ZipIndexedArchive,type ZipEntry } from "safe-bash-zip-engine/zip-format";
import { readZipPassword } from "safe-bash-zip-engine/zip/crypto";
import { openZipVolumes } from "safe-bash-zip-engine/zip/volumes";

function filtered(name: string): string {
  let output = "";
  for (const character of name) {
    const code = character.charCodeAt(0);
    output += code < 32 ? `^${String.fromCharCode(code + 64)}` : character;
  }
  return output;
}

function padded(name: string): string {
  return name + " ".repeat(Math.max(0, 22 - byteLength(name)));
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
  const configured = settings(options);
  return { name: "unzip", description: "List, stream or safely extract ZIP archives in the virtual filesystem", execute: withArchiveInputByteBudget(async (original) => {
    const limits = invocationLimits(configured, original);
    original.signal.throwIfAborted();
    const controller = new AbortController();
    const context: CommandContext = { ...original, signal: AbortSignal.any([original.signal, controller.signal]) };
    const extraction = new Extraction(context, limits);
    let archiveInput: Awaited<ReturnType<typeof openZipVolumes>> | undefined;
    let output: OutputOperation | undefined;
    let scratch: ReturnType<typeof createZipScratchFactory> | undefined;
    let indexed: ZipIndexedArchive | undefined;
    let answers: Answers | undefined;
    let closing: Promise<void> | undefined;
    const close = () => closing ??= (async () => {
      controller.abort(new Error("unzip command closed"));
      await Promise.all([extraction.close(), output?.close(), archiveInput?.close(), indexed?.close(), scratch?.close()]);
      await answers?.close().catch(() => {});
    })();
    original.registerCleanup?.(close);
    const budget = new Budget(context, limits);
    try {
      const parsed = parseArguments(context, limits);
      if (parsed.pipe) output = createOutputOperation(context, context.stdout);
      if (parsed.pipe && parsed.destination !== undefined) await budget.output("caution:  not extracting; -d ignored\n", true);
      const selection = new Selection(parsed.patterns, limits, context.signal, { caseInsensitive: parsed.caseInsensitive });
      const exclusions = new Selection(parsed.exclusions, limits, context.signal, { caseInsensitive: parsed.caseInsensitive });
      let archive = parsed.archive;
      let archiveStat: FileStat | undefined;
      let archivePath: string;
      if (archive === "-") {
        const spool = await extraction.operation(() => spoolZipSource({ context, limits, operation: action => extraction.operation(async () => action()) }, context.cwd, extraction.source(context.stdin), limits.maxArchiveBytes));
        archivePath = spool.path;
        archiveStat = spool.stat;
        archiveInput = { source: spool.source, paths: [spool.path], volumes: [{ path: spool.path, stat: spool.stat }], close: spool.close };
        if ((!parsed.pipe || parsed.pipeHeaders) && !parsed.names && !parsed.quiet) await budget.output(`Archive:  -\n`);
      } else {
        for (const candidate of [archive, `${archive}.zip`, `${archive}.ZIP`]) {
          checkPath(candidate, limits);
          const candidateStat = await extraction.stat(vfsPath(context.cwd, candidate));
          if (candidateStat) { archive = candidate; archiveStat = candidateStat; break; }
        }
        if (!archiveStat) {
          if (!parsed.pipe) await budget.output(`unzip:  cannot find or open ${archive}, ${archive}.zip or ${archive}.ZIP.\n`, true);
          return { exitCode: 9 };
        }
        archivePath = await extraction.operation(() => context.fs.realpath(vfsPath(context.cwd, archive), { signal: context.signal }));
        archiveStat = await extraction.operation(() => context.fs.stat(archivePath, { signal: context.signal }));
        if (archiveStat.type !== "file") fail("input archive is not a regular file");
        if (!Number.isSafeInteger(archiveStat.size) || archiveStat.size < 0 || archiveStat.size > limits.maxArchiveBytes) fail("archive byte limit exceeded");
        if ((!parsed.pipe || parsed.pipeHeaders) && !parsed.names && !parsed.quiet) await budget.output(`Archive:  ${filtered(archive)}\n`);
        archiveInput = await extraction.operation(() => openZipVolumes({ context, limits, operation: action => extraction.operation(async () => action()), stat: path => extraction.stat(path) }, archivePath, options.zipHost));
      }
      extraction.inputVolumes = archiveInput.volumes;
      const scope = { context, limits, operation: <T>(action: () => Promise<T> | T) => extraction.operation(async () => action()) };
      const capabilities = await extraction.operation(async () => await context.fs.capabilitiesFor?.(context.cwd, { signal: context.signal }) ?? context.fs.capabilities);
      if (capabilities.retainedRead && capabilities.retainedStagingWrite && capabilities.retainedStagingCleanup) {
        const parent = await extraction.operation(() => context.fs.stat(context.cwd, { signal: context.signal }));
        if (hasZipIdentity(parent)) scratch = createZipScratchFactory(scope, context.cwd);
      }
      const profile = archiveInput.disks ? { disks: archiveInput.disks } : { prefix: true };
      const zip = scratch
        ? indexed = await readZipIndexedArchive(archiveInput.source, limits, context.signal, scratch, profile)
        : await readZipArchive(archiveInput.source, limits, context.signal, profile);
      if (parsed.archiveComment || (!parsed.pipe || parsed.pipeHeaders) && !parsed.names && !parsed.quiet) await comment(zip.comment, budget);
      if (parsed.archiveComment) return { exitCode: 0 };
      if (!zip.entries.length) {
        await budget.output(`warning [${filtered(archive)}]:  zipfile is empty\n`, true);
        return { exitCode: 1 };
      }
      if (parsed.names) {
        let selected = 0;
        for await (const entry of zip.entries) {
          await budget.member(entry.size);
          checkPath(entry.name, limits);
          if (!await selection.matches(entry.name, true)) continue;
          if (parsed.exclusions.length && await exclusions.matches(entry.name, true)) continue;
          await budget.output(`${filtered(entry.name)}\n`);
          selected++;
        }
        let unmatched = false;
        for (let index = 0; index < parsed.patterns.length; index++) if (!selection.matched.has(index)) {
          await budget.output(`caution: filename not matched:  ${filtered(parsed.patterns[index]!)}\n`, true);
          unmatched = true;
        }
        return { exitCode: selected && !unmatched ? 0 : 11 };
      }
      if (parsed.list) await budget.output(parsed.verbose
        ? " Length   Method    Size  Cmpr    Date    Time   CRC-32   Name\n--------  ------  ------- ---- ---------- ----- --------  ----\n"
        : "  Length      Date    Time    Name\n---------  ---------- -----   ----\n");
      const rootRaw = parsed.destination === undefined ? context.cwd : vfsPath(context.cwd, parsed.destination);
      const root = parsed.list || parsed.pipe || parsed.test ? resolvePath(rootRaw) : await extraction.directory(rootRaw, true);
      if (!parsed.list && !parsed.pipe && !parsed.test) answers = new Answers(extraction.source(context.stdin), limits, context.signal);
      let overwrite: "ask" | "all" | "none" = parsed.neverOverwrite ? "none" : parsed.overwrite ? "all" : "ask";
      let exitCode = 0;
      let selected = 0;
      let badPasswords = 0;
      let total = 0;
      let compressedTotal = 0;
      let actualTotal = 0;
      let password = parsed.password;
      const payload = async function* (entry: ZipEntry) {
        let actual = 0;
        const signal = output?.signal ?? context.signal;
        if (entry.flags! & 1) {
          // A matching header byte does not authenticate the member. Verify
          // each candidate completely before retaining a password or output.
          for (let attempt = password !== undefined && parsed.password === undefined ? -1 : 0; attempt < 3; attempt++) {
            if (password === undefined) password = await extraction.operation(() => readZipPassword(options.zipHost, limits.maxArgumentBytes, signal, false));
            try {
              const stage = async function* (source: import("safe-bash-contracts").ByteSource) {
                const verified = await extraction.operation(() => spoolZipSource({ context, limits, operation: action => extraction.operation(async () => action()) }, context.cwd, source, Math.min(limits.maxEntryBytes, limits.maxTotalBytes - actualTotal)));
                try {
                  actualTotal += verified.source.size;
                  for (let offset = 0; offset < verified.source.size;) {
                    const chunk = await verified.source.read(offset, Math.min(limits.chunkSize, verified.source.size - offset));
                    if (!chunk.length) fail("ZIP truncated authenticated staging");
                    offset += chunk.length;
                    yield chunk;
                  }
                } finally { await verified.close(); }
              };
              yield* decodeZipEntry(entry, limits, signal, password, stage);
              return;
            } catch (error) {
              signal.throwIfAborted();
              if (parsed.password !== undefined || !(error instanceof PublicDiagnostic) || error.message !== "ZIP incorrect password") throw error;
              password = undefined;
            }
          }
          fail("ZIP incorrect password");
        }
        for await (const chunk of readBytes(decodeZipEntry(entry, limits, signal, password), signal)) {
          if (chunk.length > limits.maxEntryBytes - actual || chunk.length > limits.maxTotalBytes - actualTotal) fail("actual decompressed byte limit exceeded");
          actual += chunk.length; actualTotal += chunk.length;
          yield chunk;
        }
      };
      type StoredStat = Omit<FileStat, "identityScope"> & { identityScopeIndex?: number };
      const identityScopes: NonNullable<FileStat["identityScope"]>[] = [];
      const storeStat = (stat: FileStat): StoredStat => {
        const { identityScope, ...rest } = stat;
        if (identityScope === undefined) return rest;
        let index = identityScopes.indexOf(identityScope);
        if (index < 0) { index = identityScopes.length; identityScopes.push(identityScope); }
        return { ...rest, identityScopeIndex: index };
      };
      const restoreStat = (stat: StoredStat): FileStat => {
        const { identityScopeIndex, ...rest } = stat;
        return identityScopeIndex === undefined ? rest : { ...rest, identityScope: identityScopes[identityScopeIndex]! };
      };
      type Link = { path: string; shown: string; target: string; existing: StoredStat | undefined; parent: StoredStat; mode: number; modified: Date };
      type Directory = { path: string; identity: StoredStat; parent: StoredStat; mode: number; modified: Date };
      const links = scratch ? new ZipMetadataMap<Link>(scratch, context.signal) : new Map<string, Link>();
      const directories = scratch ? new ZipMetadataMap<Directory>(scratch, context.signal) : new Map<string, Directory>();
      for await (const entry of zip.entries) {
        await budget.member(entry.size);
        checkPath(entry.name, limits);
        if (!await selection.matches(entry.name, true)) continue;
        if (parsed.exclusions.length && await exclusions.matches(entry.name, true)) continue;
        selected++; total += entry.size;
        try {
          if (parsed.test) {
            for await (const chunk of payload(entry)) { if (chunk.length) context.signal.throwIfAborted(); }
            if (!parsed.quiet) await budget.output(`    testing: ${padded(filtered(entry.name))} OK\n`);
            continue;
          }
          if (parsed.pipe) {
            if (parsed.pipeHeaders && !parsed.quiet) await budget.output(`${entry.method === 0 ? " extracting" : "  inflating"}: ${padded(filtered(entry.name))}  \n`);
            for await (const chunk of payload(entry)) await output!.output.write(chunk);
            if (parsed.pipeHeaders && !parsed.quiet) await budget.output("\n");
            continue;
          }
          if (parsed.list) {
            const size = entry.compressedSize ?? entry.data.length;
            compressedTotal += size;
            const method = entry.method === 0 ? "Stored" : entry.method === 8 ? "Defl:N" : entry.method === 12 ? "BZip2" : entry.method === 14 ? "LZMA" : `m${entry.method}`;
            const ratio = entry.size ? Math.round(100 * (entry.size - size) / entry.size) : 0;
            await budget.output(parsed.verbose
              ? `${String(entry.size).padStart(8)}  ${method.padEnd(6)} ${String(size).padStart(8)} ${String(ratio).padStart(3)}% ${date(entry)} ${entry.crc32.toString(16).padStart(8, "0")}  ${filtered(entry.name)}\n`
              : `${String(entry.size).padStart(9)}  ${date(entry)}   ${filtered(entry.name)}\n`);
            if (entry.comment) await comment(entry.comment, budget);
            continue;
          }
          let path = extraction.member(root, entry.name);
          const fileType = entry.mode & 0o170000;
          if (fileType && fileType !== 0o100000 && fileType !== 0o040000 && fileType !== 0o120000 && fileType !== 0o010000) fail("unsupported special ZIP entry");
          if (path === root && !entry.directory) fail("entry would replace extraction root");
          if (parsed.junkPaths && entry.directory) continue;
          const name = parsed.junkPaths ? entry.name.split("/").at(-1)! : entry.name;
          if (parsed.junkPaths) path = extraction.member(root, name);
          if (path === root && !entry.directory) fail("entry would replace extraction root");
          let shown = parsed.destination === undefined ? name : `${parsed.destination.endsWith("/") ? parsed.destination : `${parsed.destination}/`}${name}`;
          if (parsed.freshen && !await extraction.stat(path)) continue;
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
              if (!parsed.quiet) await budget.output(`   creating: ${filtered(shown)}\n`);
            }
            if (!identity || identity.type !== "directory") fail("directory changed during creation");
            await directories.set(String(directories.size), { path, mode: entry.mode, modified: entry.modified, identity: storeStat(identity), parent: storeStat(parent) });
            continue;
          }
          let parent = await extraction.operation(() => context.fs.lstat(dirname(path), { signal: context.signal }));
          let existing = await extraction.destination(path, archivePath, archiveStat);
          if (parsed.update && existing && Math.ceil(Math.floor(existing.mtimeMs / 1000) / 2) * 2000 >= entry.modified.getTime()) continue;
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
          if (entry.symlink) {
            const bytes = await collectBytes(payload(entry), { maxBytes: limits.maxPathBytes, signal: context.signal });
            await writeFileOutput(context, bytes, async () => {});
            const target = text(bytes);
            await extraction.target(root, path, target);
            if (!context.fs.symlink || context.fs.capabilities.symlinks === false) fail("filesystem does not support symlinks");
            await links.set(String(links.size), { path, shown, target, existing: existing && storeStat(existing), parent: storeStat(parent), mode: entry.mode, modified: entry.modified });
            if (!parsed.quiet) await budget.output(`    linking: ${padded(filtered(shown))}  -> ${filtered(target)} \n`);
          } else {
            await extraction.publish(root, path, payload(entry), existing, parent, entry.mode, entry.modified);
            if (!parsed.quiet) await budget.output(`${entry.method === 0 ? " extracting" : "  inflating"}: ${padded(filtered(shown))}  \n`);
          }
        } catch (error) {
          context.signal.throwIfAborted();
          if (!(error instanceof PublicDiagnostic) || error.message !== "ZIP incorrect password") throw error;
          badPasswords++;
          await budget.output(`skipping: ${filtered(entry.name)}  incorrect password\n`, true);
        }
      }
      if (parsed.list) await budget.output(parsed.verbose
        ? `--------          -------  ---                            -------\n${String(total).padStart(8)}         ${String(compressedTotal).padStart(8)} ${String(total ? Math.round(100 * (total - compressedTotal) / total) : 0).padStart(3)}%                            ${selected} file${selected === 1 ? "" : "s"}\n`
        : `---------                     -------\n${String(total).padStart(9)}                     ${selected} file${selected === 1 ? "" : "s"}\n`);
      else {
        if (links.size && !parsed.quiet) await budget.output("finishing deferred symbolic links:\n");
        for await (const link of links.values()) {
          await extraction.parents(root, link.path, false);
          await extraction.target(root, link.path, link.target);
          await extraction.destination(link.path, archivePath, archiveStat);
          await extraction.publish(root, link.path, [], link.existing && restoreStat(link.existing), restoreStat(link.parent), link.mode, link.modified, link.target);
          if (!parsed.quiet) await budget.output(`  ${padded(filtered(link.shown))} -> ${filtered(link.target)}\n`);
        }
        for (let ordinal = directories.size - 1; ordinal >= 0; ordinal--) {
          const directory = (await directories.get(String(ordinal)))!;
          await extraction.metadata(root, directory.path, restoreStat(directory.identity), restoreStat(directory.parent), directory.mode, directory.modified);
        }
      }
      for (let index = 0; index < parsed.patterns.length; index++) if (!selection.matched.has(index)) {
        await budget.output(`caution: filename not matched:  ${filtered(parsed.patterns[index]!)}\n`, true);
        exitCode = 11;
      }
      const resultCode = badPasswords ? badPasswords === selected ? 82 : 1 : selected ? exitCode : 11;
      if (parsed.test && parsed.quiet < 2) await budget.output(resultCode
        ? `At least one error was detected in ${filtered(archive)}.\n`
        : `No errors detected in compressed data of ${filtered(archive)}.\n`);
      return { exitCode: resultCode };
    } catch (error) {
      original.signal.throwIfAborted();
      const message = display(publicDiagnosticMessage(error, original.onInternalError).slice(0, limits.maxDiagnosticBytes));
      await writeBytes(original.stderr, encodeBytes(`unzip: ${message}\n`).subarray(0, limits.maxDiagnosticBytes), original.signal);
      return { exitCode: 2 };
    } finally { await close(); }
  }) };
}
