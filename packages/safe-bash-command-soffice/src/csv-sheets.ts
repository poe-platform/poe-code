import type { SofficeBudget } from './budget.js';
import { SofficeError } from './contracts.js';

export interface CsvSheetExportRequest {
  readonly sheetNames: readonly string[];
  /** Zero-based workbook index; selector is the separate CSV export contract. */
  readonly currentSheet: number;
  readonly selector: number;
  /** Canonical absolute VFS directory, not a URL or host path. */
  readonly directory: string;
  /** Already derived source basename without its replacement extension. */
  readonly stem: string;
  readonly extension: string;
}
export interface CsvSheetExportTarget {
  readonly sheetIndex: number;
  readonly path: string;
}

/** Pure preflight. No reads/writes; VFS alias checks are still required at publication.
 * Successful path reservations live until invocation close; failures release only
 * this call's reservations. Caller owns input strings and workbook metadata.
 */
export function planCsvSheetExports(request: CsvSheetExportRequest, budget: SofficeBudget): readonly CsvSheetExportTarget[] {
  budget.checkpoint();
  const { selector, currentSheet, sheetNames, directory, stem, extension } = request;
  if (!Number.isSafeInteger(selector) || selector < -1 || selector > sheetNames.length || sheetNames.length === 0 ||
      (selector === 0 && (!Number.isSafeInteger(currentSheet) || currentSheet < 0 || currentSheet >= sheetNames.length))) {
    throw new SofficeError('invalid-argument', 'invalid or out-of-range CSV sheet selector');
  }
  const validateComponent = (value: string, start = 0, end = value.length) => {
    if (start === end || (end - start <= 2 && value[start] === '.' && (end - start === 1 || value[start + 1] === '.'))) throw new SofficeError('invalid-argument', 'invalid VFS path component');
    for (let index = start; index < end; index++) {
      budget.charge('work', 1);
      const point = value.codePointAt(index)!;
      if (point === 47 || point === 92 || point === 0 || (point >= 0xd800 && point <= 0xdfff)) {
        throw new SofficeError('invalid-argument', 'unsafe VFS path component');
      }
      if (point > 65535) index++;
    }
  };
  validateComponent(stem);
  validateComponent(extension);
  if (!directory.startsWith('/')) throw new SofficeError('invalid-argument', 'CSV output directory must be absolute');
  // Scan rather than split: do not allocate unbounded directory-token arrays.
  let start = 1;
  for (let index = 1; index <= directory.length && directory !== '/'; index++) {
    budget.charge('work', 1);
    if (index === directory.length || directory[index] === '/') {
      validateComponent(directory, start, index);
      start = index + 1;
    }
  }
  const targets: CsvSheetExportTarget[] = [];
  const paths = new Set<string>();
  let retained = 0;
  try {
    const first = selector === -1 ? 0 : selector === 0 ? currentSheet : selector - 1;
    const end = selector === -1 ? sheetNames.length : first + 1;
    for (let sheetIndex = first; sheetIndex < end; sheetIndex++) {
      budget.charge('nodes', 1);
      budget.charge('work', 1);
      const name = sheetNames[sheetIndex]!;
      validateComponent(name);
      const length = (directory === '/' ? 0 : directory.length) + 1 + stem.length +
        (selector === 0 ? 0 : 1 + name.length) + 1 + extension.length;
      budget.charge('work', length);
      budget.charge('retainedBytes', 2 * length);
      retained += 2 * length;
      const path = (directory === '/' ? '' : directory) + '/' + stem + (selector === 0 ? '' : '-' + name) + '.' + extension;
      if (paths.has(path)) throw new SofficeError('invalid-argument', 'colliding CSV sheet destinations');
      paths.add(path);
      targets.push({ sheetIndex, path });
    }
    return targets;
  } catch (error) {
    budget.releaseRetainedBytes(retained);
    throw error;
  }
}
