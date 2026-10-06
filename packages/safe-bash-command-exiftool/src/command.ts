import { inspectContainerOrWebp } from "./containers.js";
import { systemTags } from "./system-tags.js";
import { yieldTurn } from "safe-bash-contracts/yield";
import { commandRuntimeIdentity, getCommandArguments, type CommandDefinition } from "safe-bash-contracts/command";
import { FsError } from "safe-bash-contracts/errors";
import { readBytes, writeBytes, withInputByteBudget } from "safe-bash-contracts/io";
import { createOutputOperation, type OutputOperation } from "safe-bash-contracts/output";
import type { VirtualShellPlugin } from "safe-bash-contracts/plugin";
import { shellValueByteLength } from "safe-bash-contracts/value";
import { parseArguments } from "./arguments.js";
import { inspectPng, editPng, type MetadataTag } from "./png.js";
import { inspectJpeg, editJpeg, jpegWriteTags } from "./jpeg.js";
import { inspectPdf, editPdf, pdfWriteTags } from "./pdf.js";
import { Publication } from "./publication.js";
import { Resources, ResourceLimitError, type ResourceLimits } from "./resources.js";
import { encodeJsonScalar, printable } from "./scalar.js";
import { exiftoolRegistry, stringMetadataTags } from "./registry.js";
import { isNumericShift } from "./shifts.js";
import { CsvTable } from "./csv.js";
import { expandArgfiles } from "./argfiles.js";
import { virtualPath } from "./paths.js";
import { renderPresentation, xmlHeader } from "./presentation.js";

export interface ExiftoolCommandOptions { readonly replace?: boolean; readonly limits?: Partial<ResourceLimits> }
function selected(tags: readonly MetadataTag[], names: readonly string[], duplicates: boolean, resources: Resources): MetadataTag[] {
  resources.admit("work", tags.length + names.length);
  resources.admit("retained", tags.length * 32);
  const requested = names.length ? names : [...new Set(tags.map(tag => tag.name))];
  const requestedExtent = requested.reduce((sum, name) => sum + name.length + 1, 0);
  const tagExtent = tags.reduce((sum, tag) => sum + tag.name.length + 1, 0);
  // Includes per-predicate lowercasing/comparison and every transient matching
  // array, plus selected output references. Admit before the multiplicative loop.
  resources.admit("work", tags.length * requestedExtent + tagExtent * requested.length * 2);
  resources.admit("retained", requested.length * (128 + tags.length * 16));
  const values: MetadataTag[] = [];
  for (const name of requested) {
    const matching = tags.filter(tag => tag.name.toLowerCase() === name.toLowerCase());
    if (duplicates) values.push(...matching); else if (matching.length) values.push(matching[matching.length - 1]!);
  }
  return values;
}
export function createExiftoolCommand(options: ExiftoolCommandOptions = {}): CommandDefinition {
  const limits = Object.freeze({ ...options.limits });
  return Object.freeze({
    name: "exiftool", runtimeIdentity: commandRuntimeIdentity,
    description: "Inspect and edit admitted PNG, JPEG and PDF metadata through virtual files",
    execute: withInputByteBudget(async context => {
      const publication = new Publication(context, limits.maxStagingAttempts);
      let stdout: OutputOperation | undefined, stderr: OutputOperation | undefined;
      let failed = false, failure: unknown;
      let closing: Promise<void> | undefined;
      const cleanup = (): Promise<void> => {
        closing ??= (async () => {
          const results = await Promise.allSettled([publication.close(), stdout?.close(), stderr?.close()]);
          const failures = results.filter(result => result.status === "rejected").map(result => result.reason);
          if (failures.length) {
            if (failed) failures.unshift(failure);
            throw new AggregateError(failures, "ExifTool invocation and cleanup failed");
          }
        })();
        return closing;
      };
      context.registerCleanup?.(cleanup);
      try {
        stdout = createOutputOperation(context, context.stdout);
        stderr = createOutputOperation(context, context.stderr);
        const resources = new Resources({ ...limits, signal: context.signal });
        const output = async (text: string, error = false): Promise<void> => {
          resources.admit("work", text.length * 2);
          resources.admit("output", text.length * 3);
          resources.admit("retained", text.length * 5);
          await writeBytes(error ? stderr!.output : stdout!.output, new TextEncoder().encode(text), context.signal);
        };
        if (context.args.length === 1 && ["--help", "-help", "-?"].includes(context.args[0]!)) {
          await output(`Usage: exiftool [OPTIONS] [-TAG...] FILE...
       exiftool --help | -help | -?

Inspect and edit the supported metadata subset in virtual files.
Standalone help reads no files and never invokes host ExifTool.

Examples:
  exiftool -j image.png
  exiftool -n -s3 -ImageWidth image.png
  exiftool -Title=Example image.png
  exiftool -Title= -overwrite_original image.png
  exiftool -j -- --help

Formats:
  PNG: dimensions, text metadata and timestamps; admitted tag writes.
  JPEG: dimensions, selected EXIF tags and comments; admitted tag writes.
  PDF: selected Info metadata reads/writes; no -all= or redaction.
  WebP, DOCX, PPTX, XLSX, ODT, EPUB: limited metadata inspection only.
  This is not full upstream format or tag compatibility.

Options:
  -j, -json       JSON extraction; -csv for CSV extraction
  -TAG           Select an admitted tag; -TAG=VALUE writes, -TAG= deletes
  -n, -s3        Numeric conversion, values-only output
  -overwrite_original  Replace without creating the default FILE_original backup
  --             Remaining arguments are literal file names
  -              Read stdin once (extraction only)
  -@ FILE        Read arguments from a virtual UTF-8 file
  -ver, --version  Report the reference ExifTool version

Limits:
  No host files, user config code, directory scanning or stay_open protocol.
  Unsupported flags, tags and editing operations are refused.
  SDK limits bound cumulative input, decoded, retained and output bytes,
  work, arguments, files and argument-file depth; quotas default to unlimited.
  Configure maxInputBytes, maxOutputBytes, maxWork and other limits through
  exiftoolCommands({ limits }); cancellation and output budgets apply to help.
`);
          return { exitCode: 0 };
        }
        if (context.args.length === 1 && (context.args[0] === "-ver" || context.args[0] === "--version")) {
          await output(exiftoolRegistry.source.version + "\n");
          return { exitCode: 0 };
        }
        let invocation;
        try {
          const carrier = getCommandArguments(context);
          for (let index = 0; index < carrier.values.length; index++) {
            const extent = shellValueByteLength(carrier.values[index]!);
            resources.admit("decoded", context.args[index]!.length * 2);
            resources.admit("retained", extent + 128);
            resources.admit("work", extent * 4);
            const bytes = carrier.bytes(index)!;
            try {
              if (new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes) !== context.args[index]) throw new Error("Argv Unicode mismatch");
            } catch { throw new Error("Only qualified UTF-8 argv is currently supported"); }
          }
          invocation = parseArguments(await expandArgfiles(context.args, context, publication, resources), resources.limits);
        } catch (error) {
          context.signal.throwIfAborted();
          if (error instanceof ResourceLimitError || (error instanceof Error && error.name === "BudgetExceededError") || (error instanceof FsError && error.code === "EFBIG")) throw error;
          await output("Error: " + (error instanceof Error ? error.message : String(error)) + "\n", true);
          return { exitCode: 1 };
        }
        const json: string[] = [];
        const xml: string[] = [];
        const csv = invocation.csv ? new CsvTable(resources, invocation.missing, invocation.tags) : undefined;
        const assignment = invocation.assignments.length === 1 ? invocation.assignments[0] : undefined;
        if (assignment?.operation === "add" && Object.hasOwn(exiftoolRegistry.scalarShiftErrorGroups, assignment.name) && !isNumericShift(assignment.value)) {
          await output("Warning: Shift value for " + exiftoolRegistry.scalarShiftErrorGroups[assignment.name] + ":" + assignment.name + " is not a number\nNothing to do.\n", true);
          return { exitCode: 1 };
        }
        const acquire = async (file: string) => {
          const path = file === "-" ? "-" : virtualPath(context.cwd, file, resources);
          const original = file === "-" ? undefined : await publication.track(() => context.fs.lstat(path, { signal: context.signal }));
          if (original && original.type !== "file") throw new Error("Only regular VFS files are admitted");
          if (original) {
            resources.admit("input", original.size);
            resources.admit("retained", original.size * 32 + 256);
            resources.admit("decoded", original.size * 2);
            resources.admit("work", original.size * 20);
          }
          const bytes = await publication.track(async () => {
            if (original && !context.fs.readStream) {
              const result = await context.fs.readFile(path, { signal: context.signal, maxBytes: original.size });
              context.signal.throwIfAborted();
              if (result.length > original.size) throw new RangeError("ExifTool input grew beyond admitted size");
              return result;
            }
            const chunks: Uint8Array[] = [];
            let size = 0;
            const source = original ? context.fs.readStream!(path, { signal: context.signal }) : context.stdin;
            for await (const chunk of readBytes(source, context.signal)) {
              resources.admit("work", chunk.length + 64);
              if (original && chunk.length > original.size - size) throw new RangeError("ExifTool input grew beyond admitted size");
              if (!original) {
                resources.admit("input", chunk.length);
                resources.admit("retained", chunk.length * 32 + 256);
                resources.admit("decoded", chunk.length * 2);
                resources.admit("work", chunk.length * 20);
              }
              resources.admit("retained", chunk.length + 128);
              if (chunk.length) chunks.push(new Uint8Array(chunk));
              size += chunk.length;
            }
            resources.admit("retained", size);
            const result = new Uint8Array(size);
            let position = 0;
            for (const chunk of chunks) { result.set(chunk, position); position += chunk.length; }
            return result;
          });
          return { path, original, bytes };
        };
        let errors = 0, updated = 0, created = 0, unchanged = 0, read = 0;
        for (const file of invocation.files) {
          await yieldTurn(context.signal);
          context.signal.throwIfAborted();
          let tags: readonly MetadataTag[] = [];
          try {
            const { path, original, bytes } = await acquire(file);
            if (!bytes.length) throw new Error("File is empty");
            const extension = file.slice(file.lastIndexOf(".") + 1).toUpperCase();
            const writing = invocation.assignments.length > 0 || invocation.tagsFromFile !== undefined;
            if (writing && ["DOCX", "PPTX", "XLSX"].includes(extension)) throw new Error("Writing of " + extension + " files is not yet supported");
            const isPdf = extension === "PDF" || (bytes.length >= 5 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 && bytes[4] === 0x2d);
            if (isPdf && invocation.assignments.some(a => a.name.toLowerCase() === "all")) {
              throw new Error("PDF parser/writer not yet supported; metadata deletion retains historical revisions and never guarantees redaction");
            }
            const jpeg = bytes[0] === 255 && bytes[1] === 216;
            const png = bytes.length >= 8 && bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71;
            if (writing) {
              if (!original) throw new Error("Writing stdin metadata is not yet supported");
              if (!png && !isPdf && !jpeg) throw new Error("Format writer not yet supported");
              let assignments = invocation.assignments;
              if (invocation.tagsFromFile !== undefined) {
                const source = await acquire(invocation.tagsFromFile);
                const srcIsPdf = source.bytes.length >= 5 && source.bytes[0] === 0x25 && source.bytes[1] === 0x50 && source.bytes[2] === 0x44 && source.bytes[3] === 0x46;
                const srcJpeg = source.bytes[0] === 255 && source.bytes[1] === 216;
                const srcTags = srcJpeg ? inspectJpeg(source.bytes, resources).tags : srcIsPdf ? inspectPdf(source.bytes, resources).tags : inspectPng(source.bytes, resources).tags;
                const values = selected(srcTags, invocation.tags, false, resources);
                resources.admit("work", values.length * exiftoolRegistry.tags.length * 16);
                resources.admit("retained", values.length * 128);
                assignments = values.filter(tag => isPdf ? pdfWriteTags.has(tag.name) : jpeg ? Object.hasOwn(jpegWriteTags, tag.name) : Object.hasOwn(exiftoolRegistry.writeChunks, tag.name)).map(tag => ({ name: tag.name, operation: "set" as const, value: tag.value }));
              }
              const edited = jpeg ? editJpeg(bytes, assignments, resources) : isPdf ? editPdf(bytes, assignments, resources) : editPng(bytes, assignments, resources);
              resources.admit("retained", edited.length * 3);
              resources.admit("work", bytes.length);
              if (invocation.destination === undefined && !assignments.some(op => op.operation === "set" && op.value !== "") && edited.length === bytes.length && edited.every((byte, index) => byte === bytes[index])) { unchanged++; continue; }
              resources.admit("output", edited.length);
              const inPlace = invocation.overwrite === "in-place";
              const destination = invocation.destination === undefined ? path : virtualPath(context.cwd, invocation.destination, resources);
              if (invocation.destination === undefined) {
                await publication.track(() => context.fs.access(path, 2, { signal: context.signal }));
                if (!inPlace && original.nlink !== 1) throw new Error("VFS hardlink replacement is not yet supported");
                if (invocation.overwrite === "backup") {
                  const backup = path + "_original";
                  let existing = false;
                  try { await publication.track(() => context.fs.lstat(backup, { signal: context.signal })); existing = true; }
                  catch (error) { if (!(error instanceof FsError) || error.code !== "ENOENT") throw error; }
                  if (!existing) {
                    resources.admit("output", bytes.length);
                    await publication.publish(backup, bytes, null, false);
                  }
                }
              }
              await publication.publish(destination, edited, invocation.destination === undefined ? original : null, invocation.destination === undefined && inPlace);
              if (invocation.destination === undefined) updated++; else created++;
              continue;
            }
            // Unrecognized nonempty formats match the validated no-selected-tag control.
            if (!png && !isPdf && !jpeg && ["XMP", "JPG", "JPEG", "TIF", "TIFF"].includes(extension)) throw new Error(extension + " reader not yet supported");
            tags = jpeg ? inspectJpeg(bytes, resources).tags : png ? inspectPng(bytes, resources).tags : isPdf ? inspectPdf(bytes, resources).tags : (inspectContainerOrWebp(bytes, extension, resources)?.tags ?? []);
            tags = [...systemTags(file, bytes.length, tags, invocation, resources), ...tags];
          } catch (error) {
            context.signal.throwIfAborted();
            if (error instanceof ResourceLimitError || (error instanceof Error && error.name === "BudgetExceededError") || (error instanceof FsError && error.code === "EFBIG")) throw error;
            errors++;
            const message = error instanceof FsError && error.code === "ENOENT" ? "File not found" : error instanceof Error ? error.message : String(error);
            await output("Error: " + message + " - " + file + "\n", true);
            continue;
          }
          read++;
          const chosen = selected(tags, invocation.tags, invocation.json ? invocation.groupFamily === 4 : invocation.duplicates && !invocation.csv, resources);
          if (invocation.xml || invocation.tabular || invocation.template !== undefined) {
            const values = invocation.template !== undefined ? selected(tags, [], false, resources) : chosen;
            const rendered = renderPresentation(file, values, invocation, resources);
            if (invocation.xml) { resources.admit("retained", rendered.length * 2); xml.push(rendered); }
            else await output(rendered);
            continue;
          }
          if (csv) { csv.add(file, chosen); continue; }
          const present = new Set<string>();
          if (invocation.missing) {
            resources.admit("retained", chosen.length * 64);
            for (const tag of chosen) {
              resources.admit("work", tag.name.length + 1);
              present.add(tag.name);
            }
            resources.admit("work", invocation.tags.reduce((sum, name) => sum + name.length + 1, 0));
          }
          const scalarOptions = { quoteScalars: invocation.quoteScalars, signal: context.signal,
            maxDecodedBytes: resources.limits.maxDecodedBytes, maxOutputBytes: resources.limits.maxOutputBytes, maxWork: resources.limits.maxWork, maxRetainedBytes: resources.limits.maxRetainedBytes };
          if (invocation.json) {
            const entries = ['  "SourceFile": ' + encodeJsonScalar(file, { ...scalarOptions, quoteScalars: true })];
            const tokens = new Set<string>(['"SourceFile"']);
            const primaryInstances = new Map<string, number>();
            if (invocation.groupFamily === 4) for (const tag of tags) {
              resources.admit("work", tag.name.length + 1);
              resources.admit("retained", tag.name.length * 2 + 64);
              primaryInstances.set(tag.name, Math.max(primaryInstances.get(tag.name) ?? 0, tag.instance));
            }
            for (const tag of chosen) {
              resources.admit("work", tag.name.length * 4);
              const name = invocation.groupFamily === 4 ? (tag.instance === primaryInstances.get(tag.name) ? "" : "Copy" + (tag.instance + 1)) + ":" + tag.name : tag.name;
              const token = encodeJsonScalar(name, { ...scalarOptions, quoteScalars: true });
              if (tokens.has(token)) continue;
              tokens.add(token);
              resources.admit("work", tag.value.length * 4);
              entries.push("  " + token + ": " + encodeJsonScalar(tag.value, { ...scalarOptions, quoteScalars: invocation.quoteScalars || stringMetadataTags.has(tag.name) }));
            }
            if (invocation.missing) for (const name of invocation.tags) {
              if (present.has(name)) continue;
              resources.admit("work", name.length * 4 + 1);
              const token = encodeJsonScalar((invocation.groupFamily === 4 ? ":" : "") + name, { ...scalarOptions, quoteScalars: true });
              if (tokens.has(token)) continue;
              tokens.add(token);
              entries.push("  " + token + ': "-"');
            }
            const record = "{\n" + entries.join(",\n") + "\n}";
            resources.admit("retained", record.length * 2);
            json.push(record);
          } else {
            for (const tag of chosen) {
              if (invocation.binary) {
                // -b suppresses PrintConv, not ValueConv. tEXt's stored Latin-1
                // and tIME's packed fields therefore differ from output bytes.
                const converted = tag.chunkType !== "iTXt";
                const extent = converted ? tag.value.length * 3 : tag.raw.length;
                resources.admit("work", extent);
                resources.admit("output", extent);
                if (converted) resources.admit("retained", extent);
                await writeBytes(stdout.output, converted ? new TextEncoder().encode(tag.value) : tag.raw, context.signal);
              }
              else {
                resources.admit("work", (tag.name.length + tag.value.length) * 4);
                const value = printable(tag.value, scalarOptions);
                const group = invocation.groupFamily === 1 ? ("[" + tag.group + "]").padEnd(16) : "";
                await output(group + (invocation.style === "values" ? value + "\n" : (invocation.style === "compact" ? tag.name + ": " : tag.name.padEnd(32) + ": ") + value + "\n"));
              }
            }
            if (invocation.missing && !invocation.binary) for (const name of invocation.tags) {
              if (!present.has(name)) await output(invocation.style === "values" ? "-\n" : (invocation.style === "compact" ? name + ": " : name.padEnd(32) + ": ") + "-\n");
            }
          }
        }
        if (invocation.json && !invocation.assignments.length) await output("[" + json.join(",\n") + "]\n");
        if (invocation.xml) await output(xmlHeader + xml.join("") + "</rdf:RDF>\n");
        if (csv) {
          await output(csv.render());
          if (invocation.files.length > 1) await output(String(read).padStart(5) + " image files read\n", true);
        }
        if (updated || unchanged) await output(String(updated).padStart(5) + " image files updated\n");
        if (created) await output(String(created).padStart(5) + " image files created\n");
        if (unchanged) await output(String(unchanged).padStart(5) + " image files unchanged\n");
        return { exitCode: errors ? 1 : 0 };
      } catch (error) { failed = true; failure = error; throw error; }
      finally { await cleanup(); const gc = (globalThis as { gc?: () => void }).gc; if (typeof gc === "function") { gc(); gc(); } }
    }),
  } satisfies CommandDefinition);
}

export const exiftoolCommand = createExiftoolCommand();
export function exiftoolCommands(options: ExiftoolCommandOptions = {}): VirtualShellPlugin {
  const command = createExiftoolCommand(options);
  return { name: "exiftool", setup(host) { host.commands.register(command, { replace: options.replace ?? false }); } };
}

export type ExiftoolCommandsOptions = ExiftoolCommandOptions;

export function createExiftoolCommands(options: ExiftoolCommandsOptions = {}): readonly CommandDefinition[] {
    return [createExiftoolCommand(options)];
}

export function evalSyncExiftool(
  inBytes: Uint8Array | undefined,
  opArgs: readonly string[],
  readFileSync?: (filePath: string) => Uint8Array | undefined,
  writeFileSync?: (filePath: string, bytes: Uint8Array) => boolean,
): string | undefined {
  try {
    for (let i = 0; i < opArgs.length; i++) {
      if (opArgs[i] === "-@" || opArgs[i]!.startsWith("-@")) return undefined;
    }
    const syncSignal = new AbortController().signal;
    const resources = new Resources({ signal: syncSignal });
    const invocation = parseArguments([...opArgs], resources.limits);
    const writing = invocation.assignments.length > 0 || invocation.tagsFromFile !== undefined;
    if (invocation.binary || invocation.files.length === 0) {
      return undefined;
    }
    if (writing && !writeFileSync) {
      return undefined;
    }
    if (!writing && invocation.destination !== undefined) {
      return undefined;
    }
    if (invocation.csv && invocation.files.length > 1) {
      return undefined;
    }
    if (invocation.destination !== undefined && invocation.files.length > 1) {
      return undefined;
    }
    const stdinCount = invocation.files.filter(f => f === "-").length + (invocation.tagsFromFile === "-" ? 1 : 0);
    if (stdinCount > 1) {
      return undefined;
    }
    let out = "";
    const emit = (text: string) => {
      out += text;
    };
    const json: string[] = [];
    const xml: string[] = [];
    const csv = invocation.csv ? new CsvTable(resources, invocation.missing, invocation.tags) : undefined;
    let updated = 0, created = 0, unchanged = 0;
    const pendingWrites: Array<{ path: string; bytes: Uint8Array }> = [];

    for (const file of invocation.files) {
      const bytes = file === "-" ? inBytes : readFileSync?.(file);
      if (!bytes || !bytes.length || bytes.byteLength > 131072) return undefined;
      const extension = file.slice(file.lastIndexOf(".") + 1).toUpperCase();
      if (writing && (file === "-" || ["DOCX", "PPTX", "XLSX"].includes(extension))) return undefined;
      const isPdf = extension === "PDF" || (bytes.length >= 5 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 && bytes[4] === 0x2d);
      if (writing && isPdf && invocation.assignments.some(a => a.name.toLowerCase() === "all")) return undefined;
      const jpeg = bytes[0] === 255 && bytes[1] === 216;
      const png = bytes.length >= 8 && bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71;
      if (!png && !isPdf && !jpeg) return undefined;
      if (writing) {
        let assignments = invocation.assignments;
        if (invocation.tagsFromFile !== undefined) {
          const srcBytes = invocation.tagsFromFile === "-" ? inBytes : readFileSync?.(invocation.tagsFromFile);
          if (!srcBytes || !srcBytes.length || srcBytes.byteLength > 131072) return undefined;
          const srcIsPdf = srcBytes.length >= 5 && srcBytes[0] === 0x25 && srcBytes[1] === 0x50 && srcBytes[2] === 0x44 && srcBytes[3] === 0x46;
          const srcJpeg = srcBytes[0] === 255 && srcBytes[1] === 216;
          const srcPng = srcBytes.length >= 8 && srcBytes[0] === 137 && srcBytes[1] === 80 && srcBytes[2] === 78 && srcBytes[3] === 71;
          if (!srcIsPdf && !srcJpeg && !srcPng) return undefined;
          const srcTags = srcJpeg ? inspectJpeg(srcBytes, resources).tags : srcIsPdf ? inspectPdf(srcBytes, resources).tags : inspectPng(srcBytes, resources).tags;
          const values = selected(srcTags, invocation.tags, false, resources);
          assignments = values.filter(tag => isPdf ? pdfWriteTags.has(tag.name) : jpeg ? Object.hasOwn(jpegWriteTags, tag.name) : Object.hasOwn(exiftoolRegistry.writeChunks, tag.name)).map(tag => ({ name: tag.name, operation: "set" as const, value: tag.value }));
        }
        const edited = jpeg ? editJpeg(bytes, assignments, resources) : isPdf ? editPdf(bytes, assignments, resources) : editPng(bytes, assignments, resources);
        if (invocation.destination === undefined && !assignments.some(op => op.operation === "set" && op.value !== "") && edited.length === bytes.length && edited.every((byte, index) => byte === bytes[index])) {
          unchanged++;
          continue;
        }
        if (invocation.destination === undefined) {
          if (invocation.overwrite === "backup") {
            const backup = file + "_original";
            if (!readFileSync?.(backup)) {
              pendingWrites.push({ path: backup, bytes });
            }
          }
          pendingWrites.push({ path: file, bytes: edited });
          updated++;
        } else {
          if (readFileSync?.(invocation.destination)) return undefined;
          pendingWrites.push({ path: invocation.destination, bytes: edited });
          created++;
        }
        continue;
      }
      const metadata = jpeg ? inspectJpeg(bytes, resources).tags : png ? inspectPng(bytes, resources).tags : inspectPdf(bytes, resources).tags;
      const tags = [...systemTags(file, bytes.length, metadata, invocation, resources), ...metadata];
      const chosen = selected(tags, invocation.tags, invocation.json ? invocation.groupFamily === 4 : invocation.duplicates && !invocation.csv, resources);
      if (invocation.xml || invocation.tabular || invocation.template !== undefined) {
        const values = invocation.template !== undefined ? selected(tags, [], false, resources) : chosen;
        const rendered = renderPresentation(file, values, invocation, resources);
        if (invocation.xml) xml.push(rendered);
        else emit(rendered);
        continue;
      }
      if (csv) {
        csv.add(file, chosen);
        continue;
      }
      const present = new Set<string>();
      if (invocation.missing) {
        for (const tag of chosen) present.add(tag.name);
      }
      const scalarOptions = {
        signal: syncSignal,
        quoteScalars: invocation.quoteScalars,
        maxDecodedBytes: resources.limits.maxDecodedBytes,
        maxOutputBytes: resources.limits.maxOutputBytes,
        maxWork: resources.limits.maxWork,
        maxRetainedBytes: resources.limits.maxRetainedBytes,
      };
      if (invocation.json) {
        const entries = ['  "SourceFile": ' + encodeJsonScalar(file, { ...scalarOptions, quoteScalars: true })];
        const tokens = new Set<string>(['"SourceFile"']);
        const primaryInstances = new Map<string, number>();
        if (invocation.groupFamily === 4) {
          for (const tag of tags) {
            primaryInstances.set(tag.name, Math.max(primaryInstances.get(tag.name) ?? 0, tag.instance));
          }
        }
        for (const tag of chosen) {
          const name = invocation.groupFamily === 4 ? (tag.instance === primaryInstances.get(tag.name) ? "" : "Copy" + (tag.instance + 1)) + ":" + tag.name : tag.name;
          const token = encodeJsonScalar(name, { ...scalarOptions, quoteScalars: true });
          if (tokens.has(token)) continue;
          tokens.add(token);
          entries.push("  " + token + ": " + encodeJsonScalar(tag.value, { ...scalarOptions, quoteScalars: invocation.quoteScalars || stringMetadataTags.has(tag.name) }));
        }
        if (invocation.missing) {
          for (const name of invocation.tags) {
            if (present.has(name)) continue;
            const token = encodeJsonScalar((invocation.groupFamily === 4 ? ":" : "") + name, { ...scalarOptions, quoteScalars: true });
            if (tokens.has(token)) continue;
            tokens.add(token);
            entries.push("  " + token + ': "-"');
          }
        }
        json.push("{\n" + entries.join(",\n") + "\n}");
      } else {
        for (const tag of chosen) {
          const value = printable(tag.value, scalarOptions);
          const group = invocation.groupFamily === 1 ? ("[" + tag.group + "]").padEnd(16) : "";
          emit(group + (invocation.style === "values" ? value + "\n" : (invocation.style === "compact" ? tag.name + ": " : tag.name.padEnd(32) + ": ") + value + "\n"));
        }
        if (invocation.missing) {
          for (const name of invocation.tags) {
            if (!present.has(name)) emit(invocation.style === "values" ? "-\n" : (invocation.style === "compact" ? name + ": " : name.padEnd(32) + ": ") + "-\n");
          }
        }
      }
    }
    if (pendingWrites.length > 0) {
      if (!writeFileSync) return undefined;
      for (const pw of pendingWrites) {
        if (!pw.path || pw.path === "-" || pw.path.endsWith("/") || /(?:^|\/)\.\.(?:\/|$)/.test(pw.path)) return undefined;
      }
      for (const pw of pendingWrites) {
        if (!writeFileSync(pw.path, pw.bytes)) return undefined;
      }
    }
    if (invocation.json && !writing) emit("[" + json.join(",\n") + "]\n");
    if (invocation.xml) emit(xmlHeader + xml.join("") + "</rdf:RDF>\n");
    if (csv) emit(csv.render());
    if (updated || unchanged) emit(String(updated).padStart(5) + " image files updated\n");
    if (created) emit(String(created).padStart(5) + " image files created\n");
    if (unchanged) emit(String(unchanged).padStart(5) + " image files unchanged\n");
    return out.includes("\0") ? undefined : out;
  } catch {
    return undefined;
  } finally {
    const gc = (globalThis as { gc?: () => void }).gc;
    if (typeof gc === "function") { gc(); gc(); }
  }
}
