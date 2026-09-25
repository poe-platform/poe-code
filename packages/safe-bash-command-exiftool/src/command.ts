import { commandRuntimeIdentity, getCommandArguments, type CommandDefinition } from "safe-bash-contracts/command";
import { FsError } from "safe-bash-contracts/errors";
import { readBytes, writeBytes } from "safe-bash-contracts/io";
import { createOutputOperation, type OutputOperation } from "safe-bash-contracts/output";
import type { VirtualShellPlugin } from "safe-bash-contracts/plugin";
import { shellValueByteLength } from "safe-bash-contracts/value";
import { parseArguments } from "./arguments.js";
import { inspectPng, editPng, type MetadataTag } from "./png.js";
import { inspectPdf, editPdf, pdfWriteTags } from "./pdf.js";
import { Publication } from "./publication.js";
import { Resources, ResourceLimitError, type ResourceLimits } from "./resources.js";
import { encodeJsonScalar, printable } from "./scalar.js";
import { exiftoolRegistry } from "./registry.js";
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
    description: "Inspect and edit admitted PNG metadata through virtual files",
    async execute(context) {
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
          if (error instanceof ResourceLimitError) throw error;
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
            const png = bytes.length >= 8 && bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71;
            if (writing) {
              if (!original) throw new Error("Writing stdin metadata is not yet supported");
              if (!png && !isPdf) throw new Error("Format writer not yet supported");
              let assignments = invocation.assignments;
              if (invocation.tagsFromFile !== undefined) {
                const source = await acquire(invocation.tagsFromFile);
                const srcIsPdf = source.bytes.length >= 5 && source.bytes[0] === 0x25 && source.bytes[1] === 0x50 && source.bytes[2] === 0x44 && source.bytes[3] === 0x46;
                const srcTags = srcIsPdf ? inspectPdf(source.bytes, resources).tags : inspectPng(source.bytes, resources).tags;
                const values = selected(srcTags, invocation.tags, false, resources);
                resources.admit("work", values.length * exiftoolRegistry.tags.length * 16);
                resources.admit("retained", values.length * 128);
                assignments = values.filter(tag => isPdf ? pdfWriteTags.has(tag.name) : Object.hasOwn(exiftoolRegistry.writeChunks, tag.name)).map(tag => ({ name: tag.name, operation: "set" as const, value: tag.value }));
              }
              const edited = isPdf ? editPdf(bytes, assignments, resources) : editPng(bytes, assignments, resources);
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
            if (!png && !isPdf && ["XMP", "DOCX", "PPTX", "XLSX", "JPG", "JPEG", "TIF", "TIFF"].includes(extension)) throw new Error(extension + " reader not yet supported");
            tags = png ? inspectPng(bytes, resources).tags : isPdf ? inspectPdf(bytes, resources).tags : [];
          } catch (error) {
            context.signal.throwIfAborted();
            if (error instanceof ResourceLimitError) throw error;
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
              entries.push("  " + token + ": " + encodeJsonScalar(tag.value, scalarOptions));
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
                const group = invocation.groupFamily === 1 ? (tag.group === "PDF" ? "[PDF]" : "[PNG]").padEnd(16) : "";
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
      finally { await cleanup(); }
    },
  } satisfies CommandDefinition);
}

export const exiftoolCommand = createExiftoolCommand();
export function exiftoolCommands(options: ExiftoolCommandOptions = {}): VirtualShellPlugin {
  const command = createExiftoolCommand(options);
  return { name: "exiftool", setup(host) { host.commands.register(command, { replace: options.replace ?? false }); } };
}
