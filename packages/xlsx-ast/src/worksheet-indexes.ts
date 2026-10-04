import { ZipDirectoryIndex } from '@poe-code/office-package';
import type { Range, AxisMetadata } from '@poe-code/spreadsheet-ast';
import { SsconvertError, type CapabilityContext } from '@poe-code/spreadsheet-engine/contracts';
import { createXlsxRecords } from './stored-records.js';

export interface XlsxSharedFormula {
  expression: string; row: number; column: number; id?: string; range?: Range; arrayStringLiterals?: boolean;
}

/** All sheets share one bounded header cache; sheet prefixes separate repeated
 * parts and exact shared-formula identifiers without retaining a map per sheet. */
export function createWorksheetIndexes(context: CapabilityContext) {
  let index: ZipDirectoryIndex | undefined, sequence = 0;
  const { storage, check, serial, append, read } = createXlsxRecords(context, () => { index = undefined; });
  index = new ZipDirectoryIndex(storage, { maximumKeyLength: Infinity, signal: context.signal });
  return {
    sheet() {
      check(); const prefix = sequence++ + ':';
      function axis(kind: string) {
        let count = 0, revision = 0;
        return {
          get(position: number): Promise<AxisMetadata | undefined> { return serial(async () => {
            const pointer = await index!.get(prefix + kind + ':' + position); check();
            return pointer === undefined ? undefined : (await read<AxisMetadata>(pointer)).value;
          }); },
          set(position: number, value: AxisMetadata) { return serial(async () => {
            const key = prefix + kind + ':' + position;
            const previous = await index!.get(key); check();
            const pointer = await append(value);
            if (previous === undefined) { await index!.set(prefix + kind + '-order:' + count, position); check(); count++; }
            await index!.set(key, pointer); check(); revision++;
          }); },
          async *values(): AsyncGenerator<AxisMetadata> {
            check(); const expected = revision;
            for (let ordinal = 0; ordinal < count; ordinal++) {
              yield await serial(async () => {
                if (revision !== expected) throw new SsconvertError('invalid-request', 'XLSX axis changed during iteration');
                const position = await index!.get(prefix + kind + '-order:' + ordinal); check();
                if (position === undefined) throw new SsconvertError('io', 'Missing XLSX axis ordinal');
                const pointer = await index!.get(prefix + kind + ':' + position); check();
                if (pointer === undefined) throw new SsconvertError('io', 'Missing XLSX axis metadata');
                return (await read<AxisMetadata>(pointer)).value;
              });
            }
            check();
            if (revision !== expected) throw new SsconvertError('invalid-request', 'XLSX axis changed during iteration');
          }
        };
      }
      return {
        rows: axis('r'), columns: axis('l'),
        heights: {
          get(position: number): Promise<number | undefined> { return serial(async () => {
            const pointer = await index!.get(prefix + 'h:' + position); check();
            return pointer === undefined ? undefined : (await read<number>(pointer)).value;
          }); },
          set(position: number, value: number) { return serial(async () => {
            const pointer = await append(value); await index!.set(prefix + 'h:' + position, pointer); check();
          }); }
        },
        cells: {
          get(position: number) { return serial(async () => { const value = await index!.get(prefix + 'c:' + position); check(); return value; }); },
          set(position: number, ordinal: number) { return serial(async () => { await index!.set(prefix + 'c:' + position, ordinal); check(); }); }
        },
        shared: {
          get(id: string): Promise<XlsxSharedFormula | undefined> { return serial(async () => {
            const pointer = await index!.get(prefix + 'f:' + id); check();
            return pointer === undefined ? undefined : (await read<XlsxSharedFormula>(pointer)).value;
          }); },
          set(id: string, value: XlsxSharedFormula) { return serial(async () => {
            const pointer = await append(value); await index!.set(prefix + 'f:' + id, pointer); check();
          }); }
        }
      };
    }
  };
}
