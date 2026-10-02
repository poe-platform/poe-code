import { SaxesParser } from "saxes";
import type { BinaryInput, Location } from "./contracts.js";
import { OfficeError } from "./errors.js";
import { loadShared } from "./masters.js";
import { SelectionError, type SelectionContext } from "./selectors.js";
import {
  readTextBodies,
  validateTextReadingOptions,
  type ReadPresentationTextOptions
} from "./text-reading.js";
import type { XmlElement, XmlPart } from "./xml.js";

export type FieldKind = "slide-number" | "date" | "footer" | "header";
export interface FieldUpdate {
  readonly kind?: FieldKind;
  readonly text?: string;
  readonly update?: "preserve" | "explicit";
  readonly timestamp?: Date;
}
export interface MutateFieldsOptions extends ReadPresentationTextOptions, FieldUpdate {
  readonly all?: boolean;
  readonly allowEmpty?: boolean;
}
const kinds = { "slide-number": "slidenum", date: "datetime", footer: "footer", header: "header" };
function invalid(message = "Invalid field update policy."): never {
  throw new OfficeError("invalid-value", message, "usage");
}
export function validateFieldOptions(
  options: MutateFieldsOptions,
  action: "set" | "add" | "remove"
): void {
  if (!["set", "add", "remove"].includes(action)) invalid();
  if (
    !options ||
    typeof options !== "object" ||
    Array.isArray(options) ||
    Object.keys(options).some(
      (key) =>
        ![
          "kind",
          "text",
          "update",
          "timestamp",
          "scope",
          "select",
          "shape",
          "all",
          "allowEmpty"
        ].includes(key)
    )
  )
    invalid();
  const { scope, select, shape } = options;
  validateTextReadingOptions({
    ...(scope === undefined ? {} : { scope }),
    ...(select === undefined ? {} : { select }),
    ...(shape === undefined ? {} : { shape })
  });
  for (const key of ["all", "allowEmpty"] as const)
    if (options[key] !== undefined && typeof options[key] !== "boolean") invalid();
  if (
    options.kind !== undefined &&
    (typeof options.kind !== "string" || !Object.hasOwn(kinds, options.kind))
  )
    invalid();
  if (options.update !== undefined && !["preserve", "explicit"].includes(options.update)) invalid();
  if (options.text !== undefined && typeof options.text !== "string") invalid();
  if (options.text !== undefined)
    for (const character of options.text) {
      const point = character.codePointAt(0)!;
      if (
        (point < 32 && ![9, 10, 13].includes(point)) ||
        (point >= 0xd800 && point <= 0xdfff) ||
        point === 0xfffe ||
        point === 0xffff
      )
        invalid("Field cache must contain valid XML Unicode scalars.");
    }
  if (
    options.timestamp !== undefined &&
    (!(options.timestamp instanceof Date) || !Number.isFinite(options.timestamp.getTime()))
  )
    invalid();
  if (action === "remove") {
    if (["kind", "text", "update", "timestamp"].some((key) => Object.hasOwn(options, key)))
      invalid();
    return;
  }
  if (action === "add" && options.kind === undefined) invalid("Adding a field requires a kind.");
  if (action === "set" && options.kind === undefined && options.update === undefined)
    invalid("Field set requires update options.");
  if (
    (options.update ?? "preserve") === "preserve" &&
    (options.text !== undefined || options.timestamp !== undefined)
  )
    invalid("Cached text and timestamp require explicit update.");
  if (options.update === "explicit" && options.text === undefined)
    invalid("Explicit update requires cached text.");
  if (options.update === "explicit" && options.kind === "date" && options.timestamp === undefined)
    invalid("Explicit date update requires a timestamp.");
  if (options.timestamp !== undefined && options.kind !== undefined && options.kind !== "date")
    invalid("Timestamp applies only to date fields.");
}
export function readField(document: XmlPart, node: XmlElement) {
  const attr = (key: string) =>
    node.attributes.find((a) => !a.name.namespace && a.name.localName === key)?.value ?? null;
  const fieldType = attr("type");
  const kind: FieldKind | null =
    fieldType === "slidenum"
      ? "slide-number"
      : fieldType !== null &&
          ["datetime", ...Array.from({ length: 13 }, (_, i) => `datetime${i + 1}`)].includes(
            fieldType
          )
        ? "date"
        : fieldType === "footer"
          ? "footer"
          : fieldType === "header"
            ? "header"
            : null;
  let cachedText = "";
  for (const child of node.children.filter(
    (n) => n.name.namespace === node.name.namespace && n.name.localName === "t"
  )) {
    const parser = new SaxesParser({ xmlns: true });
    parser.on("text", (text) => {
      cachedText += text;
    });
    parser.on("cdata", (text) => {
      cachedText += text;
    });
    parser.write(document.markup(child, true)).close();
  }
  return { kind, fieldId: attr("id"), fieldType, cachedText };
}
export function applyFieldUpdate(
  document: XmlPart,
  node: XmlElement,
  options: FieldUpdate
): XmlPart {
  validateFieldOptions(options, "set");
  const kind = options.kind ?? readField(document, node).kind;
  if (options.update === "explicit" && !kind)
    throw new OfficeError(
      "unsupported-edit",
      "Unknown field kinds require preservation or an explicit supported kind.",
      "validate-intent"
    );
  if (options.update === "explicit" && kind === "date" && options.timestamp === undefined)
    invalid("Explicit date update requires a timestamp.");
  if (options.timestamp !== undefined && kind !== "date")
    invalid("Timestamp applies only to date fields.");
  const children = node.children.filter(
    (n) => n.name.namespace === node.name.namespace && n.name.localName === "t"
  );
  if (children.length > 1) throw new OfficeError("invalid-xml", "Ambiguous field cache.", "parse");
  const path: number[] = [];
  function locate(current: XmlElement): boolean {
    if (current === node) return true;
    for (const [i, child] of current.children.entries()) {
      path.push(i);
      if (locate(child)) return true;
      path.pop();
    }
    return false;
  }
  if (!locate(document.root)) invalid();
  let next = document.merge(node, {
    ...(options.kind === undefined
      ? {}
      : { attributes: [{ namespace: "", localName: "type", value: kinds[options.kind] }] }),
    ...(options.update !== "explicit"
      ? {}
      : {
          children: {
            sequence: ["rPr", "pPr", "t"].map((localName) => ({
              namespace: node.name.namespace,
              localName
            })),
            upsert: [{ name: { namespace: node.name.namespace, localName: "t" }, merge: {} }]
          }
        })
  });
  if (options.update === "explicit") {
    const current = path.reduce((n, i) => n.children[i]!, next.root);
    next = next.setText(
      current.children.find(
        (n) => n.name.namespace === node.name.namespace && n.name.localName === "t"
      )!,
      options.text!
    );
  }
  return next;
}
export async function readFields(
  input: BinaryInput,
  options: ReadPresentationTextOptions,
  context: SelectionContext
) {
  const bodies = await readTextBodies(input, options, context);
  return bodies.flatMap((body) =>
    body.paragraphs.flatMap((p, paragraph) =>
      p.inlines
        .filter(
          (node) =>
            node.name.namespace === p.node.name.namespace &&
            ["r", "br", "fld"].includes(node.name.localName)
        )
        .flatMap((node, inline) =>
          node.name.localName === "fld"
            ? [
                {
                  location: body.segment.location,
                  paragraph,
                  inline,
                  coordinateSystem: "zero-based" as const,
                  ...readField(body.document, node)
                }
              ]
            : []
        )
    )
  );
}
export async function mutateFields(
  input: BinaryInput,
  action: "set" | "add" | "remove",
  options: MutateFieldsOptions,
  context: SelectionContext
): Promise<{ bytes: Uint8Array; affected: number; locations: readonly Location[] }> {
  validateFieldOptions(options, action);
  if (!options.all && options.select === undefined && options.shape === undefined)
    throw new SelectionError("missing-selection");
  const state = await loadShared(input, context);
  const { scope, select, shape } = options;
  const bodies = await readTextBodies(
    state.source,
    {
      ...(scope === undefined ? {} : { scope }),
      ...(select === undefined ? {} : { select }),
      ...(shape === undefined ? {} : { shape })
    },
    context
  );
  const targets = bodies.flatMap((body) =>
    action === "add"
      ? body.paragraphs.slice(-1).map((p) => ({ body, node: p.node }))
      : body.paragraphs.flatMap((p) =>
          p.inlines
            .filter((n) => n.name.namespace === p.node.name.namespace && n.name.localName === "fld")
            .map((node) => ({ body, node }))
        )
  );
  const unique = targets.filter(
    (target, index) =>
      targets.findIndex(
        (other) => other.body.part === target.body.part && other.node === target.node
      ) === index
  );
  if (!unique.length && !options.allowEmpty) throw new SelectionError("missing-selection");
  if (unique.length > 1 && (action === "add" || !options.all))
    throw new SelectionError("ambiguous-selection");
  const edits = new Map<string, { document: XmlPart; targets: XmlElement[] }>();
  for (const { body, node } of unique) {
    const edit = edits.get(body.part) ?? { document: body.document, targets: [] };
    edit.targets.push(node);
    edits.set(body.part, edit);
  }
  for (const [part, edit] of edits) {
    const paths: number[][] = [];
    const ids = new Set<string>();
    function visit(node: XmlElement, path: number[]) {
      if (edit.targets.includes(node)) paths.push(path);
      for (const a of node.attributes)
        if (!a.name.namespace && a.name.localName === "id") ids.add(a.value);
      node.children.forEach((child, i) => visit(child, [...path, i]));
    }
    visit(edit.document.root, []);
    let document = edit.document;
    for (const path of paths.reverse()) {
      context.signal?.throwIfAborted();
      const node = path.reduce((n, i) => n.children[i]!, document.root);
      if (action === "set") document = applyFieldUpdate(document, node, options);
      else if (action === "remove")
        document = document.spliceChildren(
          path.slice(0, -1).reduce((n, i) => n.children[i]!, document.root),
          path.at(-1)!,
          1,
          []
        );
      else {
        let serial = 1;
        const id = () => `{00000000-0000-0000-0000-${serial.toString(16).padStart(12, "0")}}`;
        while (ids.has(id())) serial++;
        const fieldId = id();
        ids.add(fieldId);
        const end = node.children.findIndex(
          (n) => n.name.namespace === node.name.namespace && n.name.localName === "endParaRPr"
        );
        const index = end < 0 ? node.children.length : end;
        document = document.spliceChildren(node, index, 0, [
          `<fld xmlns="${node.name.namespace}" id="${fieldId}" type="${kinds[options.kind!]}"><t/></fld>`
        ]);
        const inserted = path.reduce((n, i) => n.children[i]!, document.root).children[index]!;
        document = applyFieldUpdate(document, inserted, options);
      }
    }
    state.save(part, document);
  }
  return {
    bytes: unique.length ? (await state.finish(state.main, [])).bytes : state.source,
    affected: unique.length,
    locations: unique.map(({ body }) => body.segment.location)
  };
}
