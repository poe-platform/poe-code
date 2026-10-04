import { Binary, invalidBiff } from "./biff-binary.js";

export interface BiffPropertySection { guid: string; offset: number; end: number; }

/** LibreOffice oleprops.cxx:943/1160: absolute sections, relative property values.
 * Unknown section bodies remain opaque; callers choose which values to inspect. */
export function readBiffPropertySections(bytes: Uint8Array, admit: (count: number) => void,
  accountWork: (amount: number) => void): BiffPropertySection[] {
  const file = new Binary(bytes); file.check(0, 28);
  if (file.u16(0) !== 0xfffe || file.u16(2) > 1) invalidBiff("invalid property-set header");
  const count = file.u32(24), tableEnd = 28 + count * 20;
  file.check(28, count * 20); admit(count);
  const sections: { guid: string; offset: number; end: number }[] = [];
  for (let i = 0; i < count; i++) {
    const at = 28 + i * 20, offset = file.u32(at + 16);
    if (offset < tableEnd || offset % 4) invalidBiff("invalid property section offset");
    // Native libgsf byte-string dictionaries and final values need not end on a word boundary.
    const size = file.u32(offset); if (size < 8) invalidBiff("invalid property section size");
    file.check(offset, size);
    const guid = Array.from(file.slice(at, 16), byte => byte.toString(16).padStart(2, "0")).join("");
    sections.push({ guid, offset, end: offset + size });
  }
  accountWork(count * Math.ceil(Math.log2(count + 1)));
  sections.sort((a, b) => a.offset - b.offset);
  for (let i = 1; i < sections.length; i++) if (sections[i]!.offset < sections[i - 1]!.end) invalidBiff("overlapping property sections");
  return sections;
}

export function readBiffPropertyValues(section: Binary, admit: (count: number) => void,
  accountWork: (amount: number) => void): Map<number, Binary> {
  const propertyCount = section.u32(4);
  section.check(8, propertyCount * 8); admit(propertyCount);
  const pointers: { id: number; at: number }[] = [], ids = new Set<number>();
  for (let i = 0; i < propertyCount; i++) {
    const id = section.u32(8 + i * 8), at = section.u32(12 + i * 8);
    if (at < 8 + propertyCount * 8 || at > section.bytes.length - 4) invalidBiff("invalid property offset");
    if (ids.has(id)) invalidBiff("duplicate property ID");
    ids.add(id); pointers.push({ id, at });
  }
  accountWork(propertyCount * Math.ceil(Math.log2(propertyCount + 1)));
  pointers.sort((a, b) => a.at - b.at);
  const values = new Map<number, Binary>();
  for (let i = 0; i < pointers.length; i++) {
    const { id, at } = pointers[i]!, next = pointers[i + 1]?.at ?? section.bytes.length;
    if (next === at) invalidBiff("overlapping property values");
    values.set(id, new Binary(section.slice(at, next - at)));
  }
  return values;
}
