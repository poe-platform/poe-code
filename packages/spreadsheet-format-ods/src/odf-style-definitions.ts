import type { Workbook } from "@poe-code/spreadsheet-ast";
import { snapshotRecords } from "@poe-code/spreadsheet-ast/model";
import { IntegerTable } from "@poe-code/safe-fs/storage";
import { ZipDirectoryIndex } from "@poe-code/office-package";
import type { CapabilityContext, WorkingStorage } from "@poe-code/spreadsheet-engine/contracts";
import { createOdfXml, odfAttributes, odfChildren, odfNamespaces, odfObject, type OdfAttributes } from "@poe-code/spreadsheet-engine/codecs/odf-write-support";
import { createDefinitionRecords } from "./odf-definition-records.js";

type Section = "contentAutomatic" | "stylesAutomatic" | "masters" | "fonts" | "styles";

/** Preserve imported definitions and reuse equivalent generated definitions.
 * Names belong to their package part, container, element type and style family. */
export async function createOdfStyleDefinitions(book: Workbook, xml: ReturnType<typeof createOdfXml>, context: CapabilityContext,
  storage?: WorkingStorage, admitContentBytes?: (bytes: number) => void) {
  const supplied = book.unsupportedRecords ?? [];
  const imported = Object.isFrozen(supplied) ? supplied : snapshotRecords(supplied, context.limits);
  const stringIndex = () => storage ? new ZipDirectoryIndex(storage, { maximumKeyLength: Infinity, signal: context.signal }) : new Map<string, number>();
  const sectionIndex = () => ({ identities: stringIndex(), shapes: stringIndex(), count: 0,
    entries: storage ? new IntegerTable(storage, 128) : new Map<bigint, bigint>() });
  const sections = new Map<Section, ReturnType<typeof sectionIndex>>(), names = stringIndex(), candidates = stringIndex(), records = createDefinitionRecords(context, storage);
  function section(name: Section) {
    let result = sections.get(name);
    if (!result) { result = sectionIndex(); sections.set(name, result); }
    return result;
  }
  function child(record: number, index: number) { return odfChildren(odfObject(imported[record - 1]?.data)?.xml)[index]; }
  async function put(target: ReturnType<typeof sectionIndex>, key: string, pointer: number) {
    let ordinal = await target.identities.get(key);
    if (ordinal === undefined) { ordinal = target.count++; await target.identities.set(key, ordinal); }
    await target.entries.set(BigInt(ordinal), BigInt(pointer));
  }
  let anonymous = 0;
  for (const [recordIndex, record] of imported.entries()) {
    xml.charge(); if (record.source !== "Gnumeric_OpenCalc:openoffice") continue;
    const data = odfObject(record.data);
    const name: Section | undefined = record.kind === "automatic-styles"
      ? data?.packagePart === "styles.xml" ? "stylesAutomatic" : "contentAutomatic"
      : record.kind === "master-styles" ? "masters" : record.kind === "font-face-decls" ? "fonts"
        : record.kind === "styles" ? "styles" : undefined;
    if (!name) continue;
    const target = section(name);
    for (const [childIndex, value] of odfChildren(data?.xml).entries()) {
      xml.charge(); const node = odfObject(value), attributes = odfAttributes(value, odfNamespaces.style);
      const key = attributes.name ? JSON.stringify([node?.namespace, node?.name, attributes.family ?? "", attributes.name]) : "anonymous:" + anonymous++;
      // Updating an identity retains its original insertion slot and last value.
      await put(target, key, await records.put([recordIndex + 1, childIndex, 0]));
      if (attributes.name) await names.set(attributes.name, 0);
    }
  }
  for (const target of sections.values()) for await (const [, pointer] of target.entries.entries()) {
    const [record, index] = await records.get(Number(pointer)), value = child(record, index);
    xml.charge(); const node = odfObject(value), name = odfAttributes(value, odfNamespaces.style).name;
    if (!node || !name || !Array.isArray(node.attributes)) continue;
    const attributes = node.attributes.filter(value => {
      xml.charge(); const attribute = odfObject(value);
      return attribute?.namespace !== odfNamespaces.style || attribute?.name !== "name";
    });
    await target.shapes.set(xml.retained({ ...node, attributes }), Number(pointer));
  }
  async function register(sectionName: Section, tag: string, preferredName: string, attributes: OdfAttributes, content = "") {
    const shape = xml.element(tag, attributes, content), target = section(sectionName), existing = await target.shapes.get(shape);
    if (existing !== undefined) {
      const [record, index, namePointer] = await records.get(existing);
      if (record) return odfAttributes(child(record, index), odfNamespaces.style).name!;
      let name = ""; for await (const fragment of records.text(namePointer)) name += fragment;
      return name;
    }
    let suffix = await candidates.get(preferredName) ?? 0;
    let name = suffix ? preferredName + "_" + suffix : preferredName;
    while (await names.get(name) !== undefined) { xml.charge(); name = preferredName + "_" + ++suffix; }
    await names.set(name, 0); await candidates.set(preferredName, suffix + 1);
    const value = xml.element(tag, { "style:name": name, ...attributes }, content);
    if (storage && admitContentBytes) {
      let bytes = 0;
      for (const character of value) { context.signal.throwIfAborted(); const point = character.codePointAt(0)!; bytes += point < 128 ? 1 : point < 2048 ? 2 : point < 65536 ? 3 : 4; }
      admitContentBytes(bytes);
    }
    const pointer = await records.put([0, await records.putText(value), await records.putText(name)]);
    await put(target, "generated:" + name, pointer); await target.shapes.set(shape, pointer);
    return name;
  }
  async function* render(sectionName: Section): AsyncGenerator<string> {
    const target = sections.get(sectionName); if (!target) return;
    for await (const [, pointer] of target.entries.entries()) {
      xml.charge(); const [record, index] = await records.get(Number(pointer));
      if (record) yield* xml.retainedFragments(child(record, index)); else yield* records.text(index);
    }
  }
  return { register, render };
}
