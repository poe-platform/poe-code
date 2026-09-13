import type { BinaryInput, Location } from "./contracts.js";
import { OfficeError } from "./errors.js";
import { admitImage } from "./image-admission.js";
import { child, escape, loadShared, nextRel, relPart } from "./masters.js";
import { relativePartReference } from "./package-uri.js";
import { nodeFor } from "./shape-operations.js";
import type { SelectionContext } from "./selectors.js";
import { readTable } from "./tables.js";
import { readTextBodies } from "./text-reading.js";
import { protectedEquationNodes } from "./equations-compatibility.js";
import type { XmlElement, XmlPart } from "./xml.js";
interface BindingTarget {
  readonly name: string;
  readonly scope: "slides";
  readonly slide: number;
  readonly cardinality: "one" | "all";
}
export type TemplateBinding = BindingTarget &
  (
    | { readonly kind: "text"; readonly text: string }
    | { readonly kind: "table"; readonly table: readonly (readonly string[])[] }
    | {
        readonly kind: "image";
        readonly image: { readonly bytes: readonly number[]; readonly contentType: string };
      }
  );
function invalid(): never {
  throw new OfficeError(
    "invalid-value",
    "Bindings require typed stored JSON data with explicit scope and cardinality.",
    "usage"
  );
}
function object(
  value: unknown,
  keys: readonly string[],
  required: readonly string[] = keys
): asserts value is Record<string, unknown> {
  if (
    !value ||
    typeof value !== "object" ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
    required.some((key) => !Object.hasOwn(value, key)) ||
    Reflect.ownKeys(value).some(
      (key) =>
        typeof key !== "string" ||
        !keys.includes(key) ||
        !("value" in Object.getOwnPropertyDescriptor(value, key)!)
    )
  )
    invalid();
}
function array(value: unknown): asserts value is unknown[] {
  if (
    !Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Array.prototype ||
    Reflect.ownKeys(value).length !== value.length + 1
  )
    invalid();
  for (let i = 0; i < value.length; i++)
    if (!("value" in (Object.getOwnPropertyDescriptor(value, String(i)) ?? {}))) invalid();
}
function text(value: unknown): asserts value is string {
  if (typeof value !== "string" || value.length > 1048576) invalid();
  for (const character of value) {
    const point = character.codePointAt(0)!;
    if (
      (point < 32 && ![9, 10, 13].includes(point)) ||
      (point >= 0xd800 && point <= 0xdfff) ||
      point === 0xfffe ||
      point === 0xffff
    )
      invalid();
  }
}
function utf8Size(value: string): number {
  let size = 0;
  for (const character of value) {
    const point = character.codePointAt(0)!;
    size += point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
  }
  return size;
}
export function validateTemplateBindings(
  bindings: unknown
): asserts bindings is readonly TemplateBinding[] {
  array(bindings);
  if (bindings.length > 1000) invalid();
  const seen = new Set<string>();
  for (const binding of bindings) {
    object(
      binding,
      ["kind", "name", "scope", "slide", "cardinality", "text", "table", "image"],
      ["kind", "name", "scope", "slide", "cardinality"]
    );
    text(binding.name);
    if (
      !binding.name ||
      binding.name.includes("{") ||
      binding.name.includes("}") ||
      binding.scope !== "slides" ||
      !Number.isSafeInteger(binding.slide) ||
      (binding.slide as number) < 1 ||
      !["one", "all"].includes(binding.cardinality as string)
    )
      invalid();
    if (typeof binding.kind !== "string" || !["text", "table", "image"].includes(binding.kind))
      invalid();
    const field = binding.kind;
    if (
      !field ||
      Object.keys(binding).length !== 6 ||
      !Object.hasOwn(binding, field) ||
      ["text", "table", "image"].some((key) => key !== field && Object.hasOwn(binding, key))
    )
      invalid();
    const key = JSON.stringify([binding.slide, binding.kind, binding.name]);
    if (seen.has(key)) invalid();
    seen.add(key);
    if (binding.kind === "text") text(binding.text);
    else if (binding.kind === "table") {
      array(binding.table);
      if (!binding.table.length || binding.table.length > 250000) invalid();
      let columns = 0;
      for (const row of binding.table) {
        array(row);
        if (!row.length || row.length > 250000 || (columns && columns !== row.length)) invalid();
        columns = row.length;
        for (const cell of row) text(cell);
      }
    } else {
      object(binding.image, ["bytes", "contentType"]);
      array(binding.image.bytes);
      text(binding.image.contentType);
      if (!binding.image.contentType) invalid();
      if (
        Object.keys(binding.image).length !== 2 ||
        !binding.image.bytes.length ||
        binding.image.bytes.some(
          (value) => !Number.isInteger(value) || (value as number) < 0 || (value as number) > 255
        )
      )
        invalid();
    }
  }
}
function markers(value: string) {
  const result: { name: string; start: number; end: number }[] = [];
  let cursor = 0;
  while (cursor < value.length) {
    const start = value.indexOf("{{", cursor);
    if (start < 0) break;
    const end = value.indexOf("}}", start + 2);
    if (end < 0) break;
    const name = value.slice(start + 2, end);
    if (name && !name.includes("{") && !name.includes("}"))
      result.push({ name, start, end: end + 2 });
    cursor = end + 2;
  }
  return result;
}
export async function applyTemplateBindings(
  input: BinaryInput,
  bindings: readonly TemplateBinding[],
  context: SelectionContext
): Promise<{
  readonly bytes: Uint8Array;
  readonly affected: number;
  readonly locations: readonly Location[];
}> {
  validateTemplateBindings(bindings);
  let cumulative = 0;
  for (const binding of bindings) {
    context.signal?.throwIfAborted();
    const size =
      binding.kind === "text"
        ? utf8Size(binding.text)
        : binding.kind === "image"
          ? binding.image.bytes.length
          : binding.table.reduce(
              (n, row) => n + row.reduce((m, cell) => m + utf8Size(cell) + 1, 0),
              0
            );
    cumulative += size;
    if (cumulative > context.limits.maxBytes)
      throw new OfficeError(
        "resource-limit",
        "Bindings exceed the cumulative byte budget.",
        "admit"
      );
  }
  const snapshots = bindings.map((binding) =>
    binding.kind === "image"
      ? { ...binding, image: { ...binding.image, bytes: [...binding.image.bytes] } }
      : binding.kind === "table"
        ? { ...binding, table: binding.table.map((row) => [...row]) }
        : { ...binding }
  );
  for (const binding of snapshots) {
    const size =
      binding.kind === "text"
        ? utf8Size(binding.text)
        : binding.kind === "image"
          ? binding.image.bytes.length
          : binding.table.reduce((n, row) => n + row.reduce((m, cell) => m + utf8Size(cell), 0), 0);
    if (
      size >
      Math.min(
        context.limits.maxBytes,
        binding.kind === "image" ? context.archiveLimits.maxEntryBytes : context.xmlLimits.maxBytes
      )
    )
      throw new OfficeError(
        "resource-limit",
        "Binding content exceeds the admitted budget.",
        "admit"
      );
    if (binding.kind === "image")
      admitImage(new Uint8Array(binding.image.bytes), binding.image.contentType);
  }
  const s = await loadShared(input, context);
  if (!snapshots.length) return { bytes: s.source, affected: 0, locations: [] };
  const byKey = new Map(
    snapshots.map((binding) => [
      JSON.stringify([binding.slide, binding.kind, binding.name]),
      binding
    ])
  );
  const counts = new Map<TemplateBinding, number>();
  const locations: Location[] = [];
  const edits = new Map<string, { document: XmlPart; values: Map<XmlElement, string> }>();
  const images: {
    part: string;
    id: string;
    binding: Extract<TemplateBinding, { kind: "image" }>;
  }[] = [];
  const targetParts = new Map<string, number>();
  for (const binding of snapshots) {
    const slide = s.index.inventory.slides.find((slide) => slide.position === binding.slide);
    if (!slide) throw new OfficeError("missing-binding", "Binding slide does not exist.", "select");
    targetParts.set(slide.part, binding.slide);
  }
  const resolve = (slide: number, kind: string, name: string, location: Location) => {
    const binding = byKey.get(JSON.stringify([slide, kind, name]));
    if (!binding)
      throw new OfficeError(
        "missing-binding",
        "A required template binding is missing.",
        "validate-intent"
      );
    const count = (counts.get(binding) ?? 0) + 1;
    counts.set(binding, count);
    if (count > 1 && binding.cardinality !== "all")
      throw new OfficeError(
        "ambiguous-selection",
        "Repeated template slots require all cardinality.",
        "select"
      );
    if (!locations.some((item) => JSON.stringify(item) === JSON.stringify(location)))
      locations.push(location);
    return binding;
  };
  const ownedTables = new Set<string>();
  for (const record of s.index.objects) {
    context.signal?.throwIfAborted();
    const slide = targetParts.get(record.part);
    if (slide === undefined) continue;
    const named = markers(record.name);
    if (named.length !== 1 || named[0]!.start !== 0 || named[0]!.end !== record.name.length)
      continue;
    const doc = edits.get(record.part)?.document ?? s.doc(record.part);
    const node = nodeFor(doc.root, record.id);
    const graphic = child(node, "graphic", s.a);
    const data = graphic && child(graphic, "graphicData", s.a);
    const table = data && child(data, "tbl", s.a);
    if (table) {
      const binding = resolve(slide, "table", named[0]!.name, record.location);
      if (binding.kind !== "table") invalid();
      const info = readTable(node, doc);
      if (
        binding.table.length !== info.rows ||
        binding.table.some((row) => row.length !== info.columns)
      )
        throw new OfficeError(
          "invalid-value",
          "Table bindings must match the template grid dimensions.",
          "validate-intent"
        );
      if (info.cells.some((cell) => cell.isMergeOrigin || cell.isSpanned))
        throw new OfficeError(
          "unsupported-edit",
          "Merged table slots are not supported.",
          "validate-intent"
        );
      const values = edits.get(record.part)?.values ?? new Map<XmlElement, string>();
      const rows = table.children.filter(
        (row) => row.name.namespace === s.a && row.name.localName === "tr"
      );
      rows.forEach((row, r) =>
        row.children
          .filter((cell) => cell.name.namespace === s.a && cell.name.localName === "tc")
          .forEach((cell, c) => {
            const body = child(cell, "txBody", s.a);
            if (
              body?.children.filter(
                (item) => item.name.namespace === s.a && item.name.localName === "p"
              ).length !== 1
            )
              throw new OfficeError(
                "unsupported-edit",
                "Table slots require one existing paragraph per cell.",
                "validate-intent"
              );
            const texts: XmlElement[] = [];
            const opaque = protectedEquationNodes(doc.root);
            const visit = (item: XmlElement) => {
              if (
                opaque.has(item) ||
                (item.name.namespace === s.a && ["fld", "br"].includes(item.name.localName))
              )
                throw new OfficeError(
                  "unsupported-edit",
                  "Structured table slots require ordinary text runs.",
                  "validate-intent"
                );
              if (item.name.namespace === s.a && item.name.localName === "t") texts.push(item);
              else item.children.forEach(visit);
            };
            if (body) visit(body);
            if (!texts.length)
              throw new OfficeError(
                "unsupported-edit",
                "Table slots require an existing text run in each cell.",
                "validate-intent"
              );
            texts.forEach((item, i) => values.set(item, i === 0 ? binding.table[r]![c]! : ""));
          })
      );
      edits.set(record.part, { document: doc, values });
      ownedTables.add(JSON.stringify([record.part, record.id]));
    } else if (node.name.localName === "pic" && node.name.namespace === s.p) {
      const binding = resolve(slide, "image", named[0]!.name, record.location);
      if (binding.kind !== "image") invalid();
      const fill = child(node, "blipFill");
      const blip = fill && child(fill, "blip", s.a);
      if (
        !blip ||
        !blip.attributes.some(
          (attribute) => attribute.name.namespace === s.r && attribute.name.localName === "embed"
        )
      )
        throw new OfficeError(
          "unsupported-edit",
          "Image slots require an embedded picture.",
          "validate-intent"
        );
      if (
        blip.children.length ||
        blip.attributes.some((attribute) => attribute.name.localName === "link")
      )
        throw new OfficeError(
          "unsupported-edit",
          "Image slots require a single embedded source without extensions.",
          "validate-intent"
        );
      const embed = blip.attributes.find(
        (attribute) => attribute.name.namespace === s.r && attribute.name.localName === "embed"
      )!.value;
      const relation = s.index.inventory.relationships.find(
        (relation) => relation.owner === record.part && relation.id === embed
      );
      if (
        !relation ||
        relation.external ||
        !relation.type.endsWith("/image") ||
        !relation.targetPart
      )
        throw new OfficeError(
          "unsupported-edit",
          "Image slot relationship is not an embedded image.",
          "validate-intent"
        );
      s.doc(relPart(record.part));
      images.push({ part: record.part, id: record.id, binding });
    }
  }
  let replacementBudget = 0;
  const bodies = await readTextBodies(s.source, { scope: "slides" }, context);
  for (const body of bodies) {
    context.signal?.throwIfAborted();
    const slide = targetParts.get(body.part);
    if (slide === undefined) continue;
    if (ownedTables.has(JSON.stringify([body.part, body.segment.location.objectId]))) continue;
    let edit = edits.get(body.part);
    if (!edit) {
      edit = { document: body.document, values: new Map() };
      edits.set(body.part, edit);
    }
    const opaque = protectedEquationNodes(body.document.root);
    for (const [paragraphIndex, paragraph] of body.paragraphs.entries()) {
      let range: XmlElement[] = [];
      const runText = new Map<XmlElement, string>();
      const flush = () => {
        const original = range.map((node) => runText.get(node)!).join("");
        const replacements = markers(original).map((marker) => {
          const binding = resolve(slide, "text", marker.name, body.segment.location);
          if (binding.kind !== "text") invalid();
          return { ...marker, value: binding.text };
        });
        let projected = utf8Size(original);
        for (const replacement of replacements) {
          const size = utf8Size(replacement.value);
          projected += size - utf8Size(original.slice(replacement.start, replacement.end));
          replacementBudget += size;
          if (
            !Number.isSafeInteger(projected) ||
            projected > context.xmlLimits.maxBytes ||
            replacementBudget > context.archiveLimits.maxTotalBytes
          )
            throw new OfficeError(
              "resource-limit",
              "Expanded binding text exceeds the output budget.",
              "validate-intent"
            );
        }
        let offset = 0;
        for (const node of range) {
          const before = runText.get(node)!;
          const end = offset + before.length;
          let cursor = offset;
          let value = "";
          for (const replacement of replacements) {
            if (replacement.end <= offset || replacement.start >= end) continue;
            value += original.slice(cursor, Math.max(offset, replacement.start));
            if (replacement.start >= offset) value += replacement.value;
            cursor = Math.min(end, replacement.end);
          }
          value += original.slice(cursor, end);
          if (value !== before) {
            const path: number[] = [];
            let found = false;
            const locate = (item: XmlElement, steps: number[]) => {
              if (item === node) {
                path.push(...steps);
                found = true;
                return;
              }
              item.children.forEach((next, i) => {
                if (!found) locate(next, [...steps, i]);
              });
            };
            locate(body.document.root, []);
            let target = edit!.document.root;
            for (const index of path) target = target.children[index]!;
            edit!.values.set(target, value);
          }
          offset = end;
        }
        range = [];
      };
      let previous = -1;
      let inlineIndex = 0;
      for (const inline of paragraph.inlines) {
        const segment = body.segment.paragraphs[paragraphIndex]!.inlines[inlineIndex];
        if (inline.name.namespace === s.a && ["r", "fld", "br"].includes(inline.name.localName))
          inlineIndex++;
        const position = paragraph.node.children.indexOf(inline);
        if (position !== previous + 1) flush();
        previous = position;
        if (inline.name.namespace !== s.a || inline.name.localName !== "r" || opaque.has(inline)) {
          flush();
          continue;
        }
        const nodes = inline.children.filter(
          (node) => node.name.namespace === s.a && node.name.localName === "t"
        );
        if (nodes.length !== 1 || nodes[0]!.children.length)
          throw new OfficeError(
            "unsupported-edit",
            "Template text requires simple run text.",
            "validate-intent"
          );
        runText.set(nodes[0]!, segment?.kind === "run" ? segment.text : "");
        range.push(nodes[0]!);
      }
      flush();
    }
  }
  for (const binding of snapshots)
    if (!counts.has(binding))
      throw new OfficeError(
        "missing-binding",
        "A binding has no matching template slot.",
        "validate-intent"
      );
  for (const [part, edit] of edits) {
    context.signal?.throwIfAborted();
    const paths: { path: number[]; value: string }[] = [];
    const visit = (node: XmlElement, path: number[]) => {
      const value = edit.values.get(node);
      if (value !== undefined) paths.push({ path, value });
      node.children.forEach((item, i) => visit(item, [...path, i]));
    };
    visit(edit.document.root, []);
    let doc = edit.document;
    for (const { path, value } of paths) {
      let node = doc.root;
      for (const i of path) node = node.children[i]!;
      doc = doc.setText(node, value);
    }
    if (paths.length) s.save(part, doc);
  }
  for (const image of images) {
    context.signal?.throwIfAborted();
    const bytes = new Uint8Array(image.binding.image.bytes);
    const metadata = admitImage(bytes, image.binding.image.contentType);
    let n = 1;
    while (
      [...s.reader.names, ...s.changes.keys()].some(
        (name) => name.toLowerCase() === `/ppt/media/binding${n}.${metadata.extension}`
      )
    )
      n++;
    const media = `/ppt/media/binding${n}.${metadata.extension}`;
    const relations = s.doc(relPart(image.part));
    const id = nextRel(relations);
    s.save(
      relPart(image.part),
      relations.spliceChildren(relations.root, relations.root.children.length, 0, [
        `<Relationship xmlns="${relations.root.name.namespace}" Id="${id}" Type="${s.r}/image" Target="${escape(relativePartReference(media, image.part.slice(0, image.part.lastIndexOf("/"))))}"/>`
      ])
    );
    const types = s.doc("/[Content_Types].xml");
    s.save(
      "/[Content_Types].xml",
      types.spliceChildren(types.root, types.root.children.length, 0, [
        `<Override xmlns="${types.root.name.namespace}" PartName="${media}" ContentType="${escape(image.binding.image.contentType)}"/>`
      ])
    );
    s.changes.set(media, bytes);
    const doc = s.doc(image.part);
    const picture = nodeFor(doc.root, image.id);
    const blip = child(child(picture, "blipFill")!, "blip", s.a)!;
    s.save(
      image.part,
      doc.merge(blip, { attributes: [{ namespace: s.r, localName: "embed", value: id }] })
    );
  }
  return {
    bytes: (await s.finish(s.main, [...targetParts.values()])).bytes,
    affected: [...counts.values()].reduce((a, b) => a + b, 0),
    locations
  };
}
