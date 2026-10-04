import type { XmlElement, XmlContent, XmlStreamLimits } from '@poe-code/safe-fs/xml';
import { SsconvertError, type CapabilityContext } from '@poe-code/spreadsheet-engine/contracts';
import { createXlsxRecords } from './stored-records.js';

type RawRow = { node: XmlElement; before: readonly XmlContent[] };
type Group = { start: number; end: number };

/** Each sheetData container replays raw rows for recognition and recognized rows
 * for cell decoding. Groups are attached to their small retained container nodes. */
export function createWorksheetStorage(context: CapabilityContext, acceptsNamespace: (namespace: string) => boolean) {
  let raw = new WeakMap<XmlElement, Group>(), accepted = new WeakMap<XmlElement, Group>(), recognized = new WeakMap<XmlElement, Group>();
  const { storage, check, serial, append, read } = createXlsxRecords(context, () => { raw = new WeakMap(); accepted = new WeakMap(); recognized = new WeakMap(); });
  async function* replay(node: XmlElement, groups: WeakMap<XmlElement, Group>, rawRecords = false): AsyncGenerator<XmlElement> {
    check(); const group = groups.get(node);
    if (!group) { yield* node.children; return; }
    for (let address = group.start; address < group.end;) {
      const record = await serial(() => read<XmlElement | RawRow>(address));
      if (record.end > group.end) throw new SsconvertError('io', 'Invalid XLSX worksheet record');
      address = record.end; yield rawRecords ? (record.value as RawRow).node : record.value as XmlElement;
    }
    check();
  }
  async function restore(node: XmlElement): Promise<XmlElement> {
    check(); const group = raw.get(node), content: XmlContent[] = [];
    let changed = false;
    if (group) {
      changed = true;
      for (let address = group.start; address < group.end;) {
        const record = await serial(() => read<RawRow>(address));
        if (record.end > group.end) throw new SsconvertError('io', 'Invalid XLSX worksheet record');
        address = record.end; for (const item of record.value.before) content.push(item); content.push(record.value.node);
      }
      for (const item of node.content) content.push(item);
    } else {
      for (const item of node.content) {
        const value = item.kind === 'element' ? await restore(item) : item;
        changed ||= value !== item; content.push(value);
      }
    }
    if (!changed) return node;
    return { ...node, content, children: content.filter(item => item.kind === 'element'),
      text: content.filter(item => item.kind === 'text' || item.kind === 'cdata').map(item => item.text).join('') };
  }
  const streamElements: NonNullable<XmlStreamLimits['streamElements']> = {
    captureBefore: true,
    matches(_node, parent, depth) { return depth === 3 && parent?.localName === 'sheetData' && acceptsNamespace(parent.namespace); },
    consume(node, parent, before = []) { return serial(async () => {
      const address = await append({ node, before }), end = storage.allocate(0), group = raw.get(parent);
      if (group) group.end = end; else raw.set(parent, { start: address, end });
    }); }
  };
  return {
    streamElements, restore,
    children(node: XmlElement) { return replay(node, raw, true); },
    async stage(parent: XmlElement, node: XmlElement): Promise<boolean> {
      check(); if (!raw.has(parent)) return false;
      await serial(async () => {
        const address = await append(node), end = storage.allocate(0), group = accepted.get(parent);
        if (group) group.end = end; else accepted.set(parent, { start: address, end });
      });
      return true;
    },
    complete(parent: XmlElement, node: XmlElement) {
      check(); if (!raw.has(parent)) return;
      recognized.set(node, accepted.get(parent) ?? { start: 0, end: 0 }); accepted.delete(parent);
    },
    async *rows(node: XmlElement): AsyncGenerator<XmlElement> {
      for await (const row of replay(node, recognized)) if (row.localName === 'row') yield row;
    }
  };
}
