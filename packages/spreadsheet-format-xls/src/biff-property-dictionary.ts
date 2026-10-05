import { IntegerTable } from '@poe-code/safe-fs/storage';
import { SsconvertError, type CapabilityContext } from '@poe-code/spreadsheet-engine/contracts';
import { invalidBiff } from './biff-binary.js';
import { propertyIndexStorage, type BiffPropertyRange } from './biff-property-range.js';
import { readBiffPropertyText } from './biff-property-text.js';

/** Validate/account names once, retain only coordinates, and decode on lookup.
 * Unsupported dictionary codepages skip the visitor so the caller retains the section. */
export async function visitBiffPropertyDictionary(data: BiffPropertyRange | undefined, codepage: number,
  context: CapabilityContext, admit: (count: number) => void, accountText: (text: string) => string,
  accountWork: (amount: number) => void, visit: (get: (id: number) => Promise<string | undefined>) => Promise<void>): Promise<boolean> {
  const count = data ? await data.u32(0) : 0;
  if (data) { data.check(4, count * 9); admit(count); }
  const storage = data && context.createWorkingStorage?.();
  let active = true, supported = true;
  const check = () => {
    context.signal.throwIfAborted(); data?.check(0, 0);
    if (!active) throw new SsconvertError('invalid-request', 'BIFF property dictionary index is closed');
  };
  try {
    const backing = storage && propertyIndexStorage(storage, data!);
    backing?.allocate(8);
    const index = backing ? new IntegerTable(backing, 64) : new Map<bigint, bigint>();
    let at = 4;
    for (let i = 0; i < count; i++) {
      const id = await data!.u32(at); let entry: { value: string; end: number };
      try { entry = await readBiffPropertyText(data!, at + 4, codepage, context, accountText, accountWork); }
      catch (error) {
        if (!(error instanceof SsconvertError) || error.code !== 'unsupported-feature') throw error;
        supported = false; break;
      }
      if (id < 2 || await index.get(BigInt(id)) !== undefined || !entry.value) invalidBiff('invalid property dictionary entry');
      check(); await index.set(BigInt(id), BigInt(at + 4)); check(); at = entry.end;
    }
    if (supported) await visit(async id => {
      check(); const position = await index.get(BigInt(id)); check();
      if (position === undefined) return undefined;
      const entry = await readBiffPropertyText(data!, Number(position), codepage, context, text => text, accountWork);
      check(); return entry.value;
    });
    check();
  } catch (error) {
    try { await storage?.close(); }
    catch (cleanup) { throw new AggregateError([error, cleanup], 'BIFF property dictionary and cleanup failed'); }
    throw error;
  } finally { active = false; }
  await storage?.close(); context.signal.throwIfAborted(); data?.check(0, 0);
  return supported;
}
