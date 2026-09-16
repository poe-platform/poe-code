import { resolvePath, type FileSystem } from "@poe-code/safe-fs/core";
import { SourceError, type DocxInvocation } from "./command.js";
import { ResourceLimitError, CancellationError, type ArchiveContext } from "./archive.js";
import type { DocxInspectionCommandRequest } from "./inspection-command.js";
import type { DocumentIo } from "./io.js";
import { getDocumentXml, replaceDocumentXmlPart, type XmlOptions } from "./xml-parts.js";
import { PublicationError, type PublicationInput } from "./publication.js";

export async function executeXmlCommand(invocation: DocxInvocation, bytes: Uint8Array, input: PublicationInput | undefined,
  request: DocxInspectionCommandRequest, context: ArchiveContext, io: DocumentIo): Promise<Uint8Array> {
  const options = invocation.options;
  if (invocation.operation === "xml.get") {
    const data = await getDocumentXml(bytes, context, { part: options.part as string,
      raw: options.raw === true || (options.json !== true && options.pretty !== true),
      ...(options.pretty === undefined ? {} : { pretty: options.pretty as boolean }) } satisfies XmlOptions);
    if (data instanceof Uint8Array) return data;
    if (!options.json) return new TextEncoder().encode(data.content);
    return new TextEncoder().encode(JSON.stringify({ version: 1, operation: "xml.get", ok: true, data, warnings: [], errors: [], affected: 0, locations: [] }) + "\n");
  }
  if ((options.inPlace || (options.output !== undefined && options.output !== "-")) && invocation.inputs[0] !== "-" && !input)
    throw new PublicationError("unsupported-publication", "File publication requires admitted input identity.");
  const file = invocation.sources!.find(source => source.argument === "file")!.path;
  let replacement: Uint8Array;
  try {
    replacement = await io.readBytes({ open(signal) {
      const source = file === "-" ? request.stdin : request.filesystem.readStream
        ? request.filesystem.readStream(resolvePath(request.cwd, file), { signal })
        : { async *[Symbol.asyncIterator]() { yield await request.filesystem.readFile(resolvePath(request.cwd, file), { signal }); } };
      return { async *[Symbol.asyncIterator]() {
        let size = 0;
        for await (const chunk of source) {
          size += chunk.length;
          if (size > Math.min(context.limits.maxEntryBytes, context.budget!.limits.xmlPartBytes)) throw new ResourceLimitError("XML input byte limit exceeded.");
          yield chunk;
        }
      } };
    } });
  } catch (error) {
    if (error instanceof ResourceLimitError || error instanceof CancellationError) throw error;
    request.signal.throwIfAborted();
    throw new SourceError("Unable to read the declared XML input.");
  }
  const output = typeof options.output === "string" ? options.output === "-" ? "-" : resolvePath(request.cwd, options.output) : undefined;
  const data = await replaceDocumentXmlPart(bytes, replacement, {
    part: options.part as string, ...(options.allowEmpty === undefined ? {} : { allowEmpty: options.allowEmpty as boolean }), ...(input ? { input } : {}), ...(output === undefined ? {} : { output }),
    ...(options.inPlace === undefined ? {} : { inPlace: options.inPlace as boolean }),
    ...(options.force === undefined ? {} : { force: options.force as boolean }),
    ...(options.dryRun === undefined ? {} : { dryRun: options.dryRun as boolean }),
    ...(options.json === undefined ? {} : { json: options.json as boolean })
  }, { ...context, encoding: { order: "input", compression: "store" }, filesystem: request.filesystem as FileSystem, stdout: request.stdout });
  if (output === "-" && !data.dryRun) return new Uint8Array();
  return new TextEncoder().encode(options.json ? JSON.stringify({ version: 1, operation: "xml.set", ok: true, data,
    warnings: [], errors: [], affected: data.changed ? 1 : 0, locations: data.changes.map(change => change.after) }) + "\n"
    : `docx xml set: ${data.dryRun ? "dry-run; " : ""}${data.changed ? "1 part replaced" : "unchanged"}\n`);
}
