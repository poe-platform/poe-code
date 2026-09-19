import type { Runtime } from '../runtime.js';
import { CsvkitBlocked, CsvkitDiagnostic } from '../errors.js';
import { dbfFile } from './dbf-files.js';

export interface DbfMemo { readonly bytes: Uint8Array; readonly binary: boolean }

export async function openDbfMemo(runtime: Runtime, path: string, version: number): Promise<(index: number) => DbfMemo | null> {
  const dot = path.lastIndexOf('.'); const stem = dot > path.lastIndexOf('/') ? path.slice(0, dot) : path;
  const file = await dbfFile(runtime, stem + '.fpt') ?? await dbfFile(runtime, stem + '.dbt');
  if (!file) throw new CsvkitDiagnostic(`MissingMemoFile: missing memo file for ${path}`);
  const fpt = file.path.toLowerCase().endsWith('.fpt'); const bytes = file.bytes;
  if (fpt && bytes.length < 512) throw new CsvkitDiagnostic('error: unpack requires a buffer of 512 bytes');
  const blockSize = fpt ? new DataView(bytes.buffer).getUint16(6, false) : 512;
  return index => {
    runtime.step();
    if (index <= 0) return null;
    const begin = index * blockSize;
    if (!Number.isSafeInteger(index) || !Number.isSafeInteger(begin)) throw new CsvkitBlocked('DBF memo offset outside qualified integer range');
    if (!fpt && version === 131) {
      let end = begin;
      while (end < bytes.length && bytes[end] !== 26) { runtime.step(); end++; }
      return { bytes: bytes.subarray(begin, end), binary: false };
    }
    if (begin + 8 > bytes.length) throw new CsvkitDiagnostic('error: unpack requires a buffer of 8 bytes');
    const view = new DataView(bytes.buffer, begin, 8);
    const length = view.getUint32(4, !fpt);
    if (fpt && length > bytes.length - begin - 8) throw new CsvkitDiagnostic('OSError: EOF reached while reading memo');
    let data = bytes.subarray(begin + 8, Math.min(bytes.length, begin + 8 + length));
    if (!fpt) { const end = data.indexOf(31); if (end >= 0) data = data.subarray(0, end); }
    return { bytes: data, binary: fpt && view.getUint32(0, false) !== 1 };
  };
}
