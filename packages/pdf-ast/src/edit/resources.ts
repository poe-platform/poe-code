import { dictGet, dictSet, type PdfContentNode, type PdfCosDict, type PdfCosNode, type PdfCosStream } from "../ast.js";
import type { PdfPage } from "../canvas.js";
import { parseContentStream } from "../content/parser.js";
import type { ParsedCosDocument } from "../cos/parser.js";

/** Follow named resource use, as qpdf's ResourceFinder does, before discarding XObjects. */
export function pruneUnusedXObjects(doc: ParsedCosDocument, pages: readonly PdfPage[]): void {
  const used = new Map<PdfCosDict, Set<string>>();
  const scanned = new Map<PdfCosStream, Set<PdfCosDict>>();
  const pending: Array<{ nodes: readonly PdfContentNode[]; resources: PdfCosDict }> = [];
  const operators: Readonly<Record<string, string>> = {
    CS: "ColorSpace", cs: "ColorSpace", gs: "ExtGState", SCN: "Pattern", scn: "Pattern", sh: "Shading",
  };

  const enqueueStream = (node: PdfCosNode | undefined, inherited: PdfCosDict) => {
    const stream = doc.resolve(node);
    if (stream?.kind !== "stream") return;
    const resources = doc.resolveDict(dictGet(stream.dict, "Resources")) ?? inherited;
    let contexts = scanned.get(stream);
    if (!contexts) scanned.set(stream, contexts = new Set());
    if (contexts.has(resources)) return;
    contexts.add(resources);
    pending.push({ nodes: parseContentStream(doc.decodeStream(stream)), resources });
  };

  const useResource = (category: string, name: string, resources: PdfCosDict) => {
    if (category === "XObject") used.get(resources)!.add(name);
    const dictionary = doc.resolveDict(dictGet(resources, category));
    const target = dictionary ? doc.resolve(dictGet(dictionary, name)) : undefined;
    if (!target) return;
    if (category === "XObject" && target.kind === "stream") {
      const subtype = doc.resolve(dictGet(target.dict, "Subtype"));
      if (subtype?.kind === "name" && subtype.decoded === "Form") enqueueStream(target, resources);
    } else if (category === "Pattern" && target.kind === "stream") {
      enqueueStream(target, resources);
    } else if (category === "Font" && target.kind === "dict") {
      const programs = doc.resolveDict(dictGet(target, "CharProcs"));
      const fontResources = doc.resolveDict(dictGet(target, "Resources")) ?? resources;
      for (const entry of programs?.entries ?? []) enqueueStream(entry.value, fontResources);
    } else if (category === "ExtGState" && target.kind === "dict") {
      const mask = doc.resolveDict(dictGet(target, "SMask"));
      if (mask) enqueueStream(dictGet(mask, "G"), resources);
    }
  };

  for (const page of pages) {
    const resources = page.getResourcesDict();
    pending.push({ nodes: page.getContentAst(), resources });
    const annotations = doc.resolveArray(dictGet(page.pageDict, "Annots"));
    for (const node of annotations?.items ?? []) {
      const annotation = doc.resolveDict(node);
      const appearances = annotation ? doc.resolveDict(dictGet(annotation, "AP")) : undefined;
      for (const entry of appearances?.entries ?? []) {
        const appearance = doc.resolve(entry.value);
        if (appearance?.kind === "stream") enqueueStream(appearance, resources);
        else if (appearance?.kind === "dict") {
          for (const state of appearance.entries) enqueueStream(state.value, resources);
        }
      }
    }
  }

  while (pending.length > 0) {
    const { nodes, resources } = pending.pop()!;
    if (!used.has(resources)) used.set(resources, new Set());
    const remaining = [...nodes];
    while (remaining.length > 0) {
      const node = remaining.pop()!;
      if (node.kind === "graphics-group") {
        for (const child of node.ops) remaining.push(child);
      } else if (node.kind === "marked-content") {
        for (const child of node.children) remaining.push(child);
      } else if (node.kind === "xobject") {
        useResource("XObject", node.name, resources);
      } else if (node.kind === "state-op") {
        const category = operators[node.operator];
        if (category) {
          const name = node.operands.at(-1);
          if (name?.kind === "name") useResource(category, name.decoded, resources);
        }
      } else if (node.kind === "text-object") {
        for (const command of node.commands) {
          if (command.kind === "font") useResource("Font", command.fontName, resources);
          else if (command.kind === "state-op") {
            const category = operators[command.operator];
            const name = command.operands.at(-1);
            if (category && name?.kind === "name") useResource(category, name.decoded, resources);
          }
        }
      }
    }
  }

  for (const [resources, names] of used) {
    const xobjects = doc.resolveDict(dictGet(resources, "XObject"));
    if (xobjects) {
      dictSet(resources, "XObject", {
        kind: "dict", entries: xobjects.entries.filter(entry => names.has(entry.key.decoded)),
      });
    }
  }
}
