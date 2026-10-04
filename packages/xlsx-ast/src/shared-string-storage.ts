import { IntegerTable } from '@poe-code/safe-fs/storage';
import type { XmlElement, XmlStreamLimits } from '@poe-code/safe-fs/xml';
import { createXlsxRecords } from './stored-records.js';
import { SsconvertError, type CapabilityContext } from '@poe-code/spreadsheet-engine/contracts';
import { readXlsxString } from './xlsx-styles.js';

type SharedString = ReturnType<typeof readXlsxString>;

/** Raw children are replayed after XML validation, then recognized strings are
 * decoded at the original import phase. Only individual records are resident. */
export function createSharedStringStorage(context: CapabilityContext, acceptsNamespace: (namespace: string) => boolean) {
  let index: IntegerTable | undefined, streamedRoot: XmlElement | undefined;
  let rawStart = 0, rawEnd = 0, count = 0;
  const { storage, check, serial, append, read } = createXlsxRecords(context, () => { index = undefined; streamedRoot = undefined; });
  index = new IntegerTable(storage, 128);
  const accept = (node: XmlElement) => serial(async () => { const address = await append(node); await index!.set(BigInt(count), BigInt(address)); check(); count++; });
  const streamElements: NonNullable<XmlStreamLimits['streamElements']> = {
    matches(_node, parent, depth) { return depth === 2 && parent?.localName === 'sst' && acceptsNamespace(parent.namespace); },
    consume(node, parent) { return serial(async () => {
      const address = await append(node);
      if (!rawStart) rawStart = address;
      // Raw XML is contiguous; index records are populated only after parsing.
      rawEnd = storage!.allocate(0); streamedRoot = parent;
      parent.text = ''; (parent.content as unknown[]).length = 0;
    }); }
  };
  return {
    streamElements,
    async stage(parent: XmlElement, node: XmlElement): Promise<boolean> {
      if (parent.localName !== 'sst' || !acceptsNamespace(parent.namespace)) return false;
      if (node.localName === 'si') await accept(node);
      return true;
    },
    async *children(root: XmlElement): AsyncGenerator<XmlElement> {
      check();
      if (streamedRoot !== root) { yield* root.children; return; }
      const end = rawEnd;
      for (let address = rawStart; address < end;) {
        const record = await serial(() => read<XmlElement>(address));
        if (record.end > end) throw new SsconvertError('io', 'Invalid XLSX shared string record');
        address = record.end; yield record.value;
      }
      check();
    },
    accept,
    decode() { return serial(async () => {
      for (let i = 0; i < count; i++) {
        const pointer = await index!.get(BigInt(i)); check();
        if (pointer === undefined) throw new SsconvertError('io', 'Missing XLSX shared string');
        const node = (await read<XmlElement>(Number(pointer))).value;
        const address = await append(readXlsxString(node, context));
        await index!.set(BigInt(i), BigInt(address)); check();
      }
    }); },
    get(ordinal: number): Promise<SharedString | undefined> { return serial(async () => {
      if (!Number.isSafeInteger(ordinal) || ordinal < 0 || ordinal >= count) return undefined;
      const pointer = await index!.get(BigInt(ordinal)); check();
      if (pointer === undefined) throw new SsconvertError('io', 'Missing XLSX shared string');
      return (await read<SharedString>(Number(pointer))).value;
    }); }
  };
}
