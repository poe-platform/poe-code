import type { PagedStorage } from "@poe-code/safe-fs/storage";
import { OfficeXml, SpanMap, type OfficeElement } from "./retained-office-xml.js";
import type { SofficeSnapshot } from "./retained-input.js";
import { retainXmlText } from "./retained-xml-text.js";
import type { XmlRange } from "@poe-code/office-xml";

/** Numbering definitions and per-list counters stay in caller-owned storage. */
export class DocxNumbering {
  private readonly abstracts: SpanMap;
  private readonly instances: SpanMap;
  private readonly counters: SpanMap;
  constructor(private readonly xml: OfficeXml, private readonly storage: PagedStorage, private readonly signal: AbortSignal) {
    this.abstracts = new SpanMap(storage, signal);
    this.instances = new SpanMap(storage, signal);
    this.counters = new SpanMap(storage, signal);
  }
  private async key(owner: OfficeXml, range: XmlRange): Promise<SofficeSnapshot> {
    const position = this.storage.allocate(0); let size = 0;
    for await (const bytes of owner.xml.read(range)) { this.signal.throwIfAborted(); await this.storage.append(bytes); size += bytes.length; }
    return { position, size };
  }
  private async value(owner: OfficeXml, range?: XmlRange): Promise<string> {
    if (!range || range.length > 4096) return "";
    const span = await retainXmlText(this.storage, owner.xml.read(range), this.signal, false);
    return new TextDecoder().decode(await this.storage.read(span.position, span.size));
  }
  private async property(owner: OfficeXml, element: OfficeElement, name: string): Promise<XmlRange | undefined> {
    for await (const child of owner.elements(element.open + 1, element.end, [name], true, true)) return owner.attribute(child, "val");
  }
  async retain(): Promise<void> {
    for await (const element of this.xml.elements(0, this.xml.count, ["abstractNum", "num"])) {
      const abstract = await this.xml.name(element.name) === "abstractNum";
      const id = await this.xml.attribute(element, abstract ? "abstractNumId" : "numId");
      if (id) await (abstract ? this.abstracts : this.instances).set(await this.key(this.xml, id), { position: element.first, size: element.end - element.first + 1 });
    }
  }
  async next(owner: OfficeXml, paragraph: OfficeElement): Promise<{ id: number; level: number; ordered: boolean; number: number; marker: string } | undefined> {
    let properties: OfficeElement | undefined;
    for await (const element of owner.elements(paragraph.open + 1, paragraph.end, ["numPr"])) { properties = element; break; }
    if (!properties) return;
    const id = await this.property(owner, properties, "numId");
    if (!id || await this.value(owner, id) === "0") return;
    const key = await this.key(owner, id), instance = await this.instances.get(key);
    if (!instance) return;
    const level = Number(await this.value(owner, await this.property(owner, properties, "ilvl")) || "0");
    if (!Number.isInteger(level) || level < 0 || level > 8) return;
    let abstractId: XmlRange | undefined, override: OfficeElement | undefined, startOverride: string | undefined;
    for await (const num of this.xml.elements(instance.position, instance.position + instance.size, ["num"])) {
      abstractId = await this.property(this.xml, num, "abstractNumId");
      for await (const child of this.xml.elements(num.open + 1, num.end, ["lvlOverride"])) {
        if (Number(await this.value(this.xml, await this.xml.attribute(child, "ilvl"))) !== level) continue;
        const start = await this.property(this.xml, child, "startOverride");
        if (start) startOverride = await this.value(this.xml, start);
        for await (const definition of this.xml.elements(child.open + 1, child.end, ["lvl"])) override = definition;
      }
    }
    const abstract = abstractId && await this.abstracts.get(await this.key(this.xml, abstractId));
    let definition = override;
    if (!definition && abstract) for await (const candidate of this.xml.elements(abstract.position, abstract.position + abstract.size, ["lvl"])) {
      if (Number(await this.value(this.xml, await this.xml.attribute(candidate, "ilvl"))) === level) { definition = candidate; break; }
    }
    if (!definition) return;
    const format = await this.value(this.xml, await this.property(this.xml, definition, "numFmt"));
    const template = await this.value(this.xml, await this.property(this.xml, definition, "lvlText"));
    const start = Number(startOverride ?? (await this.value(this.xml, await this.property(this.xml, definition, "start")) || "1"));
    if (!Number.isSafeInteger(start)) return;
    const previous = await this.counters.get(key);
    const counts: (number | null)[] = previous ? JSON.parse(new TextDecoder().decode(await this.storage.read(previous.position, previous.size))) : [];
    counts[level] = counts[level] == null ? start : counts[level]! + 1;
    counts.length = level + 1;
    const bytes = new TextEncoder().encode(JSON.stringify(counts)), position = this.storage.allocate(0);
    await this.storage.append(bytes); await this.counters.set(key, { position, size: bytes.length });
    const ordered = format !== "bullet" && format !== "none";
    let marker = template || (ordered ? `%${level + 1}.` : "•");
    if (ordered) for (let index = 0; index <= 8; index++) marker = marker.replaceAll(`%${index + 1}`, String(counts[index] ?? 1));
    // Symbol-font bullets use private-use glyphs that have no portable text equivalent.
    if (format === "bullet" && [...marker].some(char => char.codePointAt(0)! >= 0xe000 && char.codePointAt(0)! <= 0xf8ff)) marker = "•";
    if (format === "none") marker = "";
    return { id: instance.position, level, ordered, number: counts[level]!, marker };
  }
}
