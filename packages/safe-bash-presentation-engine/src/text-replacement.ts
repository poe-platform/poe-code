import { protectedEquationNodes } from "./equations-compatibility.js";
import type { BinaryInput, Location } from "./contracts.js";
import { OfficeError } from "./errors.js";
import { loadShared } from "./masters.js";
import { SelectionError, type SelectionContext } from "./selectors.js";
import {
  readTextBodies,
  validateTextReadingOptions,
  type ReadPresentationTextOptions
} from "./text-reading.js";
import { parseXmlPart, type XmlElement, type XmlPart } from "./xml.js";

export interface ReplacePresentationTextOptions extends ReadPresentationTextOptions {
  readonly find: string;
  readonly with: string;
  readonly first?: boolean;
  readonly all?: boolean;
  readonly occurrence?: number;
  readonly allowEmpty?: boolean;
  readonly style?: { readonly bold?: boolean; readonly italic?: boolean };
}
export interface TextReplacementResult {
  readonly bytes: Uint8Array;
  readonly affected: number;
  readonly locations: readonly Location[];
}
function authored(value: unknown, maximum: number): asserts value is string {
  if (typeof value !== "string")
    throw new OfficeError("invalid-value", "Expected literal text.", "usage");
  if (value.length > maximum)
    throw new OfficeError("resource-limit", "Literal text exceeds XML limits.", "usage");
  for (const character of value) {
    const point = character.codePointAt(0)!;
    if (
      (point < 32 && ![9, 10, 13].includes(point)) ||
      (point >= 0xd800 && point <= 0xdfff) ||
      point === 0xfffe ||
      point === 0xffff
    )
      throw new OfficeError(
        "invalid-value",
        "Literal text must contain valid XML Unicode scalars.",
        "usage"
      );
  }
}
export async function replacePresentationText(
  input: BinaryInput,
  options: ReplacePresentationTextOptions,
  context: SelectionContext
): Promise<TextReplacementResult> {
  if (
    !options ||
    typeof options !== "object" ||
    Array.isArray(options) ||
    Object.keys(options).some(
      (key) =>
        ![
          "style",
          "find",
          "with",
          "first",
          "all",
          "occurrence",
          "allowEmpty",
          "scope",
          "select",
          "shape"
        ].includes(key)
    ) ||
    (options.first !== undefined && options.first !== true) ||
    (options.all !== undefined && options.all !== true) ||
    (options.occurrence !== undefined &&
      (!Number.isSafeInteger(options.occurrence) || options.occurrence < 1)) ||
    (options.allowEmpty !== undefined && typeof options.allowEmpty !== "boolean") ||
    [options.first, options.all, options.occurrence].filter((value) => value !== undefined)
      .length !== 1
  )
    throw new OfficeError(
      "invalid-value",
      "Exactly one explicit text match cardinality is required.",
      "usage"
    );
  if (
    options.style !== undefined &&
    (!options.style ||
      typeof options.style !== "object" ||
      Array.isArray(options.style) ||
      Object.keys(options.style).length === 0 ||
      Object.entries(options.style).some(
        ([key, value]) => !["bold", "italic"].includes(key) || typeof value !== "boolean"
      ))
  )
    throw new OfficeError(
      "invalid-value",
      "Replacement style accepts only boolean bold and italic.",
      "usage"
    );
  authored(options.find, context.xmlLimits.maxBytes);
  authored(options.with, context.xmlLimits.maxBytes);
  if (!options.find) throw new OfficeError("invalid-value", "Find text cannot be empty.", "usage");
  const reading = {
    ...(options.scope === undefined ? {} : { scope: options.scope }),
    ...(options.select === undefined ? {} : { select: options.select }),
    ...(options.shape === undefined ? {} : { shape: options.shape })
  };
  validateTextReadingOptions(reading);
  const state = await loadShared(input, context);
  const bodies = await readTextBodies(state.source, reading, context).catch((error: unknown) => {
    if (
      options.allowEmpty &&
      options.select?.token === undefined &&
      error instanceof SelectionError &&
      error.code === "missing-selection"
    )
      return [];
    throw error;
  });
  type Piece = { text: string; replacement: boolean };
  const edits = new Map<string, { document: XmlPart; values: Map<XmlElement, Piece[]> }>();
  const locations: Location[] = [];
  let matches = 0,
    affected = 0;
  for (const body of bodies) {
    context.signal?.throwIfAborted();
    let changed = false;
    const opaqueInlines = protectedEquationNodes(body.document.root);
    const values = edits.get(body.part)?.values ?? new Map<XmlElement, Piece[]>();
    for (const [paragraphIndex, paragraph] of body.paragraphs.entries()) {
      let range: { node: XmlElement; text: string }[] = [];
      const flush = () => {
        const text = range.map((run) => run.text).join("");
        let start = 0;
        const replacements: { start: number; end: number }[] = [];
        for (;;) {
          context.signal?.throwIfAborted();
          const found = text.indexOf(options.find, start);
          if (found < 0) break;
          matches++;
          if (options.all || matches === (options.occurrence ?? 1))
            replacements.push({ start: found, end: found + options.find.length });
          start = found + options.find.length;
        }
        if (replacements.length) {
          const outputLength =
            text.length + replacements.length * (options.with.length - options.find.length);
          if (!Number.isSafeInteger(outputLength) || outputLength > context.xmlLimits.maxBytes)
            throw new OfficeError(
              "resource-limit",
              "Replacement text exceeds XML limits.",
              "serialize"
            );
          affected += replacements.length;
          changed = true;
          let offset = 0,
            replacementIndex = 0;
          for (const run of range) {
            const end = offset + run.text.length;
            let cursor = offset;
            const pieces: Piece[] = [];
            while (
              replacementIndex < replacements.length &&
              replacements[replacementIndex]!.end <= offset
            )
              replacementIndex++;
            for (let i = replacementIndex; i < replacements.length; i++) {
              const match = replacements[i]!;
              if (match.start >= end) break;
              const prefix = text.slice(cursor, Math.max(offset, match.start));
              if (prefix) pieces.push({ text: prefix, replacement: false });
              if (match.start >= offset && options.with)
                pieces.push({ text: options.with, replacement: true });
              cursor = Math.min(end, match.end);
            }
            const suffix = text.slice(cursor, end);
            if (suffix) pieces.push({ text: suffix, replacement: false });
            if (
              pieces.map((piece) => piece.text).join("") !== run.text ||
              (options.style && pieces.some((piece) => piece.replacement))
            )
              values.set(run.node, pieces);
            offset = end;
          }
        }
        range = [];
      };
      let inlineIndex = 0;
      let previousPosition = -1;
      for (const node of paragraph.inlines) {
        const position = paragraph.node.children.indexOf(node);
        if (position !== previousPosition + 1 || position < 0) flush();
        previousPosition = position;
        const drawing = node.name.namespace === state.a;
        if (opaqueInlines.has(node)) {
          flush();
          if (drawing && ["r", "fld", "br"].includes(node.name.localName)) inlineIndex++;
          continue;
        }
        if (drawing && node.name.localName === "r") {
          const inline = body.segment.paragraphs[paragraphIndex]!.inlines[inlineIndex++]!;
          const textNodes = node.children.filter(
            (child) => child.name.namespace === state.a && child.name.localName === "t"
          );
          if (textNodes.length !== 1 || textNodes[0]!.children.length)
            throw new OfficeError(
              "unsupported-edit",
              "Text replacement requires one simple text value per run.",
              "validate-intent"
            );
          range.push({ node: textNodes[0]!, text: inline.kind === "run" ? inline.text : "" });
        } else {
          flush();
          if (drawing && ["fld", "br"].includes(node.name.localName)) inlineIndex++;
        }
      }
      flush();
    }
    if (changed) {
      edits.set(body.part, { document: body.document, values });
      if (
        !locations.some(
          (location) => JSON.stringify(location) === JSON.stringify(body.segment.location)
        )
      )
        locations.push(body.segment.location);
    }
  }
  if (!affected) {
    if (!options.allowEmpty) throw new SelectionError("missing-selection");
    return { bytes: state.source, affected: 0, locations: [] };
  }
  for (const [part, edit] of edits) {
    const paths: { path: number[]; pieces: Piece[] }[] = [];
    const visit = (node: XmlElement, path: number[]) => {
      const pieces = edit.values.get(node);
      if (pieces !== undefined) paths.push({ path, pieces });
      node.children.forEach((child, index) => visit(child, [...path, index]));
    };
    visit(edit.document.root, []);
    let document = edit.document;
    for (const { path, pieces } of paths.reverse()) {
      let parent = document.root;
      for (const index of path.slice(0, -1)) parent = parent.children[index]!;
      const node = parent.children[path.at(-1)!]!;
      if (!options.style || !pieces.some((piece) => piece.replacement)) {
        document = document.setText(node, pieces.map((piece) => piece.text).join(""));
        continue;
      }
      const run = parent;
      const standalone = document.markup(run, true);
      const fragments = pieces.map((piece) => {
        let clone = parseXmlPart(new TextEncoder().encode(standalone), context.xmlLimits);
        const text = clone.root.children.find(
          (child) => child.name.localName === "t" && child.name.namespace === state.a
        )!;
        clone = clone.setText(text, piece.text);
        if (piece.replacement) {
          const name = { namespace: state.a, localName: "rPr" };
          clone = clone.merge(clone.root, {
            children: {
              sequence: [name, { namespace: state.a, localName: "t" }],
              upsert: [
                {
                  name,
                  merge: {
                    attributes: Object.entries(options.style!).map(([key, value]) => ({
                      namespace: "",
                      localName: key === "bold" ? "b" : "i",
                      value: value ? "1" : "0"
                    }))
                  }
                }
              ]
            }
          });
        }
        return clone.markup(clone.root);
      });
      let paragraph = document.root;
      for (const index of path.slice(0, -2)) paragraph = paragraph.children[index]!;
      document = document.spliceChildren(paragraph, path.at(-2)!, 1, fragments);
    }
    state.save(part, document);
  }
  const result = await state.finish(state.main, []);
  return { bytes: result.bytes, affected, locations };
}
