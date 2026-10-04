import { executeRetainedUnite, pdfuniteUsage as usage } from "./retained.js";
import { drainCooperativeSteps as drainSteps } from "safe-bash-contracts/yield";
import { commandRuntimeIdentity, getCommandArguments, type CommandContext, type CommandDefinition } from "safe-bash-contracts/command";
import { createOutputOperation } from "safe-bash-contracts/output";
import type { VirtualShellPlugin } from "safe-bash-contracts/plugin";
import { PdfDocument, PdfError, cosArray, cosDict, cosName, cosNumber, cosStream, cosString, dictGet, decodePdfString, resolveDestinationPageIndex, type PdfCosNode, type PdfCosDict } from "@poe-code/pdf-ast";

export interface PdfuniteLimits {
  readonly maxInputBytes: number;
  readonly maxOutputBytes: number;
  readonly maxPages: number;
  readonly maxObjects: number;
}
export interface PdfuniteCommandsOptions {
  readonly limits?: Partial<PdfuniteLimits>;
  readonly replace?: boolean;
}
export type PdfuniteCommandOptions = PdfuniteCommandsOptions;
function resolveLimits(options: PdfuniteCommandsOptions): PdfuniteLimits {
  const limits = { maxInputBytes: 67108864, maxOutputBytes: 134217728, maxPages: 10000, maxObjects: 100000, ...options.limits };
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`Invalid ${name} limit`);
  }
  return limits;
}

function copyDocumentMetadata(srcDoc: PdfDocument, dstDoc: PdfDocument): void {
  const meta = srcDoc.getMetadata();
  if (meta.title) dstDoc.setTitle(meta.title);
  if (meta.author) dstDoc.setAuthor(meta.author);
  if (meta.subject) dstDoc.setSubject(meta.subject);
  if (meta.keywords) dstDoc.setKeywords(meta.keywords);
  if (meta.creator) dstDoc.setCreator(meta.creator);
  if (meta.producer) dstDoc.setProducer(meta.producer);
}

interface DetachedEmbeddedFile {
  readonly name: string;
  readonly data: Uint8Array;
}

function collectEmbeddedAttachments(doc: PdfDocument): DetachedEmbeddedFile[] {
  const cos = doc.cos;
  const results: DetachedEmbeddedFile[] = [];
  const seenNames = new Set<string>();

  const extractFromFilespec = (fsDict: PdfCosDict | undefined, fallbackName: string) => {
    if (!fsDict) return;
    const ufNode = cos.resolve(dictGet(fsDict, "UF") ?? dictGet(fsDict, "F"));
    const name = ufNode?.kind === "string" ? decodePdfString(ufNode) : fallbackName;
    const efDict = cos.resolveDict(dictGet(fsDict, "EF"));
    const streamNode = efDict
      ? cos.resolve(
          dictGet(efDict, "UF") ??
            dictGet(efDict, "F") ??
            dictGet(efDict, "DOS") ??
            dictGet(efDict, "Mac") ??
            dictGet(efDict, "Unix")
        )
      : undefined;
    if (streamNode?.kind === "stream" && !seenNames.has(name)) {
      seenNames.add(name);
      results.push({ name, data: cos.decodeStream(streamNode) });
    }
  };

  const extractFromAfNode = (afNode: PdfCosNode | undefined, prefix: string) => {
    if (!afNode) return;
    const afArr = cos.resolveArray(afNode);
    if (afArr) {
      for (let idx = 0; idx < afArr.items.length; idx++) {
        extractFromFilespec(cos.resolveDict(afArr.items[idx]), `${prefix}_af_${idx + 1}`);
      }
    } else {
      extractFromFilespec(cos.resolveDict(afNode), `${prefix}_af`);
    }
  };

  const walkNameTree = (node: PdfCosDict | undefined, visited = new Set<number>()) => {
    if (!node) return;
    const namesArr = cos.resolveArray(dictGet(node, "Names"));
    if (namesArr) {
      for (let i = 0; i + 1 < namesArr.items.length; i += 2) {
        const keyNode = cos.resolve(namesArr.items[i]);
        const fallback = keyNode?.kind === "string" ? decodePdfString(keyNode) : `attachment_${results.length + 1}`;
        extractFromFilespec(cos.resolveDict(namesArr.items[i + 1]), fallback);
      }
    }
    const kidsArr = cos.resolveArray(dictGet(node, "Kids"));
    if (kidsArr) {
      for (const kid of kidsArr.items) {
        if (kid.kind === "ref") {
          if (visited.has(kid.objectNumber)) continue;
          visited.add(kid.objectNumber);
        }
        walkNameTree(cos.resolveDict(kid), visited);
      }
    }
  };

  const root = cos.resolveDict(cos.rootRef);
  const namesDict = root ? cos.resolveDict(dictGet(root, "Names")) : undefined;
  walkNameTree(namesDict ? cos.resolveDict(dictGet(namesDict, "EmbeddedFiles")) : undefined);
  if (root) {
    extractFromAfNode(dictGet(root, "AF"), "catalog");
  }

  for (let p = 0; p < doc.pageCount; p++) {
    const page = doc.getPage(p);
    extractFromAfNode(dictGet(page.pageDict, "AF"), `page${p + 1}`);
    const annots = cos.resolveArray(dictGet(page.pageDict, "Annots"));
    if (!annots) continue;
    for (const item of annots.items) {
      const annot = cos.resolveDict(item);
      if (!annot) continue;
      const subtype = cos.resolve(dictGet(annot, "Subtype"));
      if (subtype?.kind === "name" && subtype.decoded === "FileAttachment") {
        extractFromFilespec(cos.resolveDict(dictGet(annot, "FS")), `page${p + 1}_attachment`);
      }
    }
  }
  return results;
}

function* runPdfuniteCliSteps(argv: readonly string[], files: Map<string, Uint8Array>, signal?: AbortSignal, options: PdfuniteCommandsOptions = {}): Generator<void, {
    exitCode: number;
    stdout: string;
    stderr: string;
}, void> {
    const limits = resolveLimits(options);
    let inputBytes = 0;
    const chargedPaths = new Set<string>();
    let outputBytes = 0;
    let cooperativeWork = 63;
    const positionals: string[] = [];
    for (let i = 0; i < argv.length; i++) {
        if (++cooperativeWork % 64 === 0)
            yield;
        const arg = argv[i]!;
        if (arg === "-v" || arg === "--version") return { exitCode: 0, stdout: "", stderr: "pdfunite version 24.08.0\n" };
        if (["-h", "-help", "--help", "-?"].includes(arg)) return { exitCode: 0, stdout: "", stderr: usage };
        if (arg === "--") { positionals.push(...argv.slice(i + 1)); break; }
        if (arg.startsWith("-")) return { exitCode: 99, stdout: "", stderr: usage };
        positionals.push(arg);
    }
    if (positionals.length < 3) {
        return {
            exitCode: 99,
            stdout: "",
            stderr: usage
        };
    }
    const destPath = positionals[positionals.length - 1]!;
    const sourcePaths = positionals.slice(0, -1);
    const merged = PdfDocument.create();
    let copiedMeta = false;
    const mergedOutlineItems: Array<{
        title: string;
        targetPageIdx: number;
    }> = [];
    const mergedAttachments: DetachedEmbeddedFile[] = [];
    const seenAttachmentNames = new Set<string>();
    const mergedPageLabelNums: PdfCosNode[] = [];
    let pageOffset = 0;
    for (const srcPath of sourcePaths) {
        if (++cooperativeWork % 64 === 0)
            yield;
        const srcBytes = files.get(srcPath);
        if (!srcBytes) {
            return { exitCode: 255, stdout: "", stderr: `I/O Error: Couldn't open file '${srcPath}': No such file or directory.\nSyntax Error: Could not merge damaged documents ('${srcPath}')\n` };
    }
    if (!chargedPaths.has(srcPath)) { inputBytes += srcBytes.byteLength; chargedPaths.add(srcPath); }
    if (inputBytes > limits.maxInputBytes) throw new RangeError("Input byte limit exceeded");
    let srcDoc: PdfDocument;
    try {
      srcDoc = (yield* PdfDocument.loadSteps(srcBytes, { maxObjects: limits.maxObjects, maxDecompressedBytes: limits.maxInputBytes, maxRecursionDepth: 128 }));
    } catch (err) {
      signal?.throwIfAborted();
      if (err instanceof PdfError && err.code === "E_LIMIT") throw err;
      return { exitCode: 255, stdout: "", stderr: `${err instanceof PdfError && (err.code === "E_PASSWORD" || err.message === "Invalid PDF password") ? "Command Line Error: Incorrect password\n" : ""}Syntax Error: Could not merge damaged documents ('${srcPath}')\n` };
        }
        if (srcDoc.cos.encryptRef || srcDoc.cos.encryption) return { exitCode: 255, stdout: "", stderr: `Unimplemented Feature: Could not merge encrypted files ('${srcPath}')\n` };
        if (pageOffset + srcDoc.pageCount > limits.maxPages) throw new RangeError("Page limit exceeded");
        if (!copiedMeta) {
            copyDocumentMetadata(srcDoc, merged);
            copiedMeta = true;
        }
        for (const att of collectEmbeddedAttachments(srcDoc)) {
            if (++cooperativeWork % 64 === 0)
                yield;
            if (!seenAttachmentNames.has(att.name)) {
                seenAttachmentNames.add(att.name);
                mergedAttachments.push(att);
            }
        }
        const srcCat = srcDoc.cos.resolveDict(srcDoc.cos.rootRef);
        const collectSrcPageLabels = (plNode: PdfCosDict | undefined, visited = new Set<number>()) => {
            if (!plNode)
                return;
            const numsArr = srcDoc.cos.resolveArray(dictGet(plNode, "Nums"));
            if (numsArr) {
                for (let idx = 0; idx + 1 < numsArr.items.length; idx += 2) {
                    const kNode = srcDoc.cos.resolve(numsArr.items[idx]);
                    const vDict = srcDoc.cos.resolveDict(numsArr.items[idx + 1]);
                    if (kNode?.kind === "number" && vDict) {
                        const clonedEntries: Record<string, PdfCosNode> = {};
                        const sNode = srcDoc.cos.resolve(dictGet(vDict, "S"));
                        const stNode = srcDoc.cos.resolve(dictGet(vDict, "St"));
                        const pNode = srcDoc.cos.resolve(dictGet(vDict, "P"));
                        if (sNode?.kind === "name")
                            clonedEntries.S = cosName(sNode.decoded);
                        if (stNode?.kind === "number")
                            clonedEntries.St = cosNumber(stNode.value);
                        if (pNode?.kind === "string")
                            clonedEntries.P = { kind: "string", bytes: new Uint8Array(pNode.bytes), format: pNode.format };
                        mergedPageLabelNums.push(cosNumber(pageOffset + kNode.value), cosDict(clonedEntries));
                    }
                }
            }
            const kidsArr = srcDoc.cos.resolveArray(dictGet(plNode, "Kids"));
            if (kidsArr) {
                for (const kid of kidsArr.items) {
                    if (kid.kind === "ref") {
                        if (visited.has(kid.objectNumber))
                            continue;
                        visited.add(kid.objectNumber);
                    }
                    collectSrcPageLabels(srcDoc.cos.resolveDict(kid), visited);
                }
            }
        };
        if (srcCat) {
            collectSrcPageLabels(srcDoc.cos.resolveDict(dictGet(srcCat, "PageLabels")));
        }
        const srcOutlines = srcCat ? srcDoc.cos.resolveDict(dictGet(srcCat, "Outlines")) : undefined;
        const collectOutlinesFromSrc = (nodeOrRef: PdfCosNode | undefined, visited = new Set<number>()) => {
            let cur = nodeOrRef;
            while (cur) {
                if (cur.kind === "ref") {
                    if (visited.has(cur.objectNumber))
                        break;
                    visited.add(cur.objectNumber);
                }
                const d = srcDoc.cos.resolveDict(cur);
                if (!d)
                    break;
                const tNode = srcDoc.cos.resolve(dictGet(d, "Title"));
                const title = tNode?.kind === "string" ? decodePdfString(tNode) : "";
                const localPage = resolveDestinationPageIndex(srcDoc, dictGet(d, "Dest") ?? dictGet(d, "A")) ?? 0;
                if (title) {
                    mergedOutlineItems.push({ title, targetPageIdx: pageOffset + localPage });
                }
                const firstChild = dictGet(d, "First");
                if (firstChild)
                    collectOutlinesFromSrc(firstChild, visited);
                cur = dictGet(d, "Next");
            }
        };
        if (srcOutlines)
            collectOutlinesFromSrc(dictGet(srcOutlines, "First"));
        const indices = Array.from({ length: srcDoc.pageCount }, (_, idx) => idx);
        yield* merged.copyPagesFromSteps(srcDoc, indices);
        pageOffset += srcDoc.pageCount;
    }
    if (mergedOutlineItems.length > 0 && merged.pageCount > 0) {
        const dstCat = merged.cos.resolveDict(merged.cos.rootRef);
        if (dstCat) {
            const outlinesDict = cosDict({});
            const outlinesRef = merged.cos.allocateObject(outlinesDict);
            const itemRefs: Array<{
                ref: ReturnType<typeof merged.cos.allocateObject>;
                dict: PdfCosDict;
            }> = [];
            for (const bm of mergedOutlineItems) {
                if (++cooperativeWork % 64 === 0)
                    yield;
                const pRef = merged.getPage(Math.min(merged.pageCount - 1, Math.max(0, bm.targetPageIdx))).ref;
                const iDict = cosDict({
                    Title: cosString(bm.title),
                    Parent: outlinesRef,
                    Dest: cosArray([pRef, cosName("Fit")]),
                });
                const iRef = merged.cos.allocateObject(iDict);
                const prev = itemRefs[itemRefs.length - 1];
                if (prev) {
                    prev.dict.entries.push({ key: cosName("Next"), value: iRef });
                    iDict.entries.push({ key: cosName("Prev"), value: prev.ref });
                }
                else {
                    outlinesDict.entries.push({ key: cosName("First"), value: iRef });
                }
                itemRefs.push({ ref: iRef, dict: iDict });
            }
            const lastItem = itemRefs[itemRefs.length - 1];
            if (lastItem) {
                outlinesDict.entries.push({ key: cosName("Last"), value: lastItem.ref });
                outlinesDict.entries.push({ key: cosName("Count"), value: cosNumber(itemRefs.length) });
                dstCat.entries.push({ key: cosName("Outlines"), value: outlinesRef });
            }
        }
    }
    const finalDstCat = merged.cos.resolveDict(merged.cos.rootRef);
    if (finalDstCat) {
        if (mergedAttachments.length > 0) {
            const namesPairs: PdfCosNode[] = [];
            for (const att of mergedAttachments) {
                if (++cooperativeWork % 64 === 0)
                    yield;
                const efRef = merged.cos.allocateObject(cosStream(att.data, {
                    dict: cosDict({ Type: cosName("EmbeddedFile") }),
                    compress: true,
                }));
                const fsRef = merged.cos.allocateObject(cosDict({
                    Type: cosName("Filespec"),
                    F: cosString(att.name),
                    UF: cosString(att.name),
                    EF: cosDict({ F: efRef, UF: efRef }),
                }));
                namesPairs.push(cosString(att.name), fsRef);
            }
            const efTreeRef = merged.cos.allocateObject(cosDict({ Names: cosArray(namesPairs) }));
            finalDstCat.entries.push({
                key: cosName("Names"),
                value: merged.cos.allocateObject(cosDict({ EmbeddedFiles: efTreeRef })),
            });
        }
        if (mergedPageLabelNums.length > 0) {
            finalDstCat.entries.push({
                key: cosName("PageLabels"),
                value: merged.cos.allocateObject(cosDict({ Nums: cosArray(mergedPageLabelNums) })),
            });
        }
    }
    const bytes = yield* merged.saveSteps();
    outputBytes += bytes.byteLength;
    if (outputBytes > limits.maxOutputBytes) throw new RangeError("Output byte limit exceeded");
    files.set(destPath, bytes);
    return { exitCode: 0, stdout: "", stderr: "" };
}
export async function runPdfuniteCli(argv: readonly string[], files: Map<string, Uint8Array>, signal?: AbortSignal, options: PdfuniteCommandsOptions = {}): Promise<{
    exitCode: number;
    stdout: string;
    stderr: string;
}> {
    return drainSteps(runPdfuniteCliSteps(argv, files, signal, options), signal);
}

export function createPdfuniteCommand(options: PdfuniteCommandsOptions = {}): CommandDefinition {
  const limits = resolveLimits(options);
  return Object.freeze({
    name: "pdfunite",
    runtimeIdentity: commandRuntimeIdentity,
    description: "Merge multiple PDF documents into a single PDF via @poe-code/pdf-ast",
    async execute(context: CommandContext) {
      const operation = createOutputOperation(context, { write: async () => {} });
      let failed = false;
      try { return await executeRetainedUnite(context, getCommandArguments(context).args, limits, operation.signal); }
      catch (error) { failed = true; throw error; }
      finally { await operation.close().catch(error => { if (!failed) throw error; }); }
    }
  });
}
export const pdfuniteCommand = createPdfuniteCommand();
export function createPdfuniteCommands(options: PdfuniteCommandsOptions = {}): readonly CommandDefinition[] {
  return Object.freeze([createPdfuniteCommand(options)]);
}
export function pdfuniteCommands(options: PdfuniteCommandsOptions = {}): VirtualShellPlugin {
  const commands = createPdfuniteCommands(options);
  return { name: "pdfunite", setup(host) {
    for (const command of commands) host.commands.register(command, { replace: options.replace ?? false });
  } };
}
