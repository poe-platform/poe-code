import { ZipDirectoryIndex } from '@poe-code/office-package';
import type { Range } from '@poe-code/spreadsheet-ast';
import type { CapabilityContext } from '@poe-code/spreadsheet-engine/contracts';
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
      return {
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
